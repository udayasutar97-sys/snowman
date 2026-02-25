
import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import SpeechRecognition, { useSpeechRecognition } from "react-speech-recognition";
import {
  FaMoon,
  FaSun,
  FaPaperPlane,
  FaPaperclip,
  FaTrash,
  FaMicrophone,
  FaStopCircle,
} from "react-icons/fa";
import "./App.css";

import { HiSparkles } from "react-icons/hi2"; 
import { MdOutlineImageSearch } from "react-icons/md"; 
import { RiImageEditLine } from "react-icons/ri";

const API = process.env.REACT_APP_API || "http://localhost:5000";
const INITIAL_MESSAGE = [
  { role: "assistant", content: "Hi, this is ⛄️Snowman AI, how may I help you?" },
];

function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^\w\s:/.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isImageGenPrompt(text) {
  const t = normalizeText(text);

  const hasToolKeyword =
    /\b(comfyui|stable diffusion|stablediffusion|sdxl|txt2img|text to image|text-to-image|midjourney|dall e|dalle|ai art|ai image|diffusion|image turbo|z-image|z image)\b/.test(
      t
    );

  const hasGenVerb =
    /\b(generate|create|make|draw|paint|render|produce|design|illustrate|sketch|craft|build|synthesize|imagine|animate)\b/.test(
      t
    );

  const hasImageNoun =
    /\b(images?|pictures?|photos?|art|artworks?|drawings?|sketches?|illustrations?|portraits?|wallpapers?|logos?|icons?|posters?|banners?|thumbnails?|stickers?|memes?|covers?)\b/.test(
      t
    );

  const requestFraming =
    /\b(can you|could you|please|i want|i need|make me|create me|generate me|draw me|show me|give me|help me)\b/.test(
      t
    );

  const standaloneVisualAsk =
    /\b(wallpapers?|logos?|posters?|thumbnails?|stickers?|memes?|portraits?)\b/.test(t) &&
    (/\bfor\b/.test(t) || /\bof\b/.test(t) || /\bwith\b/.test(t));

  if (hasToolKeyword) return true;
  if (hasGenVerb && hasImageNoun) return true;
  if (requestFraming && hasImageNoun) return true;
  if (standaloneVisualAsk) return true;

  return false;
}

function parseImageCount(text) {
  const t = normalizeText(text);

  let m = t.match(/\b(\d+)\s*(images?|pics?|pictures?|photos?|wallpapers?)\b/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n)) return Math.max(1, Math.min(4, n)); 
  }

  const wordToNum = { one: 1, two: 2, three: 3, four: 4 };
  m = t.match(/\b(one|two|three|four)\s*(images?|pics?|pictures?|photos?|wallpapers?)\b/);
  if (m) return wordToNum[m[1]] || 1;

  return 1;
}

function isImageFile(file) {
  return file && typeof file.type === "string" && file.type.startsWith("image/");
}

function isAbortError(e) {
  
  return (
    e?.code === "ERR_CANCELED" ||
    e?.name === "CanceledError" ||
    String(e?.message || "").toLowerCase().includes("canceled") ||
    String(e?.message || "").toLowerCase().includes("cancelled") ||
    String(e?.message || "").toLowerCase().includes("aborted")
  );
}

