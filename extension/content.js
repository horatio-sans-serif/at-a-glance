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

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function createOverlay(data) {
  const existing = document.getElementById("glance-overlay-host");
  if (existing) existing.remove();

  const host = document.createElement("div");
  host.id = "glance-overlay-host";
  host.style.cssText = "position:fixed;top:16px;right:16px;z-index:2147483647;";
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "closed" });

  const { summary, relevance } = data;
  const score = relevance.score;

  let scoreColor;
  if (score < 33) scoreColor = "#ef4444";
  else if (score < 67) scoreColor = "#6b7280";
  else scoreColor = "#22c55e";

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
      .glance-reason { color: #aaa; font-size: 12px; }
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
