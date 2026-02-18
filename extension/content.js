// Glance content script - DOM text extraction

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

// --- Overlay UI ---

const GLANCE_POSITION =
  "position:fixed;bottom:16px;right:16px;z-index:2147483647;";

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function getOrCreateHost() {
  let host = document.getElementById("glance-overlay-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "glance-overlay-host";
    host.style.cssText = GLANCE_POSITION;
    document.body.appendChild(host);
  }
  return host;
}

function showLoadingOverlay() {
  const existing = document.getElementById("glance-overlay-host");
  if (existing) existing.remove();

  const host = getOrCreateHost();
  const shadow = host.attachShadow({ mode: "closed" });
  host._shadow = shadow;

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      @keyframes glanceSpin {
        to { transform: rotate(360deg); }
      }
      .glance-loading {
        font-family: system-ui, -apple-system, sans-serif;
        background: #1a1a2e;
        color: #e0e0e0;
        border-radius: 12px;
        padding: 16px 20px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.4);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        width: 180px;
      }
      .glance-loading-title {
        font-size: 10px;
        color: #555;
        font-style: italic;
        letter-spacing: 0.02em;
      }
      .glance-spinner {
        width: 24px;
        height: 24px;
        border: 3px solid #2a2a4a;
        border-top-color: #3b82f6;
        border-radius: 50%;
        animation: glanceSpin 0.8s linear infinite;
      }
      .glance-loading-label {
        font-size: 11px;
        color: #888;
      }
    </style>
    <div class="glance-loading">
      <div class="glance-loading-title">At a Glance...</div>
      <div class="glance-spinner"></div>
      <div class="glance-loading-label">assessing relevance...</div>
    </div>
  `;

  return host;
}

function showErrorOverlay(message) {
  const existing = document.getElementById("glance-overlay-host");
  if (existing) existing.remove();

  const host = getOrCreateHost();
  const shadow = host.attachShadow({ mode: "closed" });

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .glance-error {
        font-family: system-ui, -apple-system, sans-serif;
        background: #1a1a2e;
        color: #e0e0e0;
        border-radius: 12px;
        padding: 14px 18px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.4);
        width: 240px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .glance-error-title {
        font-size: 10px;
        color: #555;
        font-style: italic;
      }
      .glance-error-msg {
        font-size: 12px;
        color: #ef4444;
      }
      .glance-error-dismiss {
        background: none;
        border: none;
        color: #666;
        font-size: 11px;
        cursor: pointer;
        padding: 0;
        text-align: left;
      }
      .glance-error-dismiss:hover { color: #aaa; }
    </style>
    <div class="glance-error">
      <div class="glance-error-title">At a Glance...</div>
      <div class="glance-error-msg">${escapeHtml(message)}</div>
      <button class="glance-error-dismiss" id="dismiss">dismiss</button>
    </div>
  `;

  shadow
    .getElementById("dismiss")
    .addEventListener("click", () => host.remove());
}

