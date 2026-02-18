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
      findings: [],
      nextSteps: [],
    };
  }

  const systemPrompt = `You evaluate web page relevance to a user profile.
Respond ONLY with valid JSON, no other text.

The user profile lists PROJECTS (things they are building, with local disk paths)
and INTERESTS (topics, technologies, skills they care about).

Evaluate this page against EACH project and interest separately.
For each one where there IS relevance, create a finding entry.
A finding has type "project" or "interest", the name, and rationale items
explaining specifically HOW this page relates to that project or interest.

Format:
{
  "score": <0-100>,
  "label": "<irrelevant|mildly relevant|relevant|very relevant>",
  "reasons": ["overall reason 1", "..."],
  "findings": [
    {
      "type": "project",
      "name": "project name from profile",
      "path": "/path/to/project if mentioned in profile",
      "rationale": ["specific reason 1", "specific reason 2"]
    },
    {
      "type": "interest",
      "name": "interest name from profile",
      "rationale": ["specific reason 1", "specific reason 2"]
    }
  ],
  "next_steps": ["..."]
}

Score guide: 0-25 irrelevant, 26-50 mildly relevant, 51-75 relevant, 76-100 very relevant.
If completely irrelevant: {"score": 0, "label": "irrelevant", "reasons": [], "findings": [], "next_steps": []}
For GitHub project pages, suggest concrete next steps like cloning, comparing with alternatives.
Only include findings where there is genuine relevance. Be specific in rationale.`;

  const prompt = `User profile:
${settings.userProfile}

Page summary:
${summary.map((b) => "- " + b).join("\n")}

Page URL: ${url}`;

  const raw = await callOllama(prompt, systemPrompt, settings);
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch)
    return {
      score: 50,
      label: "mildly relevant",
      reasons: ["Could not parse response"],
      findings: [],
      nextSteps: [],
    };

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

    const findings = (parsed.findings || []).map((f) => ({
      type: f.type || "interest",
      name: f.name || "unknown",
      path: f.path || null,
      rationale: f.rationale || [],
    }));

    return {
      score,
      label,
      reasons: parsed.reasons || [],
      findings,
      nextSteps: parsed.next_steps || [],
    };
  } catch {
    return {
      score: 50,
      label: "mildly relevant",
      reasons: ["Could not parse response"],
      findings: [],
      nextSteps: [],
    };
  }
}

// Generate Claude Code prompts for each finding
function generatePrompts(findings, summary, url) {
  return findings.map((f) => {
    const summaryText = summary.map((b) => "- " + b).join("\n");
    const rationaleText = f.rationale.map((r) => "- " + r).join("\n");

    if (f.type === "project") {
      const pathClause = f.path
        ? `The project lives on disk at: ${f.path}`
        : `Find the project "${f.name}" on disk`;
      return {
        ...f,
        claudeCodePrompt: `I found a page that's relevant to my project "${f.name}".

${pathClause}

Page: ${url}
Summary:
${summaryText}

Relevance to "${f.name}":
${rationaleText}

Please investigate this page's technology/approach and write a report on how it can be leveraged by "${f.name}". Specifically:
1. What can be directly used (libraries, patterns, APIs)?
2. What can be learned from (architecture, design decisions)?
3. What ideas could be adapted or experimented with?

Then, in a separate worktree or container, try incorporating or prototyping the most promising finding. Keep it experimental/provisional -- don't merge into main. Show me what you learn.`,
      };
    } else {
      return {
        ...f,
        claudeCodePrompt: `I found a page relevant to my interest in "${f.name}".

Page: ${url}
Summary:
${summaryText}

Why it's relevant to "${f.name}":
${rationaleText}

I'd like to explore this further. Please:
1. Write a deeper analysis of what this page covers and why it matters for "${f.name}"
2. Identify concrete things I could build or experiment with based on these findings
3. If there's enough substance, scaffold a new exploratory project that incorporates these ideas. Keep it lightweight and experimental -- a spike/prototype to learn from, not production code.
4. Try it out in a container or temporary directory. Show me what you discover.`,
      };
    }
  });
}

async function savePageSummary(data, settings) {
  const endpoint = settings.bookmarkEndpoint || "http://localhost:3377";
  try {
    await fetch(`${endpoint}/page-summaries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  } catch {
    // Best-effort save, don't fail the analysis
  }
}

async function analyzePage(text, url, tabId) {
  const settings = await getSettings();

  chrome.action.setBadgeText({ text: "...", tabId });
  chrome.action.setBadgeBackgroundColor({ color: "#6b7280", tabId });

  try {
    const summary = await summarizePage(text, settings);
    const relevance = await scoreRelevance(summary, url, settings);

    // Generate Claude Code prompts for each finding
    const findings = generatePrompts(relevance.findings, summary, url);
    relevance.findings = findings;

    let badgeColor;
    if (relevance.score < 33) badgeColor = "#ef4444";
    else if (relevance.score < 67) badgeColor = "#6b7280";
    else badgeColor = "#22c55e";

    chrome.action.setBadgeText({ text: String(relevance.score), tabId });
    chrome.action.setBadgeBackgroundColor({ color: badgeColor, tabId });

    // Save page summary (fire and forget)
    savePageSummary(
      {
        url,
        summary,
        relevance_findings: findings.map((f) => ({
          type: f.type,
          interest: f.type === "interest" ? f.name : null,
          project: f.type === "project" ? f.name : null,
          rationale: f.rationale,
          claude_code_prompt: f.claudeCodePrompt,
        })),
        score: relevance.score,
        label: relevance.label,
        date: new Date().toISOString(),
      },
      settings,
    );

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
