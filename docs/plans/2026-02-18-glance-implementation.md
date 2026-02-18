# Glance Browser Extension Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Chrome extension that extracts page text, summarizes via local Ollama/Qwen3, scores relevance against a user profile, displays results in an animated overlay, and supports saving pages to a local bookmark server.

**Architecture:** Content script extracts DOM text and renders overlay. Background service worker orchestrates Ollama API calls and bookmark server requests. Popup provides settings UI. Bookmark stub server is a separate Express app with JSON file storage.

**Tech Stack:** Chrome Extension Manifest V3, vanilla JS (no framework), Express.js for bookmark server, Ollama REST API with Qwen3 model.

---

### Task 1: Scaffold Extension Structure

**Files:**

- Create: `extension/manifest.json`
- Create: `extension/background.js` (empty placeholder)
- Create: `extension/content.js` (empty placeholder)
- Create: `extension/popup.html` (empty placeholder)
- Create: `extension/popup.js` (empty placeholder)
- Create: `extension/popup.css` (empty placeholder)
- Create: `extension/icons/` (generate simple icons)

**Step 1: Create manifest.json**

```json
{
  "manifest_version": 3,
  "name": "Glance",
  "version": "0.1.0",
  "description": "Summarize any page, score relevance to your profile, save to your second brain.",
  "permissions": ["storage", "activeTab", "scripting"],
  "host_permissions": ["http://localhost/*"],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

**Step 2: Create placeholder files**

`background.js`:

```js
// Glance background service worker
console.log("Glance background loaded");
```

`content.js`:

```js
// Glance content script
console.log("Glance content script loaded");
```

`popup.html`:

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Glance</title>
    <link rel="stylesheet" href="popup.css" />
  </head>
  <body>
    <h1>Glance</h1>
    <div id="app"></div>
    <script src="popup.js"></script>
  </body>
</html>
```

`popup.js`:

```js
console.log("Glance popup loaded");
```

`popup.css`:

```css
body {
  width: 380px;
  font-family: system-ui, sans-serif;
  padding: 16px;
  margin: 0;
}
```

**Step 3: Generate simple PNG icons**

Use a canvas-based script or just create solid-colored placeholder PNGs (16x16, 48x48, 128x128) with "G" letter. Can use ImageMagick if available, otherwise create minimal valid PNGs programmatically.

**Step 4: Load extension in Chrome and verify**

Open `chrome://extensions`, enable Developer Mode, "Load unpacked" pointing to `extension/`. Verify no errors in console, popup opens.

**Step 5: Commit**

```bash
git add extension/
git commit -m "scaffold Glance extension with MV3 manifest and placeholders"
```

---

### Task 2: Text Extraction (Content Script)

**Files:**

- Modify: `extension/content.js`

**Step 1: Implement dom_to_text function**

Adapted from RM scraper's `dom_to_text`. This is the core text extraction logic.

```js
function domToText(node, customizations = {}) {
  node = node || document.body;

  const options = {
    includeHidden: false,
    includeAria: true,
    includePlaceholders: true,
    includeAlts: true,
    includeValues: true,
    skipSelectors: [
      "script",
      "style",
      "noscript",
      "template",
      "svg",
      '[aria-hidden="true"]',
    ],
    ...customizations,
  };

  function getAriaText(element) {
    const parts = [];

    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel) parts.push(ariaLabel);

    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      for (const id of labelledBy.split(" ")) {
        const el = document.getElementById(id);
        if (el) parts.push(el.textContent);
      }
    }

    const ariaDesc = element.getAttribute("aria-description");
    if (ariaDesc) parts.push(ariaDesc);

    const describedBy = element.getAttribute("aria-describedby");
    if (describedBy) {
      for (const id of describedBy.split(" ")) {
        const el = document.getElementById(id);
        if (el) parts.push(el.textContent);
      }
    }

    return parts.join(" ");
  }

  const texts = [];

  function walk(n) {
    if (n.nodeType !== Node.ELEMENT_NODE && n.nodeType !== Node.TEXT_NODE)
      return;

    if (
      n.nodeType === Node.ELEMENT_NODE &&
      options.skipSelectors.some((sel) => n.matches?.(sel))
    )
      return;

    if (!options.includeHidden && n.nodeType === Node.ELEMENT_NODE) {
      const style = window.getComputedStyle(n);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0" ||
        n.hidden
      )
        return;
    }

    if (n.nodeType === Node.TEXT_NODE) {
      const text = n.textContent.trim();
      if (text) texts.push(text);
    }

    if (n.nodeType === Node.ELEMENT_NODE) {
      if (options.includeAria) {
        const ariaText = getAriaText(n);
        if (ariaText) texts.push(ariaText);
      }
      if (options.includePlaceholders && n.placeholder)
        texts.push(n.placeholder);
      if (options.includeValues && n.type !== "password" && n.value)
        texts.push(n.value);
      if (options.includeAlts && n.alt) texts.push(n.alt);
    }

    for (const child of n.childNodes) walk(child);
  }

  walk(node);
  return texts
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();
}
```

