# Meeting Recorder

Record meetings (microphone + PC audio) and auto-transcribe with speaker diarization, powered by [AssemblyAI](https://www.assemblyai.com/).

Built for use with Claude — paste the transcript directly into a chat and ask questions about your meeting.

---

## Features

- 🎙 Captures **microphone** and **PC audio** simultaneously (works with headphones)
- 🔴 One-click record / stop
- 💾 Downloads the recording as a **WAV** file (16 kHz, mono, speech-quality)
- 🗣 Auto-transcribes with **speaker diarization** (Speaker A, B, C…) via AssemblyAI
- 📋 **Copy for Claude** button — transcript formatted and ready to paste
- 🔑 API key saved locally in the browser — enter it once

---

## Requirements

- **Chrome** or **Edge** (Firefox does not support the Web Speech APIs used)
- A free [AssemblyAI](https://www.assemblyai.com/) account (100 hours / month free)

---

## Use it online

If GitHub Pages is enabled on this repo, the app is live at:

```
https://<your-username>.github.io/meeting-recorder/
```

No installation needed — just open the URL in Chrome or Edge.

---

## Run locally

```bash
# 1. Clone the repo
git clone https://github.com/<your-username>/meeting-recorder.git
cd meeting-recorder

# 2. Install dependencies (only Vite — no framework)
npm install

# 3. Start dev server
npm run dev
```

Open `http://localhost:5173` in Chrome or Edge.

---

## Deploy to GitHub Pages

The repo includes a GitHub Actions workflow (`.github/workflows/deploy.yml`) that
builds and deploys automatically on every push to `main`.

**First-time setup:**

1. Go to your repo → **Settings** → **Pages**
2. Under *Source*, select **GitHub Actions**
3. Push to `main` — the workflow runs and your app is live in ~1 minute

---

## How to use

1. **Enter your AssemblyAI API key** (saved in your browser, never leaves your device)
2. **Connect microphone** — click and allow browser permission
3. **Connect PC audio** *(optional, for recording what others say)*
   - A screen-share dialog opens
   - Select **Entire Screen**
   - Check **Share system audio**
   - Click **Share**
4. Press ⏺ **REC** to start
5. Press ⏹ **STOP** when done
6. **Download WAV** appears immediately
7. Transcription runs in the background (1–3 min) — transcript appears automatically
8. Click **Copy for Claude** and paste into your Claude chat

---

## Tech stack

| Layer | Choice | Why |
|-------|--------|-----|
| Build | [Vite](https://vitejs.dev/) | Zero-config, fast |
| Runtime | Vanilla JS | No framework overhead |
| Recording | Web Audio API + ScriptProcessorNode | WAV capture from mic + system audio |
| Transcription | [AssemblyAI](https://www.assemblyai.com/) REST API | Best-in-class speaker diarization |
| Deploy | GitHub Pages via Actions | Free, automatic |

---

## File structure

```
meeting-recorder/
├── src/
│   ├── main.js       ← all app logic (recording + transcription)
│   └── style.css     ← styles
├── public/
│   └── mic.svg       ← favicon
├── .github/
│   └── workflows/
│       └── deploy.yml ← auto-deploy to GitHub Pages
├── index.html
├── package.json
└── vite.config.js
```

---

## License

MIT
