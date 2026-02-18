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
  includePatterns: [],
  excludePatterns: [],
  bookmarkEndpoint: "http://localhost:3377",
};

chrome.storage.sync.get(defaults, (settings) => {
  for (const [key, type] of Object.entries(fields)) {
    const el = document.getElementById(key);
    if (type === "checkbox") el.checked = settings[key];
    else el.value = settings[key];
  }

  renderPatterns("include", settings.includePatterns);
  renderPatterns("exclude", settings.excludePatterns);
  updateAutoShowVisibility(settings.autoShow);
});

function save() {
  const data = {};
  for (const [key, type] of Object.entries(fields)) {
    const el = document.getElementById(key);
    data[key] = type === "checkbox" ? el.checked : el.value;
  }

  chrome.storage.sync.get(
    ["includePatterns", "excludePatterns"],
    (existing) => {
      chrome.storage.sync.set({ ...existing, ...data }, () => {
        showStatus("Saved");
      });
    },
  );
}

let saveTimer;
function debouncedSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
}

for (const key of Object.keys(fields)) {
  const el = document.getElementById(key);
  el.addEventListener("input", debouncedSave);
  el.addEventListener("change", debouncedSave);
}

document.getElementById("autoShow").addEventListener("change", function () {
  updateAutoShowVisibility(this.checked);
});

function updateAutoShowVisibility(enabled) {
  document.getElementById("autoShowConfig").style.display = enabled
    ? ""
    : "none";
}

function renderPatterns(which, patterns) {
  const list = document.getElementById(`${which}PatternsList`);
  list.innerHTML = patterns
    .map(
      (p, i) => `
    <div class="pattern-item">
      <span>${p}</span>
      <button data-which="${which}" data-index="${i}" title="Remove">&times;</button>
    </div>
  `,
    )
    .join("");
  list.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () =>
      removePattern(btn.dataset.which, parseInt(btn.dataset.index)),
    );
  });
}

function addPattern(which) {
  const input = document.getElementById(
    which === "include" ? "newIncludePattern" : "newExcludePattern",
  );
  const val = input.value.trim();
  if (!val) return;
  const key = `${which}Patterns`;
  chrome.storage.sync.get({ [key]: [] }, (data) => {
    data[key].push(val);
    chrome.storage.sync.set(data, () => {
      input.value = "";
      renderPatterns(which, data[key]);
      showStatus("Pattern added");
    });
  });
}

function removePattern(which, index) {
  const key = `${which}Patterns`;
  chrome.storage.sync.get({ [key]: [] }, (data) => {
    data[key].splice(index, 1);
    chrome.storage.sync.set(data, () => {
      renderPatterns(which, data[key]);
      showStatus("Pattern removed");
    });
  });
}

document
  .getElementById("addIncludeBtn")
  .addEventListener("click", () => addPattern("include"));
document
  .getElementById("addExcludeBtn")
  .addEventListener("click", () => addPattern("exclude"));

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