**Step 2: Add message listener for extraction trigger**

```js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "extractText") {
    const text = domToText();
    sendResponse({ text });
  }
  return true; // keep channel open for async
});
```

**Step 3: Test manually**

Load extension, open any web page, open DevTools on the extension's service worker, run:

```js
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  chrome.tabs.sendMessage(tabs[0].id, { action: "extractText" }, (r) =>
    console.log(r.text.slice(0, 500)),
  );
});
```

Verify text is extracted.

**Step 4: Commit**

```bash
git add extension/content.js
git commit -m "implement DOM text extraction adapted from RM scraper"
```

---

### Task 3: Background Service Worker -- Ollama Integration

**Files:**

- Modify: `extension/background.js`

**Step 1: Implement Ollama API helper**

```js
async function callOllama(prompt, systemPrompt, settings) {
  const endpoint = settings.ollamaEndpoint || "http://localhost:11434";
  const model = settings.ollamaModel || "qwen3";

  const response = await fetch(`${endpoint}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      system: systemPrompt,
      stream: false,
      options: { temperature: 0.3 },
    }),
  });

  if (!response.ok) throw new Error(`Ollama error: ${response.status}`);
  const data = await response.json();
  return data.response;
}
```

**Step 2: Implement summarize function**

```js
async function summarizePage(text, settings) {
  const truncated = text.slice(0, 4000);
  const systemPrompt = `You summarize web pages. Respond with exactly 3 bullet points.
Use keywords, phrases, analogies. Not full sentences.
Format: one bullet per line starting with "- ".
Example: "- distributed message broker like NATS but written in Rust"`;

  const raw = await callOllama(truncated, systemPrompt, settings);
  // Parse bullets
  const bullets = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- ") || l.startsWith("* "))
    .map((l) => l.replace(/^[-*]\s*/, ""))
    .slice(0, 3);

  return bullets.length ? bullets : [raw.trim()];
}
```

**Step 3: Implement relevance scoring function**

```js
async function scoreRelevance(summary, url, settings) {
  if (!settings.userProfile?.trim()) {
    return {
      score: 50,
      reasons: ["No user profile configured"],
      nextSteps: [],
    };
  }

  const systemPrompt = `You evaluate web page relevance to a user profile.
Respond ONLY with valid JSON, no other text.
Format: {"score": <0-100>, "reasons": ["..."], "next_steps": ["..."]}
If completely irrelevant, respond: {"score": 0, "reasons": [], "next_steps": []}
For GitHub project pages, suggest concrete next steps like cloning, comparing alternatives.`;

  const prompt = `User profile: ${settings.userProfile}

Page summary:
${summary.map((b) => "- " + b).join("\n")}

Page URL: ${url}`;

  const raw = await callOllama(prompt, systemPrompt, settings);

  // Extract JSON from response (may have markdown fences)
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch)
    return { score: 50, reasons: ["Could not parse response"], nextSteps: [] };

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      score: Math.max(0, Math.min(100, parsed.score || 0)),
      reasons: parsed.reasons || [],
      nextSteps: parsed.next_steps || [],
    };
  } catch {
    return { score: 50, reasons: ["Could not parse response"], nextSteps: [] };
  }
}
```

**Step 4: Implement full analysis pipeline + message handler**

```js
async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      {
        ollamaEndpoint: "http://localhost:11434",
        ollamaModel: "qwen3",
        userProfile: "",
        bookmarkEndpoint: "http://localhost:3377",
        autoShow: false,
        autoShowMode: "all",
        includePatterns: [],
        excludePatterns: [],
      },
      resolve,
    );
  });
}

