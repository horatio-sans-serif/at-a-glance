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

app.get("/bookmarks", (req, res) => {
  const bookmarks = loadBookmarks();
  const { url } = req.query;
  if (url) {
    const bookmark = bookmarks.find((b) => b.url === url);
    return res.json({ found: !!bookmark, bookmark: bookmark || null });
  }
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

app.post("/bookmarks", (req, res) => {
  const bookmarks = loadBookmarks();
  const { url, title, summary, score, notes } = req.body;
  if (!url) return res.status(400).json({ error: "url required" });

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
