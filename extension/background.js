// Glance background service worker

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

async function summarizePage(text, settings) {
  const truncated = text.slice(0, 4000);
  const systemPrompt = `You summarize web pages. Respond with exactly 3 bullet points.
Use keywords, phrases, analogies. Not full sentences.
Format: one bullet per line starting with "- ".
Example: "- distributed message broker like NATS but written in Rust"`;

  const raw = await callOllama(truncated, systemPrompt, settings);
  const bullets = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- ") || l.startsWith("* "))
    .map((l) => l.replace(/^[-*]\s*/, ""))
    .slice(0, 3);

  return bullets.length ? bullets : [raw.trim()];
}

async function scoreRelevance(summary, url, settings) {
  if (!settings.userProfile?.trim()) {
    return {
      score: 50,
      label: "mildly relevant",
      reasons: ["No user profile configured"],
      projectRelevance: {},
      nextSteps: [],
    };
  }

  const systemPrompt = `You evaluate web page relevance to a user profile.
Respond ONLY with valid JSON, no other text.

The user profile may list named projects, interests, or topics. For each named item
in the profile that this page is relevant to, include an entry in "project_relevance"
with the item name as key and a short explanation of HOW it's relevant as value.
Only include items where there is actual relevance.

Format:
{
  "score": <0-100>,
  "label": "<irrelevant|mildly relevant|relevant|very relevant>",
  "reasons": ["..."],
  "project_relevance": {"project_name": "how this page helps that project", ...},
  "next_steps": ["..."]
}

Score guide: 0-25 irrelevant, 26-50 mildly relevant, 51-75 relevant, 76-100 very relevant.
If completely irrelevant: {"score": 0, "label": "irrelevant", "reasons": [], "project_relevance": {}, "next_steps": []}
For GitHub project pages, suggest concrete next steps like cloning, comparing alternatives.`;

  const prompt = `User profile:
${settings.userProfile}

Page summary:
${summary.map((b) => "- " + b).join("\n")}

Page URL: ${url}`;

  const raw = await callOllama(prompt, systemPrompt, settings);
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch)
    return { score: 50, reasons: ["Could not parse response"], nextSteps: [] };

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const score = Math.max(0, Math.min(100, parsed.score || 0));
    let label = parsed.label;
    if (!label) {
      if (score <= 25) label = "irrelevant";
      else if (score <= 50) label = "mildly relevant";
      else if (score <= 75) label = "relevant";
      else label = "very relevant";
    }
    return {
      score,
      label,
      reasons: parsed.reasons || [],
      projectRelevance: parsed.project_relevance || {},
      nextSteps: parsed.next_steps || [],
    };
  } catch {
    return {
      score: 50,
      label: "mildly relevant",
      reasons: ["Could not parse response"],
      projectRelevance: {},
      nextSteps: [],
    };
  }
}

async function analyzePage(text, url, tabId) {
  const settings = await getSettings();

  chrome.action.setBadgeText({ text: "...", tabId });
  chrome.action.setBadgeBackgroundColor({ color: "#6b7280", tabId });

  try {
    const summary = await summarizePage(text, settings);
    const relevance = await scoreRelevance(summary, url, settings);

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

async function checkBookmark(url, settings) {
  const endpoint = settings.bookmarkEndpoint || "http://localhost:3377";
  try {
    const resp = await fetch(
      `${endpoint}/bookmarks?url=${encodeURIComponent(url)}`,
    );
    if (!resp.ok) return { found: false };
    return resp.json();
  } catch {
    return { found: false };
  }
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "analyze") {
    analyzePage(msg.text, msg.url, msg.tabId)
      .then((result) => {
        sendResponse({ ok: true, ...result });
      })
      .catch((err) => {
        sendResponse({ ok: false, error: err.message });
      });
    return true;
  }

  if (msg.action === "getSettings") {
    getSettings().then(sendResponse);
    return true;
  }

  if (msg.action === "checkBookmark") {
    getSettings()
      .then((settings) => checkBookmark(msg.url, settings))
      .then(sendResponse)
      .catch(() => sendResponse({ found: false }));
    return true;
  }

  if (msg.action === "saveBookmark") {
    getSettings()
      .then((settings) =>
        saveBookmark(
          {
            url: msg.url,
            title: msg.title,
            summary: msg.summary,
            score: msg.score,
          },
          settings,
        ),
      )
      .then((result) => {
        sendResponse({ ok: true, ...result });
      })
      .catch((err) => {
        sendResponse({ ok: false, error: err.message });
      });
    return true;
  }
});