async function analyzePage(text, url, tabId) {
  const settings = await getSettings();

  // Update badge to show processing
  chrome.action.setBadgeText({ text: "...", tabId });
  chrome.action.setBadgeBackgroundColor({ color: "#6b7280", tabId });

  try {
    const summary = await summarizePage(text, settings);
    const relevance = await scoreRelevance(summary, url, settings);

    // Set badge color based on score
    let badgeColor;
    if (relevance.score < 33) badgeColor = "#ef4444";
    else if (relevance.score < 67) badgeColor = "#6b7280";
    else badgeColor = "#22c55e";

    chrome.action.setBadgeText({ text: String(relevance.score), tabId });
    chrome.action.setBadgeBackgroundColor({ color: badgeColor, tabId });

    return { summary, relevance };
  } catch (err) {
    chrome.action.setBadgeText({ text: "ERR", tabId });
    chrome.action.setBadgeBackgroundColor({ color: "#ef4444", tabId });
    throw err;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "analyze") {
    analyzePage(msg.text, msg.url, msg.tabId)
      .then((result) => {
        sendResponse({ ok: true, ...result });
      })
      .catch((err) => {
        sendResponse({ ok: false, error: err.message });
      });
    return true; // async response
  }

  if (msg.action === "getSettings") {
    getSettings().then(sendResponse);
    return true;
  }
});
```

**Step 5: Test by triggering analysis from DevTools**

Open a page, open service worker DevTools, manually send message to content script to extract text, then feed it to analyzePage. Verify Ollama is called and returns results.

**Step 6: Commit**

```bash
git add extension/background.js
git commit -m "implement Ollama-powered summarization and relevance scoring"
```

---

### Task 4: Overlay UI (Content Script)

**Files:**

- Modify: `extension/content.js`

**Step 1: Implement overlay creation with shadow DOM**

```js
function createOverlay(data) {
  // Remove existing overlay
  const existing = document.getElementById("glance-overlay-host");
  if (existing) existing.remove();

  const host = document.createElement("div");
  host.id = "glance-overlay-host";
  host.style.cssText = "position:fixed;top:16px;right:16px;z-index:2147483647;";
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "closed" });

  const { summary, relevance } = data;
  const score = relevance.score;

  // Determine score color
  let scoreColor, scoreLabel;
  if (score < 33) {
    scoreColor = "#ef4444";
    scoreLabel = "Low";
  } else if (score < 67) {
    scoreColor = "#6b7280";
    scoreLabel = "Mid";
  } else {
    scoreColor = "#22c55e";
    scoreLabel = "High";
  }

  shadow.innerHTML = `
    <style>
      @keyframes glancePulse {
        0%, 100% { box-shadow: 0 4px 24px ${scoreColor}44; }
        50% { box-shadow: 0 4px 32px ${scoreColor}aa; }
      }
      :host { all: initial; }
      .glance-panel {
        font-family: system-ui, -apple-system, sans-serif;
        background: #1a1a2e;
        color: #e0e0e0;
        border-radius: 12px;
        padding: 16px;
        max-width: 360px;
        box-shadow: 0 4px 24px ${scoreColor}66;
        animation: glancePulse 0.8s ease-in-out 4;
        font-size: 13px;
        line-height: 1.5;
        transition: all 0.3s ease;
      }
      .glance-panel.collapsed {
        padding: 8px 12px;
        max-width: 80px;
        cursor: pointer;
      }
      .glance-panel.collapsed .glance-body { display: none; }
      .glance-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;
      }
      .glance-panel.collapsed .glance-header { margin-bottom: 0; }
      .glance-score {
        background: ${scoreColor};
        color: white;
        font-weight: 700;
        font-size: 14px;
        padding: 2px 8px;
        border-radius: 6px;
        min-width: 32px;
        text-align: center;
      }
      .glance-toggle {
        background: none; border: none; color: #888;
        cursor: pointer; font-size: 16px; padding: 0 4px;
      }
      .glance-toggle:hover { color: #ccc; }
      .glance-section { margin-bottom: 10px; }
      .glance-section-title {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #888;
        margin-bottom: 4px;
      }
      .glance-bullet {
        margin: 0;
        padding: 0 0 0 12px;
        list-style: none;
      }
      .glance-bullet li {
        position: relative;
        margin-bottom: 4px;
      }
      .glance-bullet li::before {
        content: '\\2022';
        position: absolute;
        left: -12px;
        color: ${scoreColor};
      }
      .glance-reason {
        color: #aaa;
        font-size: 12px;
      }
      .glance-actions {
        display: flex;
        gap: 8px;
        margin-top: 12px;
      }
      .glance-btn {
        background: #2a2a4a;
        color: #ccc;
        border: 1px solid #3a3a5a;
        border-radius: 6px;
        padding: 6px 12px;
        font-size: 12px;
        cursor: pointer;
        transition: background 0.2s;
      }
      .glance-btn:hover { background: #3a3a5a; }
      .glance-btn.saved { background: ${scoreColor}33; border-color: ${scoreColor}; color: ${scoreColor}; }
      .glance-close {
        position: absolute; top: 4px; right: 8px;
        background: none; border: none; color: #666;
        cursor: pointer; font-size: 14px;
      }
      .glance-close:hover { color: #aaa; }
    </style>
    <div class="glance-panel" id="panel">
      <div class="glance-header">
        <div class="glance-score">${score}</div>
        <button class="glance-toggle" id="toggle" title="Collapse">&#x25B4;</button>
      </div>
      <div class="glance-body">
        <div class="glance-section">
          <div class="glance-section-title">Summary</div>
          <ul class="glance-bullet">
            ${summary.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}
          </ul>
        </div>
        ${
          relevance.reasons.length
            ? `
        <div class="glance-section">
          <div class="glance-section-title">Relevance</div>
          <ul class="glance-bullet glance-reason">
            ${relevance.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}
          </ul>
        </div>`
            : ""
        }
        ${
          relevance.nextSteps.length
            ? `
        <div class="glance-section">
          <div class="glance-section-title">Next Steps</div>
          <ul class="glance-bullet">
            ${relevance.nextSteps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}
          </ul>
        </div>`
            : ""
        }
        <div class="glance-actions">
          <button class="glance-btn" id="saveBtn">Save</button>
          <button class="glance-btn" id="dismissBtn">Dismiss</button>
        </div>
      </div>
    </div>
  `;

  // Wire up interactions
  const panel = shadow.getElementById("panel");
  const toggle = shadow.getElementById("toggle");
  toggle.addEventListener("click", () => {
    const collapsed = panel.classList.toggle("collapsed");
    toggle.innerHTML = collapsed ? "&#x25BE;" : "&#x25B4;";
  });

  shadow
    .getElementById("dismissBtn")
    .addEventListener("click", () => host.remove());

  shadow.getElementById("saveBtn").addEventListener("click", () => {
    chrome.runtime.sendMessage(
      {
        action: "saveBookmark",
        url: location.href,
        title: document.title,
        summary,
        score,
      },
      (resp) => {
        const btn = shadow.getElementById("saveBtn");
        if (resp?.ok) {
          btn.textContent = "Saved";
          btn.classList.add("saved");
        } else {
          btn.textContent = "Error";
        }
      },
    );
  });

  // Check if already saved
  chrome.runtime.sendMessage(
    { action: "checkBookmark", url: location.href },
    (resp) => {
      if (resp?.found) {
        const btn = shadow.getElementById("saveBtn");
        btn.textContent = "Saved";
        btn.classList.add("saved");
      }
    },
  );
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
```

**Step 2: Add auto-show logic**

```js
async function checkAutoShow() {
  const settings = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: "getSettings" }, resolve);
  });
  if (!settings) return;
  if (!settings.autoShow) return;

  const url = location.href;

  if (settings.autoShowMode === "include") {
    const matches = settings.includePatterns.some((p) =>
      urlMatchesPattern(url, p),
    );
    if (!matches) return;
  } else if (settings.autoShowMode === "exclude") {
    const matches = settings.excludePatterns.some((p) =>
      urlMatchesPattern(url, p),
    );
    if (matches) return;
  }
  // mode 'all' always proceeds

  triggerAnalysis();
}

