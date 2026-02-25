import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import fs from "fs";
import path from "path";
import fsp from "fs/promises";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));

const upload = multer({ dest: "uploads/" });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const PUBLIC_DIR = path.join(__dirname, "public");
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });

function cleanReply(text) {
  return String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function isMathExpr(text) {
  return /^\s*\d+(\s*[\+\-\*\/]\s*\d+)+\s*$/.test(text);
}

const SYSTEM_PROMPT = `
You are Snowman AI, a local offline assistant created by Udaya.
If asked "who are you", say you are Snowman AI created by Udaya.
If asked "who made you" / "who created you", answer: Udaya.
If asked "how may I address you" / "what should I call you", answer: Call me Snowman (or Snowman AI).
Never mention HiPiX.
Be friendly and helpful. Keep answers short unless user asks for steps.
`.trim();

function cannedAnswer(userText) {
  const t = String(userText || "").toLowerCase().trim();

  if (/^(who are you|who r u|who ru|what are you|what is this)\??$/.test(t)) {
    return `I'm Snowman AI — a local offline assistant created by Udaya.`;
  }
  if (/(who (made|created|built) you|who is your creator|who developed you)/.test(t)) {
    return `I was created by Udaya.`;
  }
  if (/(how (should|may) i (address|call) you|what should i call you|your name)/.test(t)) {
    return `Call me Snowman (or Snowman AI). 🙂`;
  }
  if (/(are you online|do you need internet|is this offline|are you local)/.test(t)) {
    return `I run locally. Chat + vision use Ollama on your machine, and image generation runs locally too.`;
  }
  return null;
}

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL || "qwen3-vl:8b-instruct-q4_K_M";
const VISION_MODEL = process.env.OLLAMA_VISION_MODEL || "qwen3-vl:8b-instruct-q4_K_M";


async function ollamaChat(messages) {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: CHAT_MODEL, messages, stream: false }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Ollama chat failed: ${response.status} ${errText}`.trim());
  }

  const data = await response.json();
  return cleanReply(data.message?.content || "No response.");
}

async function ollamaVisionDescribe({ prompt, imageBase64 }) {
  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: VISION_MODEL,
      prompt,
      images: [imageBase64],
      stream: false,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Ollama vision failed: ${response.status} ${errText}`.trim());
  }

  const data = await response.json();
  return cleanReply(data.response || "");
}


function extractJsonObject(text) {
  const s = String(text || "").trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  const chunk = s.slice(first, last + 1);
  try {
    return JSON.parse(chunk);
  } catch {
    return null;
  }
}


async function routeWithLLM({ userText, hasImages, numImages }) {
  const routerSystem = `
You are a STRICT JSON router for an offline assistant.
Return ONLY valid JSON. No markdown. No extra text.

Choose ONE action:
- "chat": normal assistant response.
- "vision": user wants understanding/answer ABOUT the provided image(s) (describe/analyze/explain).
- "txt2img": user wants generating a NEW image from text.
- "img_edit": user wants editing/transformation of provided image(s) (change background, style transfer, remove object, etc).

Rules:
- If hasImages=true and user requests a change to the image(s), choose "img_edit".
- If hasImages=true and user asks "what is in this image / explain this", choose "vision".
- If no images and user asks to generate/create/draw an image, choose "txt2img".
- Otherwise choose "chat".

Output schema:
{
  "action": "chat|vision|txt2img|img_edit",
  "reply": "only if action=chat (your final chat answer)",
  "prompt": "for txt2img or img_edit: the best final generation/edit prompt (very explicit)",
  "count": 1,
  "size": {"width": 512, "height": 512},
  "negative": ""
}

Make prompts explicit and controllable:
- For edits: preserve subject and composition, state what to keep unchanged, then the exact change.
- For background edits: say 'solid green background' + keep foreground colors/shapes unchanged.
`.trim();

  const messages = [
    { role: "system", content: routerSystem },
    {
      role: "user",
      content: JSON.stringify({
        userText: String(userText || ""),
        hasImages: !!hasImages,
        numImages: Number(numImages || 0),
      }),
    },
  ];

  const raw = await ollamaChat(messages);
  const obj = extractJsonObject(raw);

  
  if (!obj || !obj.action) {
    return { action: "chat", reply: String(raw || "").trim() || "OK." };
  }


  const action = String(obj.action || "").trim();
  const count = Number(obj.count || 1);
  const size = obj.size && typeof obj.size === "object" ? obj.size : null;

  return {
    action,
    reply: obj.reply ? String(obj.reply) : undefined,
    prompt: obj.prompt ? String(obj.prompt) : undefined,
    count: Number.isFinite(count) ? Math.max(1, Math.min(4, count)) : 1,
    size:
      size && Number.isFinite(Number(size.width)) && Number.isFinite(Number(size.height))
        ? { width: Math.max(64, Math.min(2048, Number(size.width))), height: Math.max(64, Math.min(2048, Number(size.height))) }
        : undefined,
    negative: obj.negative ? String(obj.negative) : undefined,
  };
}

