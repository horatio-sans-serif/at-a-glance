import express from "express";
import cors from "cors";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const DATA_DIR = join(homedir(), ".local", "share", "glance");
const SUMMARIES_FILE = join(DATA_DIR, "summaries.json");
const PORT = process.env.PORT || 3377;

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

function loadSummaries() {
  if (!existsSync(SUMMARIES_FILE)) return [];
  return JSON.parse(readFileSync(SUMMARIES_FILE, "utf8"));
}

function saveSummaries(summaries) {
  writeFileSync(SUMMARIES_FILE, JSON.stringify(summaries, null, 2));
}

const app = express();
app.use(cors());
app.use(express.json());

app.get("/summaries", (req, res) => {
  const summaries = loadSummaries();
  const { url } = req.query;
  if (url) {
    const entry = summaries.find((s) => s.url === url);
    return res.json({ found: !!entry, entry: entry || null });
  }
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const start = (page - 1) * limit;
  res.json({
    summaries: summaries.slice(start, start + limit),
    total: summaries.length,
    page,
    limit,
  });
});

app.post("/summaries", (req, res) => {
  const summaries = loadSummaries();
  const { url, summary, findings, score, label, is_learning } = req.body;
  if (!url) return res.status(400).json({ error: "url required" });

  const existing = summaries.findIndex((s) => s.url === url);
  const entry = {
    url,
    summary: summary || [],
    findings: findings || [],
    score: score ?? null,
    label: label || null,
    is_learning: is_learning || false,
    date: new Date().toISOString(),
  };

  if (existing >= 0) summaries[existing] = entry;
  else summaries.push(entry);

  saveSummaries(summaries);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Glance server on http://localhost:${PORT}`);
  console.log(`Summaries: ${SUMMARIES_FILE}`);
});