function urlMatchesPattern(url, pattern) {
  // Convert glob to regex: * -> .*, ? -> .
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(
    "^" + escaped.replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
    "i",
  );
  return regex.test(url);
}

function triggerAnalysis() {
  const text = domToText();
  chrome.runtime.sendMessage(
    {
      action: "analyze",
      text,
      url: location.href,
    },
    (response) => {
      if (response?.ok) {
        createOverlay(response);
      }
    },
  );
}

// Auto-show on load
checkAutoShow();
```

**Step 3: Also handle manual trigger from popup**

```js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "extractText") {
    sendResponse({ text: domToText() });
  } else if (msg.action === "showOverlay") {
    createOverlay(msg.data);
  } else if (msg.action === "triggerAnalysis") {
    triggerAnalysis();
  }
  return true;
});
```

**Step 4: Test overlay visually**

Load extension on a real page, trigger analysis via DevTools or by enabling auto-show. Verify overlay appears in top-right, shows summary/score/actions, pulse animation works, collapse/expand works, dismiss works.

**Step 5: Commit**

```bash
git add extension/content.js
git commit -m "implement overlay UI with shadow DOM, pulse animation, and auto-show"
```

---

### Task 5: Popup Settings UI

**Files:**

- Modify: `extension/popup.html`
- Modify: `extension/popup.js`
- Modify: `extension/popup.css`

**Step 1: Build popup HTML**

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Glance Settings</title>
    <link rel="stylesheet" href="popup.css" />
  </head>
  <body>
    <div class="popup">
      <header>
        <h1>Glance</h1>
        <button id="analyzeBtn" class="primary-btn">Analyze This Page</button>
      </header>

      <section>
        <h2>User Profile</h2>
        <textarea
          id="userProfile"
          rows="4"
          placeholder="Your interests, role, tech stack..."
        ></textarea>
      </section>

      <section>
        <h2>Ollama</h2>
        <div class="field">
          <label>Endpoint</label>
          <input
            type="text"
            id="ollamaEndpoint"
            placeholder="http://localhost:11434"
          />
        </div>
        <div class="field">
          <label>Model</label>
          <input type="text" id="ollamaModel" placeholder="qwen3" />
        </div>
      </section>

      <section>
        <h2>Auto-Show</h2>
        <div class="field row">
          <label>Enabled</label>
          <input type="checkbox" id="autoShow" />
        </div>
        <div id="autoShowConfig" class="indent">
          <div class="field">
            <label
              ><input type="radio" name="autoShowMode" value="all" checked />
              All pages</label
            >
          </div>
          <div class="field">
            <label
              ><input type="radio" name="autoShowMode" value="include" /> Only
              matching patterns</label
            >
          </div>
          <div class="field">
            <label
              ><input type="radio" name="autoShowMode" value="exclude" />
              Exclude matching patterns</label
            >
          </div>
        </div>
      </section>

      <section id="patternsSection">
        <h2>URL Patterns</h2>
        <div id="patternsList"></div>
        <div class="field row">
          <input
            type="text"
            id="newPattern"
            placeholder="https://github.com/*"
          />
          <button id="addPatternBtn" class="small-btn">Add</button>
        </div>
      </section>

      <section>
        <h2>Bookmark Server</h2>
        <div class="field">
          <label>Endpoint</label>
          <input
            type="text"
            id="bookmarkEndpoint"
            placeholder="http://localhost:3377"
          />
        </div>
      </section>

      <div class="status" id="status"></div>
    </div>
    <script src="popup.js"></script>
  </body>
</html>
```