const IMAGE_GEN_MODEL = process.env.OLLAMA_IMAGE_MODEL || "x/flux2-klein:4b";

const IMAGE_WIDTH = Number(process.env.IMAGE_WIDTH || 512);
const IMAGE_HEIGHT = Number(process.env.IMAGE_HEIGHT || 512);
const IMAGE_STEPS = process.env.IMAGE_STEPS ? Number(process.env.IMAGE_STEPS) : null;
const IMAGE_NEGATIVE = process.env.IMAGE_NEGATIVE || "";
const IMAGE_GEN_TIMEOUT_MS = Number(process.env.IMAGE_GEN_TIMEOUT_MS || 600000); 


const JOBS = new Map();

function makeJobId() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

async function listPngs(dir) {
  const files = await fsp.readdir(dir).catch(() => []);
  return files.filter((f) => f.toLowerCase().endsWith(".png"));
}

async function newestNewPng(beforeSet) {
  const after = await listPngs(PUBLIC_DIR);
  const newOnes = after.filter((f) => !beforeSet.has(f));
  if (!newOnes.length) return null;

  let newest = newOnes[0];
  let newestTime = 0;

  for (const f of newOnes) {
    const stat = await fsp.stat(path.join(PUBLIC_DIR, f)).catch(() => null);
    const t = stat ? stat.mtimeMs : 0;
    if (t >= newestTime) {
      newestTime = t;
      newest = f;
    }
  }
  return newest;
}

function killProcessTree(child, signal = "SIGTERM") {
  if (!child) return;
  try {
    if (child.pid) {
      try {
        process.kill(-child.pid, signal);
        return;
      } catch {}
    }
    try {
      child.kill(signal);
    } catch {}
  } catch {}
}

function killProcessTreeHard(child) {
  killProcessTree(child, "SIGTERM");
  const t = setTimeout(() => killProcessTree(child, "SIGKILL"), 800);
  t.unref?.();
}

function buildImagePrompt(finalPrompt, sizeOverride, negativeOverride) {
  const w = sizeOverride?.width ?? IMAGE_WIDTH;
  const h = sizeOverride?.height ?? IMAGE_HEIGHT;

  const lines = [];
  
  if (Number.isFinite(w)) lines.push(`/set width ${w}`);
  if (Number.isFinite(h)) lines.push(`/set height ${h}`);
  if (IMAGE_STEPS && Number.isFinite(IMAGE_STEPS)) lines.push(`/set steps ${IMAGE_STEPS}`);
  const neg = (negativeOverride || IMAGE_NEGATIVE || "").trim();
  if (neg) lines.push(`/set negative ${neg}`);

  
  lines.push(String(finalPrompt || "").trim());

  return lines.join("\n");
}

