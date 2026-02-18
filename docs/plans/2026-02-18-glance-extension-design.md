# Glance -- Browser Extension Design

## Overview

Chrome extension (Manifest V3) that extracts page text, summarizes it via local Ollama (Qwen3), scores relevance against a user profile, and displays results in an animated overlay. Supports saving pages to a local bookmark server ("second brain" stub).

## Architecture

Three extension components + two local services:

- **Content Script**: DOM text extraction (adapted from RM scraper's `dom_to_text`), overlay rendering via shadow DOM
- **Background Service Worker**: orchestrates Ollama API calls and bookmark server communication
- **Popup UI**: settings -- user profile, Ollama config, URL patterns, auto-show toggle, bookmark server URL

External services:

- **Ollama** at `localhost:11434` -- Qwen3 model for summarization and relevance scoring
- **Bookmark Server** at `localhost:3377` -- Express + JSON file storage

## Text Extraction

Recursive DOM walker adapted from RM's `dom_to_text()`. Collects from 5 sources per node:

1. Text nodes (trimmed)
2. ARIA attributes: `aria-label`, `aria-labelledby`, `aria-description`, `aria-describedby`
3. `placeholder` attributes
4. `value` attributes (excluding password fields)
5. `alt` attributes

Skips: `script`, `style`, `noscript`, `template`, `svg`, `[aria-hidden="true"]`, hidden elements (`display:none`, `visibility:hidden`, `opacity:0`, `hidden` attr).

Returns joined text with collapsed whitespace.

## AI Pipeline

Two sequential Ollama calls per analysis:

### Call 1: Summarize

- Input: extracted text (truncated to ~4000 chars)
- Output: exactly 3 bullet points using keywords, phrases, analogies (not full sentences)
- Example bullet: "distributed message broker like NATS but written in Rust"

### Call 2: Relevance + Next Steps

- Input: user profile + summary from call 1 + page URL
- Output JSON: `{"score": 0-100, "reasons": ["..."], "next_steps": ["..."]}`
- Short-circuit: if completely irrelevant, `{"score": 0, "reasons": [], "next_steps": []}`
- For GitHub pages, next steps may include clone/test suggestions, alternative comparisons

## Overlay UI

Fixed position, top-right corner, max-width 360px. Rendered inside shadow DOM for style isolation.

### Visual Design

- Rounded corners, drop shadow colored by score
- Score thresholds: `<33%` red (#ef4444), `33-67%` gray (#6b7280), `>67%` green (#22c55e)
- Pulse animation on shadow: 3-5 pulses on appearance, then settles
- Collapse/expand toggle to minimize to score badge only

### Content

- 3 bullet point summary
- Relevance score badge (percentage)
- Reasons for relevance (if score > 0)
- Next steps section
- Save button (checks if already saved, shows saved state, allows notes)

## Popup Settings

Sections stored in `chrome.storage.sync`:

1. **User Profile**: free-form textarea (interests, role, tech stack)
2. **Ollama Config**: endpoint URL (default `http://localhost:11434`), model name (default `qwen3`)
3. **Auto-Show**:
   - Toggle: enabled/disabled
   - Mode: all pages / only matching patterns / exclude matching patterns
4. **URL Patterns**: CRUD list of glob-style patterns for auto-show filtering
5. **Bookmark Server**: endpoint URL (default `http://localhost:3377`)

## Auto-Show Logic

On `document_idle`:

1. Check auto-show enabled in settings
2. Apply URL pattern matching (include/exclude modes)
3. If should show: extract -> summarize -> score -> render overlay
4. If not auto-show: user triggers via extension icon -> popup "Analyze This Page" button

## Extension Icon Badge

After analysis, icon badge shows score-colored dot (red/gray/green).

## Bookmark Server (Stub)

Express server, data in `~/.glance/bookmarks.json`:

```
GET  /bookmarks?url=<encoded_url>  -> {found, bookmark?}
POST /bookmarks                    -> {url, title, summary, score, notes}
PATCH /bookmarks/:id               -> {notes?, summary?}
GET  /bookmarks                    -> paginated list
```

## File Structure

```
glance/
  extension/
    manifest.json
    background.js          -- service worker
    content.js             -- text extraction + overlay
    content.css            -- overlay styles (injected via shadow DOM)
    popup.html             -- settings UI
    popup.js               -- settings logic
    popup.css              -- settings styles
    icons/                 -- extension icons (16, 48, 128)
  server/
    index.js               -- Express bookmark server
    package.json
  docs/
    plans/
```