**Step 2: Build popup CSS**

```css
body {
  width: 380px;
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
  padding: 0;
  margin: 0;
  background: #1a1a2e;
  color: #e0e0e0;
  font-size: 13px;
}

.popup {
  padding: 16px;
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

h1 {
  font-size: 18px;
  margin: 0;
  font-weight: 700;
}
h2 {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #888;
  margin: 12px 0 8px;
}

section {
  margin-bottom: 8px;
}

.field {
  margin-bottom: 6px;
}
.field label {
  display: block;
  font-size: 11px;
  color: #888;
  margin-bottom: 2px;
}
.field.row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.field.row label {
  margin-bottom: 0;
}
.indent {
  padding-left: 16px;
}

input[type="text"],
textarea {
  width: 100%;
  background: #2a2a4a;
  border: 1px solid #3a3a5a;
  border-radius: 6px;
  color: #e0e0e0;
  padding: 6px 8px;
  font-size: 13px;
  font-family: inherit;
  box-sizing: border-box;
}

input[type="text"]:focus,
textarea:focus {
  outline: none;
  border-color: #5a5aaa;
}

textarea {
  resize: vertical;
}

input[type="checkbox"] {
  accent-color: #22c55e;
}

.primary-btn {
  background: #3a3a6a;
  color: #e0e0e0;
  border: none;
  border-radius: 6px;
  padding: 8px 16px;
  font-size: 13px;
  cursor: pointer;
  font-weight: 600;
}
.primary-btn:hover {
  background: #4a4a8a;
}

.small-btn {
  background: #2a2a4a;
  color: #ccc;
  border: 1px solid #3a3a5a;
  border-radius: 4px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.small-btn:hover {
  background: #3a3a5a;
}

.pattern-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  background: #2a2a4a;
  border-radius: 4px;
  margin-bottom: 4px;
  font-size: 12px;
  font-family: monospace;
}

.pattern-item button {
  background: none;
  border: none;
  color: #ef4444;
  cursor: pointer;
  font-size: 14px;
  padding: 0 4px;
}

.status {
  font-size: 11px;
  color: #22c55e;
  min-height: 16px;
  margin-top: 8px;
}
```