async function generateOneWithOllamaImage(prompt, jobId, opts = {}) {
  const before = new Set(await listPngs(PUBLIC_DIR));
  if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });

  const finalPrompt = buildImagePrompt(prompt, opts.size, opts.negative);

  return await new Promise((resolve, reject) => {
    const child = spawn("ollama", ["run", IMAGE_GEN_MODEL, finalPrompt], {
      cwd: PUBLIC_DIR,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      detached: true,
    });

    try {
      child.unref();
    } catch {}

    JOBS.set(jobId, child);

    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));

    const timer = setTimeout(() => {
      killProcessTreeHard(child);
      JOBS.delete(jobId);
      reject(new Error("Image generation timed out."));
    }, IMAGE_GEN_TIMEOUT_MS);

    child.on("error", (err) => {
      clearTimeout(timer);
      JOBS.delete(jobId);
      reject(err);
    });

    child.on("close", async (code, signal) => {
      clearTimeout(timer);
      JOBS.delete(jobId);

      if (signal === "SIGTERM" || signal === "SIGKILL") {
        return reject(new Error("Cancelled"));
      }

      if (code !== 0) {
        const msg = (stderr || "").trim();
        return reject(new Error(msg || `ollama exited with code ${code}`));
      }

      const newest = await newestNewPng(before);
      if (!newest) return reject(new Error("No PNG was produced."));
      resolve(`http://localhost:${PORT}/${newest}`);
    });
  });
}

async function generateWithOllamaImage(prompt, count = 1, opts = {}) {
  const n = Math.max(1, Math.min(4, Number(count) || 1));
  const urls = [];
  for (let i = 0; i < n; i++) {
    const jobId = makeJobId();
    const url = await generateOneWithOllamaImage(prompt, jobId, opts);
    if (url) urls.push(url);
  }
  return urls;
}


