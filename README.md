# ⛄️ Snowman AI (Offline Local Assistant)

Snowman AI is a fully offline local assistant that runs entirely on your machine using:

	•	Ollama for chat + vision (Qwen3-VL)
	•	Ollama image model (default: FLUX.2 Klein 4B).for   text-to-image generation
	•	A single smart endpoint (/api/agent) that routes requests to:
	•	chat
	•	vision (image → text)
	•	txt2img (text → image)
	•	img_edit (image editing via “re-render” prompt bridge)

This repository contains:

	•	client/ → React UI
	•	server/ → Express API (Ollama bridge, image generation, stop/cancel logic)

**No cloud APIs. No external keys. Fully local.**

⸻

## ✅ Features

### 💬 Chat UI
	•	Clean modern chat bubbles
	•	Code blocks rendered with Copy button
	•	Copy button for normal messages too
	•	Minimal inline markdown rendering:
	•	**bold** → bold
	•	*italic* → italic
	•	Asterisks do not appear visually

⸻

### 🖼 Images
	•	Upload multiple images
	•	Drag & drop images
	•	Footer-only “Drop image(s)” overlay
	•	Preview bar with removable thumbnails

⸻

### 🎨 Generated Image Gallery
	•	Supports multiple generated images
	•	Click to preview full size
	•	Download button for each image
	•	Images saved locally in server/public

⸻

### 🎙 Voice to Text
	•	Uses browser SpeechRecognition
	•	Mic button toggles live transcription
	•	Injects speech directly into the textbox

⸻

### 🛑 Real STOP System
	•	Cancels the in-flight HTTP request (AbortController)
	•	Calls /api/stop to kill server-side generation processes
	•	Uses detached process groups to kill entire spawn trees
	•	Prevents late-response UI corruption (nonce-based invalidation)

⸻

### 🧠 Intelligent Routing (Single Endpoint Design)

All user input goes through:

POST /api/agent

The backend uses **Qwen3-VL** as a strict JSON router that decides:
```
{
  "action": "chat | vision | txt2img | img_edit"
}
```

**This avoids brittle regex-based intent detection and enables clean multimodal scaling.**

⸻

## 🧱 Tech Stack

#### Frontend

	•	React (Create React App)
	•	axios
	•	react-icons
	•	react-speech-recognition

#### Backend

	•	Node.js
	•	Express
	•	multer (file uploads)
	•	spawn() to run Ollama image models
	•	True process-tree kill (macOS/Linux compatible)

#### Models (Default)

Type : Model

Chat : qwen3-vl:8b-instruct-q4_K_M

Vision : qwen3-vl:8b-instruct-q4_K_M

Image : x/flux2-klein:4b

**Models can be swapped via .env without touching code.**

⸻

  ## 📁 Project Structure

```txt
snowman-g/
│
├── client/
│   ├── public/
│   ├── src/
│   ├── .env.example
│   └── package.json
│
├── server/
│   ├── public/      # generated images saved locally
│   ├── uploads/     # temp uploads (gitignored)
│   ├── .env.example
│   ├── index.js
│   └── package.json
│
├── .gitignore
└── README.md
```


⸻

## ⚙️ Installation & Setup

⸻

### 1️⃣ Install Node.js

Requires Node 18+.

Check:
```bash
node -v
npm -v
```

⸻

### 2️⃣ Install Ollama