**Step 3: Build popup JS**

```js
const fields = {
  userProfile: "textarea",
  ollamaEndpoint: "text",
  ollamaModel: "text",
  autoShow: "checkbox",
  bookmarkEndpoint: "text",
};

const defaults = {
  userProfile: "",
  ollamaEndpoint: "http://localhost:11434",
  ollamaModel: "qwen3",
  autoShow: false,
  autoShowMode: "all",
  includePatterns: [],
  excludePatterns: [],
  bookmarkEndpoint: "http://localhost:3377",
};

// Load settings
chrome.storage.sync.get(defaults, (settings) => {
  for (const [key, type] of Object.entries(fields)) {
    const el = document.getElementById(key);
    if (type === "checkbox") el.checked = settings[key];
    else el.value = settings[key];
  }

  // Auto-show mode radio
  const radio = document.querySelector(
    `input[name="autoShowMode"][value="${settings.autoShowMode}"]`,
  );
  if (radio) radio.checked = true;

  // Patterns
  renderPatterns(
    settings.autoShowMode === "include"
      ? settings.includePatterns
      : settings.excludePatterns,
  );
  updatePatternsVisibility(settings.autoShow, settings.autoShowMode);
});

// Auto-save on change
function save() {
  const data = {};
  for (const [key, type] of Object.entries(fields)) {
    const el = document.getElementById(key);
    data[key] = type === "checkbox" ? el.checked : el.value;
  }
  data.autoShowMode =
    document.querySelector('input[name="autoShowMode"]:checked')?.value ||
    "all";

  // Preserve both pattern arrays
  chrome.storage.sync.get(
    ["includePatterns", "excludePatterns"],
    (existing) => {
      chrome.storage.sync.set({ ...existing, ...data }, () => {
        showStatus("Saved");
      });
    },
  );
}

// Debounced save
let saveTimer;
function debouncedSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
}

// Wire up inputs
for (const key of Object.keys(fields)) {
  const el = document.getElementById(key);
  el.addEventListener("input", debouncedSave);
  el.addEventListener("change", debouncedSave);
}
document.querySelectorAll('input[name="autoShowMode"]').forEach((r) => {
  r.addEventListener("change", () => {
    const mode = r.value;
    chrome.storage.sync.get(defaults, (settings) => {
      renderPatterns(
        mode === "include"
          ? settings.includePatterns
          : settings.excludePatterns,
      );
    });
    updatePatternsVisibility(document.getElementById("autoShow").checked, mode);
    debouncedSave();
  });
});

document.getElementById("autoShow").addEventListener("change", function () {
  const mode =
    document.querySelector('input[name="autoShowMode"]:checked')?.value ||
    "all";
  updatePatternsVisibility(this.checked, mode);
});

function updatePatternsVisibility(autoShowEnabled, mode) {
  document.getElementById("autoShowConfig").style.display = autoShowEnabled
    ? ""
    : "none";
  document.getElementById("patternsSection").style.display =
    autoShowEnabled && (mode === "include" || mode === "exclude") ? "" : "none";
}

// Patterns CRUD
function renderPatterns(patterns) {
  const list = document.getElementById("patternsList");
  list.innerHTML = patterns
    .map(
      (p, i) => `
    <div class="pattern-item">
      <span>${p}</span>
      <button data-index="${i}" title="Remove">&times;</button>
    </div>
  `,
    )
    .join("");
  list.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () =>
      removePattern(parseInt(btn.dataset.index)),
    );
  });
}

function getActivePatternKey() {
  const mode =
    document.querySelector('input[name="autoShowMode"]:checked')?.value ||
    "all";
  return mode === "include" ? "includePatterns" : "excludePatterns";
}

document.getElementById("addPatternBtn").addEventListener("click", () => {
  const input = document.getElementById("newPattern");
  const val = input.value.trim();
  if (!val) return;
  const key = getActivePatternKey();
  chrome.storage.sync.get({ [key]: [] }, (data) => {
    data[key].push(val);
    chrome.storage.sync.set(data, () => {
      input.value = "";
      renderPatterns(data[key]);
      showStatus("Pattern added");
    });
  });
});

function removePattern(index) {
  const key = getActivePatternKey();
  chrome.storage.sync.get({ [key]: [] }, (data) => {
    data[key].splice(index, 1);
    chrome.storage.sync.set(data, () => {
      renderPatterns(data[key]);
      showStatus("Pattern removed");
    });
  });
}

// Analyze button
document.getElementById("analyzeBtn").addEventListener("click", () => {
  showStatus("Analyzing...");
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, { action: "triggerAnalysis" });
    showStatus("Analysis triggered");
    setTimeout(() => window.close(), 500);
  });
});

function showStatus(msg) {
  const el = document.getElementById("status");
  el.textContent = msg;
  setTimeout(() => {
    el.textContent = "";
  }, 2000);
}
```