app.post("/api/stop", async (req, res) => {
  try {
    const { jobId } = req.body || {};

    
    if (!jobId) {
      for (const [id, child] of JOBS.entries()) {
        killProcessTreeHard(child);
        JOBS.delete(id);
      }
      return res.json({ ok: true, killedAll: true });
    }

    const child = JOBS.get(jobId);
    if (child) {
      killProcessTreeHard(child);
      JOBS.delete(jobId);
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/agent", upload.array("files"), async (req, res) => {
  try {
    const userText = String(req.body.prompt || req.body.text || "").trim();
    const files = Array.isArray(req.files) ? req.files : [];
    const hasImages = files.length > 0;

    const route = await routeWithLLM({
      userText,
      hasImages,
      numImages: files.length,
    });


    if (route.action === "chat") {
      const canned = cannedAnswer(userText);
      if (canned) return res.json({ action: "chat", reply: canned });

      if (isMathExpr(userText)) {
        try {
          const result = Function(`"use strict"; return (${userText})`)();
          return res.json({ action: "chat", reply: `The result of (${userText}) is **${result}**.` });
        } catch {}
      }

  
      if (route.reply) return res.json({ action: "chat", reply: route.reply });

 
      const reply = await ollamaChat([{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: userText }]);
      return res.json({ action: "chat", reply });
    }


    if (route.action === "vision") {
      if (!hasImages) return res.status(400).json({ error: "No images provided for vision." });

      const basePrompt = userText || "Describe these image(s) in detail";
      const total = files.length;

      const imageDescriptions = [];
      for (let idx = 0; idx < total; idx++) {
        const f = files[idx];
        const b64 = fs.readFileSync(f.path).toString("base64");

        const perImagePrompt = `
You are analyzing IMAGE ${idx + 1} of ${total}.
Task: ${basePrompt}

Rules:
- Describe ONLY what is visible.
- Be specific. No guessing.
`.trim();

        const desc = await ollamaVisionDescribe({ prompt: perImagePrompt, imageBase64: b64 });
        imageDescriptions.push({ index: idx + 1, filename: f.originalname || `image_${idx + 1}`, description: desc });
      }

      const joined = imageDescriptions.map(d => `IMAGE ${d.index}/${total} (${d.filename}):\n${d.description}`).join("\n\n");

      const final = await ollamaChat([
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `
TOTAL IMAGES: ${total}
Use ALL images.

IMAGE DESCRIPTIONS:
${joined}

USER QUESTION:
${basePrompt}

Answer clearly. If not visible, say "not visible".
`.trim(),
        },
      ]);

      return res.json({ action: "vision", caption: final, imageDescriptions, totalImages: total });
    }


    if (route.action === "txt2img") {
      const prompt = (route.prompt || userText || "").trim();
      if (!prompt) return res.status(400).json({ error: "Missing prompt." });

      const count = route.count || 1;
      const urls = await generateWithOllamaImage(prompt, count, { size: route.size, negative: route.negative });

      return res.json({
        action: "txt2img",
        reply: urls.length > 1 ? `✅ Done! Generated ${urls.length} images.` : `✅ Done! Generated your image.`,
        urls,
      });
    }


    if (route.action === "img_edit") {
      if (!hasImages) return res.status(400).json({ error: "No images provided for editing." });

      const editInstruction = (userText || route.prompt || "").trim();
      if (!editInstruction) return res.status(400).json({ error: "Missing edit instruction." });

      const total = files.length;
      const urls = [];

      for (let idx = 0; idx < total; idx++) {
        const f = files[idx];
        const b64 = fs.readFileSync(f.path).toString("base64");

        const description = await ollamaVisionDescribe({
          prompt: `
Describe this image precisely for recreation.
Include: subject, layout, colors, background, style, and what must stay unchanged.
No guessing. Concrete details only.
`.trim(),
          imageBase64: b64,
        });


        const promptBuilder = await ollamaChat([
          {
            role: "system",
            content: `
You are converting an image description + edit request into a single best prompt for an image generator.
Return ONLY the final prompt text (no markdown, no lists).

Rules:
- Preserve the original subject and composition unless the edit demands changes.
- Be extremely explicit about what must stay the same.
- For background color edits: specify "solid <color> background" and keep foreground unchanged.
- If user asks for style change: specify style clearly and keep key shapes/layout.
`.trim(),
          },
          {
            role: "user",
            content: `
IMAGE DESCRIPTION:
${description}

EDIT REQUEST:
${editInstruction}

Write the FINAL generation prompt now:
`.trim(),
          },
        ]);


        const jobId = String(req.body.jobId || makeJobId());
        const outUrl = await generateOneWithOllamaImage(promptBuilder, jobId, { size: route.size, negative: route.negative });
        if (outUrl) urls.push(outUrl);
      }

      return res.json({
        action: "img_edit",
        reply: urls.length > 1 ? `✅ Done! Edited ${urls.length} image(s).` : `✅ Done! Edited your image.`,
        urls,
      });
    }


    const fallback = await ollamaChat([{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: userText }]);
    return res.json({ action: "chat", reply: fallback });
  } catch (err) {
    if (String(err.message || "").toLowerCase().includes("cancelled")) {
      return res.status(499).json({ ok: false, error: "Cancelled" });
    }
    console.error("Agent error:", err);
    res.status(500).json({ ok: false, error: err.message });
  } finally {

    if (Array.isArray(req.files)) {
      for (const f of req.files) {
        try {
          await fsp.unlink(f.path);
        } catch {}
      }
    }
  }
});


app.post("/api/chat", async (req, res) => {
  try {
    const { messages } = req.body;
    const safeMessages = Array.isArray(messages) ? messages : [];
    const lastMsg = safeMessages[safeMessages.length - 1]?.content || "";

    const canned = cannedAnswer(lastMsg);
    if (canned) return res.json({ reply: canned });

    if (isMathExpr(lastMsg)) {
      try {
        const result = Function(`"use strict"; return (${lastMsg})`)();
        return res.json({ reply: `The result of (${lastMsg}) is **${result}**.` });
      } catch {}
    }

    const finalMessages = [{ role: "system", content: SYSTEM_PROMPT }, ...safeMessages];
    const reply = await ollamaChat(finalMessages);
    res.json({ reply });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: err.message });
  }
});