Install from official installer: [***Ollama***](https://ollama.com).

Verify:
```bash
ollama -v
```

Start Ollama:
```bash
ollama serve
```

⸻

### 3️⃣ Pull Required Models

```bash
ollama pull qwen3-vl:8b-instruct-q4_K_M
ollama pull x/flux2-klein:4b
```

Verify:
```bash
ollama list
```


⸻

### 4️⃣ Setup Server
```bash
cd server
npm install
```
Create:

***server/.env***


Example:
```.env
PORT=5000

OLLAMA_URL=http://localhost:11434
OLLAMA_CHAT_MODEL=qwen3-vl:8b-instruct-q4_K_M
OLLAMA_VISION_MODEL=qwen3-vl:8b-instruct-q4_K_M

OLLAMA_IMAGE_MODEL=x/flux2-klein:4b

IMAGE_WIDTH=512
IMAGE_HEIGHT=512
IMAGE_GEN_TIMEOUT_MS=600000
```

Start server:
```bash
node index.js
```

⸻

### 5️⃣ Setup Client
```bash 
cd client
npm install
```
Create:

***client/.env***

Example:
```.env
REACT_APP_API=http://localhost:5000
```

Start client:
```bash
npm start
```

#### Open:

***http://localhost:3000***


⸻

## 🖼 How Image Editing Works (Prompt-Bridge)

Snowman AI uses a re-render method instead of latent img2img.

Pipeline:

	1.	Vision model describes the original image precisely.
	2.	Qwen converts:
	  •	Image description
	  •	User edit request
           → into one highly explicit generation prompt.
	3.	FLUX.2 Klein regenerates edited image.

This allows editing even when the image model only supports txt2img.

Fully offline.

⸻

## 💻 Performance Notes (16GB RAM Systems)

Running:

	•	Qwen3-VL 8B
	•	FLUX.2 Klein 4B

#### Is workable but heavy.

#### If memory pressure occurs:

#### Lower resolution in .env:
```
IMAGE_WIDTH=384
IMAGE_HEIGHT=384
```

#### Avoid generating 4 images simultaneously.

⸻

## 🔄 Swapping Models

No code changes required.

#### Just update .env:
```
OLLAMA_CHAT_MODEL=your_model
OLLAMA_IMAGE_MODEL=your_image_model
```

**Restart server.**

⸻

## 🧠 Why I Built Snowman AI

I built Snowman AI to explore a question that kept bothering me:

## _Can powerful AI exist without depending on the cloud?_


Most AI systems today are centralized. They require internet access, API keys, remote servers, and external data routing. That model works — but it introduces privacy risks, latency issues, and infrastructure dependence.

I wanted to design an assistant that:

	•	Runs entirely offline
	•	Maintains full user privacy
	•	Requires no API keys
	•	Demonstrates true local orchestration
	•	Integrates text, vision, and image generation in one unified architecture
	•	Handles real process cancellation safely at the system level

Snowman AI is not just about using models — it’s about building the system that coordinates them intelligently.

The most important part of this project is the routing architecture:

Instead of writing brittle intent detection rules, I built a model-based JSON router that decides dynamically whether a request is chat, vision, generation, or editing.

That architectural decision changed the entire system.

**It made the assistant extensible.**

**It made it scalable.**

**It made it modular.**

**And it made it feel closer to how real intelligent systems should be built.**

⸻

## 🌍 Real-World Impact & Applications

Snowman AI demonstrates how AI systems can operate independently of centralized infrastructure.

This has real-world implications:

⸻

### 🏫 1. Schools & Educational Institutions

	•	Schools can deploy AI assistants without exposing student data to external servers
	•	No dependency on expensive cloud subscriptions
	•	Can run in computer labs with limited connectivity
	•	Useful for:
	•	Homework help
	•	Local research assistance
	•	Image-based science analysis
	•	Offline tutoring systems

Privacy is especially critical in educational environments.

⸻

### 🌐 2. Remote or Low-Connectivity Regions

In rural or remote areas:

	•	Internet may be slow or unreliable
	•	Cloud services may be inaccessible
	•	Data privacy may be sensitive

A fully local AI system allows:

	•	Medical image explanation (offline)
	•	Agricultural advisory support
	•	Educational tools
	•	Local language experimentation

**All without sending data anywhere.**

⸻

### 🔒 3. Privacy-Sensitive Environments

Organizations that require strict data control:

	•	Legal offices
	•	Healthcare settings
	•	Research labs
	•	Defense or internal corporate environments

Snowman AI shows how multimodal AI systems can be deployed without exposing:

	•	Internal documents
	•	Medical images
	•	Proprietary information

**Everything stays local.**

⸻

### 🖥 4. Personal Sovereignty Over AI

The long-term vision is AI systems that users control — not platforms that control users.

Snowman AI is a small step toward:

	•	Model modularity
	•	Local autonomy
	•	Transparent orchestration
	•	User-owned intelligence infrastructure

⸻

## 🧩 What This Project Really Demonstrates

Beyond the UI and models, Snowman AI demonstrates:

	•	System-level thinking
	•	Process management (true process-tree termination)
	•	JSON-based intent routing via LLM
	•	Prompt-bridging for pseudo img2img
	•	Full-stack architecture design
	•	Real-world performance tradeoffs (RAM limits, model swapping, resolution tuning)

It reflects my interest in building systems — not just calling APIs.

⸻

## 🚀 Future Improvements
	•	True latent img2img pipeline
	•	Streaming token responses
	•	Persistent conversation memory
	•	GPU utilization monitoring
	•	Multi-model hot switching UI
	•	Fine-grained performance controls

⸻

## 👤 Author

Udaya Chandra Sutar,

Creator of Snowman AI

____