**Step 4: Test popup**

Open popup, configure settings, verify they persist. Add/remove URL patterns. Click "Analyze This Page" and verify analysis triggers.

**Step 5: Commit**

```bash
git add extension/popup.html extension/popup.js extension/popup.css
git commit -m "implement settings popup with profile, Ollama config, auto-show, and URL patterns"
```

---

### Task 6: Bookmark Server Stub

**Files:**

- Create: `server/package.json`
- Create: `server/index.js`

**Step 1: Create package.json**

```json
{
  "name": "glance-bookmark-server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node index.js",
    "dev": "node --watch index.js"
  },
  "dependencies": {
    "express": "^5.1.0",
    "cors": "^2.8.5"
  }
}
```

**Step 2: Create server**

```js
import express from "express";
import cors from "cors";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";

const DATA_DIR = join(homedir(), ".glance");
const DATA_FILE = join(DATA_DIR, "bookmarks.json");
const PORT = process.env.PORT || 3377;

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

function loadBookmarks() {
  if (!existsSync(DATA_FILE)) return [];
  return JSON.parse(readFileSync(DATA_FILE, "utf8"));
}

function saveBookmarks(bookmarks) {
  writeFileSync(DATA_FILE, JSON.stringify(bookmarks, null, 2));
}

const app = express();
app.use(cors());
app.use(express.json());

// Check if URL is saved
app.get("/bookmarks", (req, res) => {
  const bookmarks = loadBookmarks();
  const { url } = req.query;
  if (url) {
    const bookmark = bookmarks.find((b) => b.url === url);
    return res.json({ found: !!bookmark, bookmark: bookmark || null });
  }
  // Paginated list
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const start = (page - 1) * limit;
  res.json({
    bookmarks: bookmarks.slice(start, start + limit),
    total: bookmarks.length,
    page,
    limit,
  });
});

// Save bookmark
app.post("/bookmarks", (req, res) => {
  const bookmarks = loadBookmarks();
  const { url, title, summary, score, notes } = req.body;
  if (!url) return res.status(400).json({ error: "url required" });

  // Upsert by URL
  const existing = bookmarks.findIndex((b) => b.url === url);
  const bookmark = {
    id: existing >= 0 ? bookmarks[existing].id : randomUUID(),
    url,
    title: title || "",
    summary: summary || [],
    score: score ?? null,
    notes: notes || "",
    createdAt:
      existing >= 0 ? bookmarks[existing].createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (existing >= 0) bookmarks[existing] = bookmark;
  else bookmarks.push(bookmark);

  saveBookmarks(bookmarks);
  res.json({ ok: true, bookmark });
});

// Update bookmark
app.patch("/bookmarks/:id", (req, res) => {
  const bookmarks = loadBookmarks();
  const idx = bookmarks.findIndex((b) => b.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: "not found" });

  const allowed = ["notes", "summary", "score", "title"];
  for (const key of allowed) {
    if (req.body[key] !== undefined) bookmarks[idx][key] = req.body[key];
  }
  bookmarks[idx].updatedAt = new Date().toISOString();

  saveBookmarks(bookmarks);
  res.json({ ok: true, bookmark: bookmarks[idx] });
});

// Delete bookmark
app.delete("/bookmarks/:id", (req, res) => {
  const bookmarks = loadBookmarks();
  const idx = bookmarks.findIndex((b) => b.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: "not found" });
  bookmarks.splice(idx, 1);
  saveBookmarks(bookmarks);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Glance bookmark server running on http://localhost:${PORT}`);
});
```

**Step 3: Install dependencies and test**

```bash
cd server && npm install && npm run dev
```

Test with curl:

```bash
curl -s http://localhost:3377/bookmarks | jq
curl -s -X POST http://localhost:3377/bookmarks -H 'Content-Type: application/json' -d '{"url":"https://example.com","title":"Test","summary":["test bullet"],"score":75}' | jq
curl -s 'http://localhost:3377/bookmarks?url=https://example.com' | jq
```

**Step 4: Commit**

```bash
git add server/
git commit -m "implement bookmark stub server with Express and JSON file storage"
```

---

### Task 7: Wire Bookmark API into Background Worker

**Files:**

- Modify: `extension/background.js`

**Step 1: Add bookmark API handlers to the message listener**

```js
async function checkBookmark(url, settings) {
  const endpoint = settings.bookmarkEndpoint || "http://localhost:3377";
  const resp = await fetch(
    `${endpoint}/bookmarks?url=${encodeURIComponent(url)}`,
  );
  if (!resp.ok) return { found: false };
  return resp.json();
}

