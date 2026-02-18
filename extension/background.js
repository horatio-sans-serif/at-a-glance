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

async function callOllama(prompt, systemPrompt, settings, maxTokens = 800) {
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
      options: { temperature: 0.3, num_predict: maxTokens },
    }),
  });

  if (!response.ok) throw new Error(`Ollama error: ${response.status}`);
  const data = await response.json();
  // Strip qwen3 thinking blocks
  return data.response.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

async function analyzePageContent(text, url, settings) {
  const truncated = text.slice(0, 3000);
  const hasProfile = settings.userProfile?.trim();

  const systemPrompt = `/no_think
You analyze web pages. Respond ONLY with valid JSON, no other text.

Your task:
1. Summarize the page in exactly 3 bullet points (keywords/phrases/analogies, not full sentences).
2. Determine if this is LEARNING MATERIAL (tutorial, guide, course, docs, how-to, explainer).
${
  hasProfile
    ? `3. Evaluate relevance to the user profile. The profile lists PROJECTS (with disk paths) and INTERESTS.
   For each project/interest where there IS relevance, create a finding.
   Score guide: 0-25 irrelevant, 26-50 mildly relevant, 51-75 relevant, 76-100 very relevant.`
    : ""
}

Respond with this exact JSON structure:
{
  "summary": ["bullet 1", "bullet 2", "bullet 3"],
  "is_learning": true/false,
  "score": ${hasProfile ? "<0-100>" : "50"},
  "label": "${hasProfile ? "<irrelevant|mildly relevant|relevant|very relevant>" : "mildly relevant"}",
  "reasons": [${hasProfile ? '"overall reason 1", "..."' : ""}],
  "findings": [
    ${
      hasProfile
        ? `{
      "type": "project",
      "name": "project name from profile",
      "path": "/path/to/project if in profile",
      "rationale": ["specific reason 1", "specific reason 2"]
    },
    {
      "type": "interest",
      "name": "interest name from profile",
      "rationale": ["specific reason 1", "specific reason 2"]
    }`
        : ""
    }
  ],
  "next_steps": [${hasProfile ? '"..."' : ""}]
}
${hasProfile ? "Only include findings where there is genuine relevance. Be specific." : ""}
${!hasProfile ? 'No user profile configured. Set score to 50, label to "mildly relevant", empty findings.' : ""}`;

  const prompt = `${hasProfile ? `User profile:\n${settings.userProfile}\n\n` : ""}Page URL: ${url}

Page text:
${truncated}`;

  const raw = await callOllama(prompt, systemPrompt, settings, 900);
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      summary: ["Could not parse page"],
      isLearning: false,
      score: 50,
      label: "mildly relevant",
      reasons: ["Could not parse response"],
      findings: [],
      nextSteps: [],
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const summary = parsed.summary || ["Could not parse summary"];
    const isLearning = parsed.is_learning || false;
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
      summary,
      isLearning,
      score,
      label,
      reasons: parsed.reasons || [],
      findings,
      nextSteps: parsed.next_steps || [],
    };
  } catch {
    return {
      summary: ["Could not parse response"],
      isLearning: false,
      score: 50,
      label: "mildly relevant",
      reasons: ["Could not parse response"],
      findings: [],
      nextSteps: [],
    };
  }
}

// Generate Claude Code prompts for each finding
function generatePrompts(findings, summary, url, isLearning) {
  return findings.map((f) => {
    const summaryText = summary.map((b) => "- " + b).join("\n");
    const rationaleText = f.rationale.map((r) => "- " + r).join("\n");

    if (f.type === "project") {
      const pathClause = f.path
        ? `The project lives on disk at: ${f.path}`
        : `Find the project "${f.name}" on disk`;

      const learningBlock = isLearning
        ? `

This page appears to be LEARNING MATERIAL. In addition to the demos above, create an INTERACTIVE TUTORIAL as a single-page HTML app:
- Use React.js loaded from CDN (no build step)
- Include interactive diagrams/graphs (use a charting library from CDN if needed)
- Add quizzes after each section to test understanding
- Show a progress bar tracking completed sections
- Organize into clear sections with smooth navigation
- Make it visually polished with modern CSS3 (animations, transitions, gradients)
- Open the tutorial in the browser when done`
        : "";

      return {
        ...f,
        claudeCodePrompt: `I found a page that's relevant to my project "${f.name}".

${pathClause}

Page: ${url}
Summary:
${summaryText}

Relevance to "${f.name}":
${rationaleText}

Please:

1. Investigate this page's technology/approach and write a concise report (HTML or PDF) on how it benefits "${f.name}". Cover:
   - What can be directly used (libraries, patterns, APIs)
   - What architecture/design decisions are worth adopting
   - Concrete integration points with "${f.name}"

2. Build 2-3 working DEMO applications that SHOWCASE the benefit of this technology/approach specifically for "${f.name}". Each demo should:
   - Be a self-contained web app (HTML/CSS/JS, use CDN imports)
   - Clearly demonstrate one specific benefit in action
   - Include a title card explaining what it demonstrates and why it matters for "${f.name}"
   - Be visually polished and immediately impressive

3. Open each demo and the report in the browser when done.

Work in a separate worktree or temporary directory. Keep it experimental -- don't merge into main.${learningBlock}`,
      };
    } else {
      const learningBlock = isLearning
        ? `

This page appears to be LEARNING MATERIAL. In addition to the demos, create an INTERACTIVE TUTORIAL as a single-page HTML app:
- Use React.js loaded from CDN (no build step)
- Include interactive diagrams/graphs (use a charting library from CDN if needed)
- Add quizzes after each section to test understanding
- Show a progress bar tracking completed sections
- Organize into clear sections with smooth navigation
- Make it visually polished with modern CSS3 (animations, transitions, gradients)
- Open the tutorial in the browser when done`
        : "";

      return {
        ...f,
        claudeCodePrompt: `I found a page relevant to my interest in "${f.name}".

Page: ${url}
Summary:
${summaryText}

Why it's relevant to "${f.name}":
${rationaleText}

Please:

1. Write a concise analysis report (HTML or PDF) covering what this page offers and why it matters for "${f.name}".

2. Build 2-3 working DEMO applications that SHOWCASE the key ideas from this page applied to "${f.name}". Each demo should:
   - Be a self-contained web app (HTML/CSS/JS, use CDN imports)
   - Demonstrate one specific concept or technique in action
   - Include a title card explaining what it demonstrates
   - Be visually polished and immediately impressive

3. If there's enough substance, scaffold a lightweight exploratory project that incorporates the most promising ideas.

4. Open each demo and the report in the browser when done.

Work in a temporary directory. Keep it experimental -- a spike to learn from, not production code.${learningBlock}`,
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
    // Single Ollama call: summarize + score relevance together
    const result = await analyzePageContent(text, url, settings);

    const summary = result.summary;
    const isLearning = result.isLearning;
    const relevance = {
      score: result.score,
      label: result.label,
      reasons: result.reasons,
      findings: result.findings,
      nextSteps: result.nextSteps,
      isLearning,
    };

    // Generate Claude Code prompts for each finding
    const findings = generatePrompts(
      relevance.findings,
      summary,
      url,
      isLearning,
    );
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
        is_learning: isLearning,
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
