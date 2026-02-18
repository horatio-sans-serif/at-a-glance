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

chrome.storage.sync.get(defaults, (settings) => {
  for (const [key, type] of Object.entries(fields)) {
    const el = document.getElementById(key);
    if (type === "checkbox") el.checked = settings[key];
    else el.value = settings[key];
  }

  const radio = document.querySelector(
    `input[name="autoShowMode"][value="${settings.autoShowMode}"]`,
  );
  if (radio) radio.checked = true;

  renderPatterns(
    settings.autoShowMode === "include"
      ? settings.includePatterns
      : settings.excludePatterns,
  );
  updatePatternsVisibility(settings.autoShow, settings.autoShowMode);
});

function save() {
  const data = {};
  for (const [key, type] of Object.entries(fields)) {
    const el = document.getElementById(key);
    data[key] = type === "checkbox" ? el.checked : el.value;
  }
  data.autoShowMode =
    document.querySelector('input[name="autoShowMode"]:checked')?.value ||
    "all";

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