async function saveBookmark(data, settings) {
  const endpoint = settings.bookmarkEndpoint || "http://localhost:3377";
  const resp = await fetch(`${endpoint}/bookmarks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!resp.ok) throw new Error(`Save failed: ${resp.status}`);
  return resp.json();
}

// Add to existing onMessage listener:
// 'checkBookmark' -> checkBookmark(msg.url, settings)
// 'saveBookmark' -> saveBookmark({url, title, summary, score}, settings)
```

Merge these cases into the existing `chrome.runtime.onMessage.addListener` block.

**Step 2: Test save flow end-to-end**

Start bookmark server, analyze a page, click Save button in overlay, verify bookmark appears in server data.

**Step 3: Commit**

```bash
git add extension/background.js
git commit -m "wire bookmark check and save into background service worker"
```

---

### Task 8: Extension Icons

**Files:**

- Create: `extension/icons/icon16.png`
- Create: `extension/icons/icon48.png`
- Create: `extension/icons/icon128.png`

**Step 1: Generate icons programmatically**

Use a script or Canvas API to generate simple "G" letter icons in the extension's dark theme color. If ImageMagick (`convert`) is available:

```bash
for size in 16 48 128; do
  convert -size ${size}x${size} xc:'#1a1a2e' \
    -fill '#22c55e' -font Helvetica-Bold \
    -gravity center -pointsize $((size * 6 / 10)) \
    -annotate 0 'G' \
    extension/icons/icon${size}.png
done
```

If ImageMagick not available, generate minimal PNGs via a Node script using canvas or just create placeholder files.

**Step 2: Commit**

```bash
git add extension/icons/
git commit -m "add extension icons"
```

---

### Task 9: End-to-End Testing and Polish

**Step 1: Start bookmark server**

```bash
cd server && npm run dev
```

**Step 2: Ensure Ollama is running with Qwen3**

```bash
ollama list    # check if qwen3 is available
ollama run qwen3 "hello"   # quick test
```

**Step 3: Load extension in Chrome**

`chrome://extensions` -> Developer Mode -> Load Unpacked -> select `extension/` dir

**Step 4: Test full flow**

1. Open a web page (e.g. a GitHub project page)
2. Click Glance icon -> Click "Analyze This Page"
3. Verify overlay appears with summary, score, reasons, next steps
4. Verify pulse animation on shadow
5. Verify score badge on extension icon
6. Click collapse/expand
7. Click Save, verify bookmark server received it
8. Reload page, verify "Saved" state shows
9. Click Dismiss

**Step 5: Test auto-show**

1. Open popup, enable auto-show, set to "all pages"
2. Navigate to a new page
3. Verify overlay auto-appears

**Step 6: Test URL patterns**

1. Set auto-show to "only matching", add pattern `https://github.com/*`
2. Navigate to GitHub -> overlay should appear
3. Navigate to other site -> overlay should NOT appear

**Step 7: Fix any issues found during testing**

**Step 8: Final commit**

```bash
git add -A
git commit -m "polish and end-to-end testing fixes"
```