function makeJobId() {
  return `${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
}

function renderInlineMarkdown(text) {
  const s = String(text || "");
  const parts = [];
  let i = 0;

  while (i < s.length) {
   
    if (s.startsWith("**", i)) {
      const end = s.indexOf("**", i + 2);
      if (end !== -1) {
        parts.push({ type: "bold", value: s.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }

  
    if (s.startsWith("*", i)) {
      const end = s.indexOf("*", i + 1);
      if (end !== -1) {
        parts.push({ type: "italic", value: s.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    let next = s.length;
    const b = s.indexOf("**", i);
    const it = s.indexOf("*", i);
    if (b !== -1) next = Math.min(next, b);
    if (it !== -1) next = Math.min(next, it);

    parts.push({ type: "text", value: s.slice(i, next) });
    i = next;
  }

  return parts.map((p, idx) => {
    if (p.type === "bold") return <strong key={idx}>{p.value}</strong>;
    if (p.type === "italic") return <em key={idx}>{p.value}</em>;
    return <React.Fragment key={idx}>{p.value}</React.Fragment>;
  });
}

export default function App() {
  const [theme, setTheme] = useState("dark");
  const [messages, setMessages] = useState(INITIAL_MESSAGE);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(null); 
  const [pendingFiles, setPendingFiles] = useState([]);
  const [previewImage, setPreviewImage] = useState(null);
  const [copiedIndex, setCopiedIndex] = useState(null);

  const chatRef = useRef(null);

  const requestNonceRef = useRef(0);
  const cancelRef = useRef(false);
  const abortRef = useRef(null); 
  const [activeJobId, setActiveJobId] = useState(null); 

  const { transcript, listening, resetTranscript, browserSupportsSpeechRecognition } =
    useSpeechRecognition();

  const micBaseInputRef = useRef("");
  const micActiveRef = useRef(false);

  const isBusy = !!loading;

  
  const disableHeaderButtons = isBusy;
  const disableSendAndModes = isBusy;
  const stopEnabled = isBusy;

  
  const hasText = input.trim().length > 0;
  const hasImages = pendingFiles.filter(isImageFile).length > 0;

  
  const canSend = !isBusy && (hasText || hasImages);

  
  const canTxt2Img = !isBusy && hasText;

  
  const [isDraggingFooter, setIsDraggingFooter] = useState(false);
  const dragCounterRef = useRef(0);

  
  useEffect(() => {
    const preventWindowDrop = (e) => {
      const appEl = document.querySelector(".app");
      if (appEl && !appEl.contains(e.target)) {
        e.preventDefault();
      }
    };

    const preventWindowDragOver = (e) => {
      const appEl = document.querySelector(".app");
      if (appEl && !appEl.contains(e.target)) {
        e.preventDefault();
      }
    };

    window.addEventListener("dragover", preventWindowDragOver);
    window.addEventListener("drop", preventWindowDrop);
    return () => {
      window.removeEventListener("dragover", preventWindowDragOver);
      window.removeEventListener("drop", preventWindowDrop);
    };
  }, []);

  
  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();

    if (isBusy) {
      setIsDraggingFooter(false);
      dragCounterRef.current = 0;
      return;
    }

    const files = Array.from(e.dataTransfer.files || []);
    const onlyImages = files.filter(isImageFile);
    if (onlyImages.length) {
      setPendingFiles((prev) => [...prev, ...onlyImages]);
    }

    setIsDraggingFooter(false);
    dragCounterRef.current = 0;
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
  }


  function footerDragEnter(e) {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    setIsDraggingFooter(true);
  }

  function footerDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDraggingFooter(false);
    }
  }

  function footerDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!isDraggingFooter) setIsDraggingFooter(true);
  }

  function footerDrop(e) {

    handleDrop(e);
  }

  useEffect(() => {
    chatRef.current?.scrollTo(0, chatRef.current.scrollHeight);
  }, [messages, loading]);

  useEffect(() => {
    if (!micActiveRef.current) return;
    if (!listening) return;

    const base = micBaseInputRef.current || "";
    const t = (transcript || "").trim();
    const combined = `${base}${base && t ? " " : ""}${t}`.trim();
    setInput(combined);
  }, [transcript, listening]);

  function bumpNonce() {
    requestNonceRef.current += 1;
    return requestNonceRef.current;
  }

  function startNewAbortController() {
    
    try {
      abortRef.current?.abort();
    } catch {}
    abortRef.current = new AbortController();
    return abortRef.current;
  }

  function clearAbortController() {
    abortRef.current = null;
  }

  function copyToClipboard(text, index) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    });
  }

  async function onUpload(files) {
    if (!files || files.length === 0) return;
    const onlyImages = Array.from(files).filter(isImageFile);
    if (!onlyImages.length) return;
    setPendingFiles((prev) => [...prev, ...onlyImages]);
  }

  function clearHistory() {
    if (isBusy) return;
    setMessages(INITIAL_MESSAGE);
    setPendingFiles([]);
    chatRef.current?.scrollTo(0, 0);
  }

  async function handleStop() {
   
    cancelRef.current = true;
    bumpNonce(); 
    try {
      abortRef.current?.abort();
    } catch {}
    clearAbortController();

    
    try {
      await axios.post(`${API}/api/stop`, { jobId: activeJobId || null });
    } catch {}


    setActiveJobId(null);
    setLoading(null);


    setMessages((m) => [...m, { role: "assistant", content: "🛑 Stopped." }]);
  }

  async function handleDownload(url) {
    try {
      const response = await fetch(url, { mode: "cors" });
      const blob = await response.blob();
      const dlUrl = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = dlUrl;
      a.download = `snowman-image-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      window.URL.revokeObjectURL(dlUrl);
    } catch (err) {
      console.error("Download failed:", err);
    }
  }


  async function agentSend({ forceAction } = {}) {
    if (!input.trim() && pendingFiles.length === 0) return;

    const imageFiles = pendingFiles.filter(isImageFile);
    const userInput = input.trim();

    const nonce = bumpNonce();
    cancelRef.current = false;

    
    if (imageFiles.length > 0) {
      setMessages((m) => [
        ...m,
        {
          role: "user",
          content:
            forceAction === "vision"
              ? userInput || "Analyse these image(s)"
              : forceAction === "img_edit"
              ? `Edit image(s): ${userInput || "Edit these image(s)"}`
              : userInput || "Analyse these image(s)",
          images: imageFiles.map((file) => URL.createObjectURL(file)),
        },
      ]);
    } else if (userInput) {
      setMessages((m) => [...m, { role: "user", content: userInput }]);
    }

    setInput("");
    setPendingFiles([]);

    try {
      setLoading("agent");

      const controller = startNewAbortController();

      
      const jobId = makeJobId();
      setActiveJobId(jobId);

      
      let res;

      if (imageFiles.length > 0) {
        const form = new FormData();
        imageFiles.forEach((file) => form.append("files", file));
        form.append("prompt", userInput || "");


        form.append("jobId", jobId);

       
        if (forceAction) form.append("forceAction", forceAction);

        res = await axios.post(`${API}/api/agent`, form, {
          headers: { "Content-Type": "multipart/form-data" },
          signal: controller.signal,
        });
      } else {
        res = await axios.post(
          `${API}/api/agent`,
          {
            prompt: userInput,
            jobId,
            forceAction: forceAction || null,
          },
          { signal: controller.signal }
        );
      }

      if (cancelRef.current || requestNonceRef.current !== nonce) return;

      const data = res.data || {};

      
      const replyText =
        data.reply ||
        data.caption ||
        (data.action ? `✅ ${String(data.action)} done.` : "") ||
        "";

      if (replyText) {
        setMessages((m) => [...m, { role: "assistant", content: replyText }]);
      }

      if (data.urls && Array.isArray(data.urls) && data.urls.length > 0) {
        setMessages((m) => [...m, { role: "assistant", generatedImages: data.urls }]);
      }
    } catch (e) {
      if (isAbortError(e) || cancelRef.current) return;
      if (String(e?.response?.status) === "499") return;
      setMessages((m) => [...m, { role: "assistant", content: `Error: ${e.message}` }]);
    } finally {
      if (requestNonceRef.current === nonce) {
        setLoading(null);
        setActiveJobId(null);
      }
      clearAbortController();
    }
  }


  async function imageToText({ promptOverride } = {}) {
    const p = (promptOverride ?? input ?? "").trim();
    if (p !== input) setInput(p);
    await agentSend({ forceAction: "vision" });
  }


  async function textToImage({ promptOverride } = {}) {
    const p = (promptOverride ?? input ?? "").trim();
    if (!p) return;

    const count = parseImageCount(p);
    const nonce = bumpNonce();
    cancelRef.current = false;

    setMessages((m) => [...m, { role: "user", content: p }]);
    setInput("");

    try {
      setLoading("image");
      const urls = [];

      for (let i = 0; i < count; i++) {
        if (cancelRef.current || requestNonceRef.current !== nonce) break;

        const controller = startNewAbortController();
        const jobId = makeJobId();
        setActiveJobId(jobId);

        const res = await axios.post(
          `${API}/api/agent`,
          { prompt: p, jobId, forceAction: "txt2img" },
          { signal: controller.signal }
        );

        const data = res.data || {};
        const batch = Array.isArray(data?.urls) ? data.urls : [];
        if (batch.length) urls.push(...batch);
      }

      if (cancelRef.current || requestNonceRef.current !== nonce) return;

      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content:
            urls.length > 1
              ? `✅ Done! Generated ${urls.length} images.`
              : "✅ Done! Generated your image.",
        },
      ]);

      if (urls.length) {
        setMessages((m) => [...m, { role: "assistant", generatedImages: urls }]);
      } else {
        setMessages((m) => [...m, { role: "assistant", content: "No images were generated." }]);
      }
    } catch (e) {
      if (isAbortError(e) || cancelRef.current) return;
      if (String(e?.response?.status) === "499") return;
      setMessages((m) => [...m, { role: "assistant", content: `Image error: ${e.message}` }]);
    } finally {
      if (requestNonceRef.current === nonce) {
        setLoading(null);
        setActiveJobId(null);
      }
      clearAbortController();
    }
  }


  async function imageToImage({ promptOverride } = {}) {
    const p = (promptOverride ?? input ?? "").trim();
    if (p !== input) setInput(p);
    await agentSend({ forceAction: "img_edit" });
  }


  async function send() {
    if (!input.trim() && pendingFiles.length === 0) return;

    if (pendingFiles.filter(isImageFile).length === 0 && isImageGenPrompt(input.trim())) {
      await textToImage({ promptOverride: input.trim() });
      return;
    }

    await agentSend();
  }

  function renderMessage(m, i) {
  
    if (m.content && m.content.includes("```")) {
      const parts = m.content.split("```");
      return (
        <div className="bubble-container code-container">
          {parts.map((block, idx) =>
            idx % 2 === 1 ? (
              <div key={idx} className="code-wrapper">
                <div className="code-header">
                  <span className="code-label">Code</span>
                  <button
                    className={`copy-code-btn ${copiedIndex === i ? "copied" : ""}`}
                    onClick={() => copyToClipboard(block, i)}
                    disabled={copiedIndex === i}
                  >
                    {copiedIndex === i ? "✅ Copied!" : "Copy"}
                  </button>
                </div>
                <pre className="code-body">
                  <code>{block.replace(/^\w+\n/, "")}</code>
                </pre>
              </div>
            ) : (
              block.trim() && (
                <p key={idx} className="bubble">
                  {block}
                </p>
              )
            )
          )}
        </div>
      );
    }


    if (m.images && m.images.length > 0) {
      return (
        <div className="bubble-container">
          {m.content && <p className="bubble">{renderInlineMarkdown(m.content)}</p>}
          <div className="multi-images">
            {m.images.map((img, idx) => (
              <img
                key={idx}
                src={img}
                alt="uploaded"
                className="chat-image"
                onClick={() => setPreviewImage(img)}
              />
            ))}
          </div>
        </div>
      );
    }


    if (m.generatedImages && Array.isArray(m.generatedImages) && m.generatedImages.length > 0) {
      return (
        <div className="bubble-container">
          <div className="multi-images">
            {m.generatedImages.map((url, idx) => (
              <div key={idx} className="gen-wrap">
                <img
                  src={url}
                  alt="generated"
                  className="chat-image"
                  onClick={() => setPreviewImage(url)}
                />
                <div className="image-actions">
                  <button onClick={() => handleDownload(url)} className="download-btn">
                    💾 Download
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }


    if (m.image) {
      return (
        <div className="bubble-container">
          <img
            src={m.image}
            alt="generated"
            className="chat-image"
            onClick={() => setPreviewImage(m.image)}
          />
          <div className="image-actions">
            <button onClick={() => handleDownload(m.image)} className="download-btn">
              💾 Download
            </button>
          </div>
        </div>
      );
    }


    if (m.content) {
      return (
        <div className="bubble-container">
          <span className="bubble">{renderInlineMarkdown(m.content)}</span>
          <button className="copy-btn" onClick={() => copyToClipboard(m.content, i)}>
            {copiedIndex === i ? "✅ Copied!" : "Copy"}
          </button>
        </div>
      );
    }

    return null;
  }

  function toggleMic() {
    if (!browserSupportsSpeechRecognition) {
      alert("Speech recognition is not supported in this browser.");
      return;
    }

    if (listening) {
      SpeechRecognition.stopListening();
      micActiveRef.current = false;
      resetTranscript();
      return;
    }

    micBaseInputRef.current = input.trim();
    micActiveRef.current = true;
    resetTranscript();
    SpeechRecognition.startListening({ continuous: true, language: "en-US" });
  }

  const typingText =
    loading === "image"
      ? "Generating image(s)..."
      : loading === "vision"
      ? "Analyzing image(s)..."
      : loading === "img2img"
      ? "Editing image(s)..."
      : loading === "agent"
      ? "Thinking..."
      : "AI is typing...";

  return (
    <div className={`app ${theme}`} onDrop={handleDrop} onDragOver={handleDragOver}>
      <div className="container">
        <div className="header">
          <div className="brand">
  <img src={require("./assets/snowman.png")} alt="Snowman Logo" className="brand-logo" />
  <span className="brand-text">Snowman AI</span>
    </div>

          <div className="header-buttons">
            <button
              className="iconbtn"
              onClick={clearHistory}
              title="Clear chat history"
              disabled={disableHeaderButtons}
            >
              <FaTrash />
            </button>

            <button
              className="iconbtn"
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              title="Toggle theme"
              disabled={disableHeaderButtons}
            >
              {theme === "dark" ? <FaSun /> : <FaMoon />}
            </button>
          </div>
        </div>

        <div ref={chatRef} className="chat">
          {messages.map((m, i) => (
            <div key={i} className={`row ${m.role}`}>
              {renderMessage(m, i)}
            </div>
          ))}

          {loading && (
            <div className="row assistant">
              <span className="bubble typing">{typingText}</span>
            </div>
          )}
        </div>

        {pendingFiles.length > 0 && (
          <div className="preview-bar">
            {pendingFiles.map((file, i) => (
              <div key={i} className="preview-wrapper">
                <img src={URL.createObjectURL(file)} alt="preview" className="preview-thumb" />

               
                {isDraggingFooter && (
                  <div className="preview-plus" aria-hidden="true">
                    ⊕
                  </div>
                )}

                <button
                  className="remove-btn"
                  disabled={isBusy}
                  onClick={() => setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))}
                  title={isBusy ? "Busy" : "Remove"}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <div
          className={`footer ${isDraggingFooter ? "footer-dragging" : ""}`}
          onDragEnter={footerDragEnter}
          onDragLeave={footerDragLeave}
          onDragOver={footerDragOver}
          onDrop={footerDrop}
        >
          
          {isDraggingFooter && (
            <div className="footer-drop-overlay">
              <div className="footer-drop-text">Drop image(s)</div>
            </div>
          )}

          
          <textarea
            className="input input-compact"
            placeholder="Type a message..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            style={{
              overflowY: "auto",
              resize: "none",
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (canSend) send();
              }
            }}
          />

          
          <label className="iconbtn iconbtn-compact" htmlFor="file" title="Attach image(s)">
            <FaPaperclip />
          </label>

          <input
            id="file"
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={(e) => onUpload(e.target.files)}
          />

          
          <button
            className="iconbtn iconbtn-compact"
            onClick={send}
            title="Send (smart)"
            disabled={!canSend}
          >
            <FaPaperPlane />
          </button>

          
          <button
            className="iconbtn iconbtn-compact modebtn"
            onClick={() => textToImage()}
            title="Text → Image"
            disabled={!canTxt2Img}
          >
            <HiSparkles size={20} />
          </button>

         
          <button
            className="iconbtn iconbtn-compact modebtn"
            onClick={() => imageToText()}
            title="Image → Text"
            disabled={disableSendAndModes || pendingFiles.filter(isImageFile).length === 0}
          >
            <MdOutlineImageSearch size={20} />
          </button>

          
          <button
            className="iconbtn iconbtn-compact modebtn"
            onClick={() => imageToImage()}
            title="Image → Image (edit)"
            disabled={disableSendAndModes || pendingFiles.filter(isImageFile).length === 0}
          >
            <RiImageEditLine size={20} />
          </button>

          
          <button
            className="iconbtn iconbtn-compact stopbtn"
            onClick={handleStop}
            title="Stop"
            disabled={!stopEnabled}
          >
            <FaStopCircle />
          </button>

          
          <button
            className={`iconbtn iconbtn-compact ${listening ? "listening" : ""}`}
            onClick={toggleMic}
            title="Voice to text"
          >
            <FaMicrophone />
          </button>
        </div>
      </div>

      {previewImage && (
        <div className="image-modal" onClick={() => setPreviewImage(null)}>
          <div className="image-modal-content" onClick={(e) => e.stopPropagation()}>
            <img src={previewImage} alt="preview-large" className="preview-large" />
            <button className="close-btn" onClick={() => setPreviewImage(null)}>
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}