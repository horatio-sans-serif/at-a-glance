# At a Glance

A Chrome extension that summarizes web pages and scores their relevance to your projects and interests using a local LLM (Ollama).

## Features

- Extracts all text from the current page (DOM walking, aria labels, alt text, etc.)
- Summarizes the page in 3 bullet points via local Ollama/Qwen3
- Scores relevance to your configured projects and interests (0-100)
- Detects learning material (tutorials, guides, docs) and flags it
- Per-project and per-interest findings with rationale
- "Copy Claude Instructions" button on each finding -- copies a tailored prompt for Claude Code to investigate, build demos, and create interactive tutorials
- Overlay appears in bottom-right corner with color-coded relevance
- Auto-show mode with include/exclude URL pattern filtering
- Summaries persisted to `~/.local/share/glance/summaries.json`

## Requirements

- Chrome browser
- [Ollama](https://ollama.ai) running locally with a model (default: qwen3)
- Node.js (for the summary persistence server)

## Setup

### 1. Start Ollama with CORS enabled

```bash
OLLAMA_ORIGINS="chrome-extension://*" ollama serve
```

Or set it permanently:

```bash
launchctl setenv OLLAMA_ORIGINS "*"
```

Then quit and relaunch the Ollama app.

### 2. Pull a model

```bash
ollama pull qwen3
```

### 3. Install the extension

1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `extension/` directory

### 4. Install the persistence server

```bash
cd server
npm install
```

Install the launchd agent (macOS):

```bash
ln -sf "$(pwd)/com.glance.server.plist" ~/Library/LaunchAgents/com.glance.server.plist
launchctl load ~/Library/LaunchAgents/com.glance.server.plist
```

Verify it's running:

```bash
curl http://localhost:3377/summaries
```

### 5. Configure your profile

Click the Glance extension icon and fill in your user profile with your projects (including disk paths) and interests.

## Usage

- Click the Glance icon and hit "Analyze This Page" for manual analysis
- Enable auto-show in settings to analyze pages automatically
- Use include/exclude URL patterns to control which pages auto-analyze
- Click "Copy Claude Instructions" on any finding to get a tailored prompt for Claude Code

## Architecture

```
extension/
  manifest.json     Chrome MV3 manifest
  background.js     Service worker: Ollama API, analysis orchestration
  content.js        DOM text extraction, overlay UI (Shadow DOM)
  popup.html/js/css  Settings UI
  icons/            Extension icons

server/
  index.js          Express server for summary persistence
  package.json      Dependencies
  com.glance.server.plist  macOS launchd agent
```

## Data

- Settings: `chrome.storage.sync` (synced across Chrome instances)
- Summaries: `~/.local/share/glance/summaries.json` (local JSON file)
- Server logs: `~/.local/share/glance/server.log`