function createOverlay(data) {
  const existing = document.getElementById("glance-overlay-host");
  if (existing) existing.remove();

  const host = getOrCreateHost();

  const shadow = host.attachShadow({ mode: "closed" });

  const { summary, relevance } = data;
  const score = relevance.score;
  const label =
    relevance.label ||
    (score <= 25
      ? "irrelevant"
      : score <= 50
        ? "mildly relevant"
        : score <= 75
          ? "relevant"
          : "very relevant");
  const projectRelevance = relevance.projectRelevance || {};
  const projectKeys = Object.keys(projectRelevance);

  // Meter color based on label
  let meterColor;
  if (label === "irrelevant") meterColor = "#ef4444";
  else if (label === "mildly relevant") meterColor = "#f59e0b";
  else if (label === "relevant") meterColor = "#3b82f6";
  else meterColor = "#22c55e";

  // Saved-state button color (always green for saved)
  const savedColor = "#22c55e";

  shadow.innerHTML = `
    <style>
      @keyframes glancePulse {
        0%, 100% { box-shadow: 0 4px 20px rgba(0,0,0,0.4); }
        50% { box-shadow: 0 6px 28px rgba(0,0,0,0.55); }
      }
      :host { all: initial; }
      .glance-panel {
        font-family: system-ui, -apple-system, sans-serif;
        background: #1a1a2e;
        color: #e0e0e0;
        border-radius: 12px;
        padding: 0;
        width: 340px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.4);
        animation: glancePulse 0.8s ease-in-out 4;
        font-size: 13px;
        line-height: 1.5;
        transition: all 0.3s ease;
        overflow: hidden;
      }
      .glance-panel.collapsed {
        width: auto;
        cursor: pointer;
      }
      .glance-panel.collapsed .glance-body { display: none; }
      .glance-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        background: #16162a;
        border-bottom: 1px solid #2a2a4a;
      }
      .glance-header-left {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .glance-label {
        font-size: 12px;
        font-weight: 600;
        color: ${meterColor};
        text-transform: capitalize;
      }
      .glance-toggle {
        background: none; border: none; color: #666;
        cursor: pointer; font-size: 14px; padding: 2px 4px;
      }
      .glance-toggle:hover { color: #aaa; }
      .glance-body {
        max-height: 420px;
        overflow-y: auto;
        padding: 12px 14px;
        scrollbar-width: thin;
        scrollbar-color: #3a3a5a #1a1a2e;
      }
      .glance-body::-webkit-scrollbar { width: 5px; }
      .glance-body::-webkit-scrollbar-track { background: #1a1a2e; }
      .glance-body::-webkit-scrollbar-thumb { background: #3a3a5a; border-radius: 3px; }

      .glance-meter-wrap { margin-bottom: 12px; }
      .glance-meter-track {
        height: 6px;
        background: #2a2a4a;
        border-radius: 3px;
        overflow: hidden;
      }
      .glance-meter-fill {
        height: 100%;
        width: ${score}%;
        background: ${meterColor};
        border-radius: 3px;
        transition: width 0.6s ease;
      }

      .glance-section { margin-bottom: 10px; }
      .glance-section-title {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #666;
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
        color: #555;
      }
      .glance-reason { color: #999; font-size: 12px; }

      .glance-projects { margin-bottom: 10px; }
      .glance-project {
        display: flex;
        gap: 6px;
        margin-bottom: 4px;
        font-size: 12px;
      }
      .glance-project-name {
        color: ${meterColor};
        font-weight: 600;
        white-space: nowrap;
        flex-shrink: 0;
      }
      .glance-project-name::after { content: ':'; }
      .glance-project-why { color: #aaa; }

      .glance-actions {
        display: flex;
        gap: 8px;
        padding-top: 8px;
        border-top: 1px solid #2a2a4a;
        margin-top: 4px;
      }
      .glance-btn {
        background: #2a2a4a;
        color: #999;
        border: 1px solid #3a3a5a;
        border-radius: 6px;
        padding: 5px 12px;
        font-size: 11px;
        cursor: pointer;
        transition: background 0.2s;
      }
      .glance-btn:hover { background: #3a3a5a; color: #ccc; }
      .glance-btn.saved { background: ${savedColor}22; border-color: ${savedColor}66; color: ${savedColor}; }

      details { margin: 0; }
      details summary {
        cursor: pointer;
        font-size: 11px;
        color: #666;
        padding: 6px 0 2px;
        list-style: none;
        user-select: none;
      }
      details summary::-webkit-details-marker { display: none; }
      details summary::before {
        content: '\\25B6';
        display: inline-block;
        margin-right: 6px;
        font-size: 8px;
        transition: transform 0.2s;
        color: #555;
      }
      details[open] summary::before {
        transform: rotate(90deg);
      }
      details[open] .glance-details-body {
        animation: glanceSlideIn 0.15s ease;
      }
      @keyframes glanceSlideIn {
        from { opacity: 0; transform: translateY(-4px); }
        to { opacity: 1; transform: translateY(0); }
      }
    </style>
    <div class="glance-panel" id="panel">
      <div class="glance-header">
        <div class="glance-header-left">
          <span style="font-size:10px;color:#555;font-style:italic;">At a Glance...</span>
          <span class="glance-label">${escapeHtml(label)}</span>
        </div>
        <button class="glance-toggle" id="toggle" title="Dismiss">&times;</button>
      </div>
      <div class="glance-body">
        <div class="glance-meter-wrap">
          <div class="glance-meter-track">
            <div class="glance-meter-fill"></div>
          </div>
        </div>

        <details>
          <summary>Details</summary>
          <div class="glance-details-body">

        <div class="glance-section">
          <div class="glance-section-title">Summary</div>
          <ul class="glance-bullet">
            ${summary.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}
          </ul>
        </div>

        ${
          projectKeys.length
            ? `
        <div class="glance-section glance-projects">
          <div class="glance-section-title">Your Projects</div>
          ${projectKeys
            .map(
              (name) => `
            <div class="glance-project">
              <span class="glance-project-name">${escapeHtml(name)}</span>
              <span class="glance-project-why">${escapeHtml(projectRelevance[name])}</span>
            </div>
          `,
            )
            .join("")}
        </div>`
            : ""
        }

        ${
          relevance.reasons.length
            ? `
        <div class="glance-section">
          <div class="glance-section-title">Why</div>
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
        </div>

          </div>
        </details>
      </div>
    </div>
  `;

  const toggle = shadow.getElementById("toggle");
  toggle.addEventListener("click", () => host.remove());

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

// --- Auto-show logic ---

function urlMatchesPattern(url, pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(
    "^" + escaped.replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
    "i",
  );
  return regex.test(url);
}

function triggerAnalysis() {
  showLoadingOverlay();
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
      } else {
        showErrorOverlay(response?.error || "Analysis failed");
      }
    },
  );
}

async function checkAutoShow() {
  const settings = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: "getSettings" }, resolve);
  });
  if (!settings || !settings.autoShow) return;

  const url = location.href;

  if (settings.autoShowMode === "include") {
    if (!settings.includePatterns.some((p) => urlMatchesPattern(url, p)))
      return;
  } else if (settings.autoShowMode === "exclude") {
    if (settings.excludePatterns.some((p) => urlMatchesPattern(url, p))) return;
  }

  triggerAnalysis();
}

// --- Message handler ---

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

// Auto-show on load
checkAutoShow();
