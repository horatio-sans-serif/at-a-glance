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
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        background: #1c1c1c;
        color: #d4d4d4;
        border-radius: 10px;
        padding: 16px 20px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        width: 180px;
      }
      .glance-loading-title {
        font-size: 11px;
        color: #888;
        font-weight: 500;
      }
      .glance-spinner {
        width: 22px;
        height: 22px;
        border: 2px solid #333;
        border-top-color: #888;
        border-radius: 50%;
        animation: glanceSpin 0.7s linear infinite;
      }
      .glance-loading-label {
        font-size: 11px;
        color: #aaa;
      }
    </style>
    <div class="glance-loading">
      <div class="glance-loading-title">At a Glance</div>
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
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        background: #1c1c1c;
        color: #d4d4d4;
        border-radius: 10px;
        padding: 14px 18px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        width: 240px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .glance-error-title {
        font-size: 11px;
        color: #888;
        font-weight: 500;
      }
      .glance-error-msg {
        font-size: 12px;
        color: #ef4444;
        line-height: 1.4;
      }
      .glance-error-dismiss {
        background: none;
        border: none;
        color: #555;
        font-size: 11px;
        cursor: pointer;
        padding: 0;
        text-align: left;
      }
      .glance-error-dismiss:hover { color: #999; }
    </style>
    <div class="glance-error">
      <div class="glance-error-title">At a Glance</div>
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
  const findings = relevance.findings || [];
  const projectFindings = findings.filter((f) => f.type === "project");
  const interestFindings = findings.filter((f) => f.type === "interest");
  const isLearning = relevance.isLearning || false;

  let accentColor;
  if (label === "irrelevant") accentColor = "#ef4444";
  else if (label === "mildly relevant") accentColor = "#e0a030";
  else if (label === "relevant") accentColor = "#4a9eff";
  else accentColor = "#34d399";

  function renderFinding(f, index) {
    const typeLabel = f.type === "project" ? "Project" : "Interest";
    return `
      <div class="glance-finding">
        <div class="glance-finding-header">
          <span class="glance-finding-type">${typeLabel}</span>
          <span class="glance-finding-name">${escapeHtml(f.name)}</span>
        </div>
        <ul class="glance-finding-rationale">
          ${f.rationale.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}
        </ul>
        <button class="glance-copy-btn" data-finding-idx="${index}">Copy Claude Instructions</button>
      </div>`;
  }

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }

      .glance-panel {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        background: #1c1c1c;
        color: ${accentColor};
        border-radius: 10px;
        width: 340px;
        box-shadow: 0 4px 24px rgba(0,0,0,0.5);
        font-size: 13px;
        line-height: 1.5;
        overflow: hidden;
        padding: 14px 16px;
      }

      .glance-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 10px;
      }
      .glance-header-left {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .glance-title {
        font-size: 11px;
        color: #888;
        font-weight: 500;
      }
      .glance-label {
        font-size: 12px;
        font-weight: 600;
        color: ${accentColor};
      }
      ${
        isLearning
          ? `.glance-learning-badge {
        font-size: 9px;
        font-weight: 600;
        padding: 1px 6px;
        border-radius: 3px;
        background: ${accentColor}18;
        color: ${accentColor};
        border: 1px solid ${accentColor}40;
      }`
          : ""
      }
      .glance-dismiss {
        background: none; border: none; color: #666;
        cursor: pointer; font-size: 16px; padding: 0 2px;
        line-height: 1;
      }
      .glance-dismiss:hover { color: #ccc; }

      .glance-body {
        max-height: 420px;
        overflow-y: auto;
        scrollbar-width: thin;
        scrollbar-color: #333 #1c1c1c;
      }
      .glance-body::-webkit-scrollbar { width: 4px; }
      .glance-body::-webkit-scrollbar-track { background: transparent; }
      .glance-body::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }

      .glance-section { margin-bottom: 10px; }
      .glance-section:last-child { margin-bottom: 0; }
      .glance-section-label {
        font-size: 11px;
        color: #fff;
        margin-bottom: 4px;
        font-weight: 500;
      }

      ul.glance-bullets {
        margin: 0;
        padding: 0 0 0 18px;
        list-style: none;
      }
      ul.glance-bullets li {
        position: relative;
        margin-bottom: 3px;
        color: ${accentColor};
        font-size: 12px;
        line-height: 1.45;
      }
      ul.glance-bullets li::before {
        content: '\\2022';
        position: absolute;
        left: -14px;
        font-size: 16px;
        line-height: 1.1;
        color: ${accentColor};
      }

      .glance-finding {
        background: #242424;
        border: 1px solid #2e2e2e;
        border-radius: 6px;
        padding: 8px 10px;
        margin-bottom: 6px;
      }
      .glance-finding-header {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 4px;
      }
      .glance-finding-type {
        font-size: 10px;
        font-weight: 500;
        padding: 1px 5px;
        border-radius: 3px;
        background: #2e2e2e;
        color: ${accentColor};
      }
      .glance-finding-name {
        font-size: 12px;
        font-weight: 600;
        color: #fff;
        flex: 1;
      }
      .glance-copy-btn {
        font-size: 11px;
        font-weight: 500;
        padding: 4px 10px;
        border-radius: 4px;
        border: 1px solid #333;
        background: transparent;
        color: ${accentColor};
        cursor: pointer;
        transition: all 0.15s;
        margin-top: 6px;
        width: 100%;
        text-align: center;
      }
      .glance-copy-btn:hover { border-color: #555; color: #eee; }
      .glance-copy-btn.copied {
        border-color: #34d399;
        color: #34d399;
      }
      .glance-finding-rationale {
        margin: 0;
        padding: 0 0 0 18px;
        list-style: none;
      }
      .glance-finding-rationale li {
        position: relative;
        margin-bottom: 3px;
        font-size: 12px;
        color: ${accentColor};
        line-height: 1.4;
      }
      .glance-finding-rationale li::before {
        content: '\\2022';
        position: absolute;
        left: -14px;
        font-size: 16px;
        line-height: 1.1;
        color: ${accentColor};
      }
    </style>
    <div class="glance-panel">
      <div class="glance-header">
        <div class="glance-header-left">
          <span class="glance-title">At a Glance</span>
          <span class="glance-label">${escapeHtml(label)}</span>
          ${isLearning ? '<span class="glance-learning-badge">Tutorial</span>' : ""}
        </div>
        <button class="glance-dismiss" id="toggle" title="Dismiss">&times;</button>
      </div>
      <div class="glance-body">

        <div class="glance-section">
          <div class="glance-section-label">Summary</div>
          <ul class="glance-bullets">
            ${summary.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}
          </ul>
        </div>

        ${
          projectFindings.length
            ? `
        <div class="glance-section">
          <div class="glance-section-label">Projects</div>
          ${projectFindings.map((f) => renderFinding(f, findings.indexOf(f))).join("")}
        </div>`
            : ""
        }

        ${
          interestFindings.length
            ? `
        <div class="glance-section">
          <div class="glance-section-label">Interests</div>
          ${interestFindings.map((f) => renderFinding(f, findings.indexOf(f))).join("")}
        </div>`
            : ""
        }

        ${
          relevance.reasons.length
            ? `
        <div class="glance-section">
          <div class="glance-section-label">Why</div>
          <ul class="glance-bullets">
            ${relevance.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}
          </ul>
        </div>`
            : ""
        }

        ${
          relevance.nextSteps.length
            ? `
        <div class="glance-section">
          <div class="glance-section-label">Next Steps</div>
          <ul class="glance-bullets">
            ${relevance.nextSteps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}
          </ul>
        </div>`
            : ""
        }

      </div>
    </div>
  `;

  // Dismiss
  shadow
    .getElementById("toggle")
    .addEventListener("click", () => host.remove());

  // Copy buttons
  shadow.querySelectorAll(".glance-copy-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.findingIdx);
      const finding = findings[idx];
      if (finding?.claudeCodePrompt) {
        navigator.clipboard.writeText(finding.claudeCodePrompt).then(() => {
          btn.textContent = "Copied";
          btn.classList.add("copied");
          setTimeout(() => {
            btn.textContent = "Copy";
            btn.classList.remove("copied");
          }, 2000);
        });
      }
    });
  });
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

let _analysisInFlight = false;

function triggerAnalysis() {
  if (_analysisInFlight) return;
  _analysisInFlight = true;
  showLoadingOverlay();
  const text = domToText();
  chrome.runtime.sendMessage(
    {
      action: "analyze",
      text,
      url: location.href,
    },
    (response) => {
      _analysisInFlight = false;
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

  // Exclude patterns always skip matching URLs
  if (settings.excludePatterns?.length > 0) {
    if (settings.excludePatterns.some((p) => urlMatchesPattern(url, p))) return;
  }

  // If include patterns exist, URL must match at least one
  if (settings.includePatterns?.length > 0) {
    if (!settings.includePatterns.some((p) => urlMatchesPattern(url, p)))
      return;
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