app.post("/api/vision", upload.array("files"), async (req, res) => {
  try {
    if (!req.files?.length) return res.status(400).json({ error: "No files uploaded" });

    const userPromptRaw = (req.body.prompt || "").trim();
    const basePrompt = userPromptRaw ? userPromptRaw : "Describe this image in detail";

    const total = req.files.length;
    const imageDescriptions = [];

    for (let idx = 0; idx < total; idx++) {
      const f = req.files[idx];
      const b64 = fs.readFileSync(f.path).toString("base64");

      const perImagePrompt = `
You are analyzing IMAGE ${idx + 1} of ${total}.
Task: ${basePrompt}

Rules:
- Describe ONLY what is visible in this image.
- If it is blank/low quality, say so.
`.trim();

      const desc = await ollamaVisionDescribe({ prompt: perImagePrompt, imageBase64: b64 });

      imageDescriptions.push({
        index: idx + 1,
        filename: f.originalname || `image_${idx + 1}`,
        description: desc?.trim() ? desc.trim() : "[No text returned for this image]",
      });
    }

    if (userPromptRaw) {
      const joined = imageDescriptions
        .map((d) => `IMAGE ${d.index}/${total} (${d.filename}):\n${d.description}`)
        .join("\n\n");

      const combinedMessages = [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `
TOTAL IMAGES PROVIDED: ${total}
You MUST use ALL ${total} image descriptions below.

IMAGE DESCRIPTIONS:
${joined}

USER QUESTION:
${userPromptRaw}

Rules:
- If something is not visible in any description, say "not visible".
`.trim(),
        },
      ];

      const finalAnswer = await ollamaChat(combinedMessages);
      return res.json({ caption: finalAnswer, imageDescriptions, totalImages: total });
    }

    const combinedCaption = imageDescriptions.map((d) => `Image ${d.index}/${total}: ${d.description}`).join("\n\n");
    res.json({ caption: combinedCaption, imageDescriptions, totalImages: total });
  } catch (err) {
    console.error("Vision error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    if (Array.isArray(req.files)) {
      for (const f of req.files) {
        try {
          await fsp.unlink(f.path);
        } catch {}
      }
    }
  }
});


app.post("/api/local-image", async (req, res) => {
  try {
    const { prompt, jobId: clientJobId, size, negative } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "Missing prompt" });

    const jobId = String(clientJobId || makeJobId());
    const url = await generateOneWithOllamaImage(String(prompt), jobId, { size, negative });

    res.json({ ok: true, jobId, urls: url ? [url] : [] });
  } catch (err) {
    if (String(err.message || "").toLowerCase().includes("cancelled")) {
      return res.status(499).json({ ok: false, error: "Cancelled" });
    }
    console.error("Image gen error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});


app.post("/api/img2img", upload.array("files"), async (req, res) => {
  try {
    if (!req.files?.length) return res.status(400).json({ error: "No files uploaded" });

    const editPrompt = String(req.body.prompt || "").trim();
    if (!editPrompt) return res.status(400).json({ error: "Missing prompt" });

    const jobId = String(req.body.jobId || makeJobId());
    const total = req.files.length;
    const urls = [];

    for (let idx = 0; idx < total; idx++) {
      const f = req.files[idx];
      const b64 = fs.readFileSync(f.path).toString("base64");

      const description = await ollamaVisionDescribe({
        prompt: `
Describe this image precisely for recreation.
Include subject, layout, colors, and background. No guessing.
`.trim(),
        imageBase64: b64,
      });

      const finalPrompt = await ollamaChat([
        {
          role: "system",
          content: `
Convert image description + edit request into ONE final generation prompt.
Return ONLY the prompt text.
Be explicit about what must stay the same.
`.trim(),
        },
        {
          role: "user",
          content: `
IMAGE DESCRIPTION:
${description}

EDIT REQUEST:
${editPrompt}

FINAL PROMPT:
`.trim(),
        },
      ]);

      const outUrl = await generateOneWithOllamaImage(finalPrompt, jobId);
      if (outUrl) urls.push(outUrl);
    }

    if (!urls.length) {
      return res.status(500).json({ ok: false, error: "No edited images were produced." });
    }

    res.json({ ok: true, jobId, urls });
  } catch (err) {
    if (String(err.message || "").toLowerCase().includes("cancelled")) {
      return res.status(499).json({ ok: false, error: "Cancelled" });
    }
    console.error("img2img error:", err);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    if (Array.isArray(req.files)) {
      for (const f of req.files) {
        try {
          await fsp.unlink(f.path);
        } catch {}
      }
    }
  }
});


app.use(express.static(PUBLIC_DIR));
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));