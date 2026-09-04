# Chromium History Archive

A WebExtension for Chromium-based browsers and Firefox. The toolbar button opens a **history tab** with search, date range, visit-level detail, and an optional pretty-printed JSON export.

Browsers cannot write into your home directory by themselves. Pick `~/.chromium/history` once (on Windows that is `%USERPROFILE%\.chromium\history`), or use **Download instead** and choose that folder in the save dialog.

Safari does not expose a comparable history API, so it is not supported.

## Load the extension

Create the save folder first (optional):

```bash
python scripts/ensure_history_dir.py
```

### Chrome, Edge, Brave, Opera, Vivaldi

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. **Load unpacked** and select this repository folder (`manifest.json`).
4. Pin the extension and click it, or press `Alt+Shift+H`.

### Firefox

1. Copy `manifest.firefox.json` over `manifest.json` (Firefox needs a background script instead of a service worker).
2. Open `about:debugging#/runtime/this-firefox`.
3. **Load Temporary Add-on** and choose `manifest.json`.
4. Temporary add-ons are cleared when Firefox restarts.

## JSON export

- **Choose ~/.chromium/history** — Chromium can remember a folder via the File System Access API. Select the directory created by `ensure_history_dir.py`.
- **Save JSON** — writes `history-YYYY-MM-DD-HHMMSS.json` and `history-latest.json` into that folder. If no folder is pinned, you get a save dialog.
- **Download instead** — always uses the browser download picker. The suggested relative path is `chromium/history/…` under your Downloads folder unless you change it.
- **Include each visit in JSON** — adds transition type, timestamps, and referring visit ids (slower on large histories).
- **Export current filter only** — saves the search/date subset instead of the full query result.

The document shape is in `schema/history-archive.example.json`.

## Permissions

The extension asks for `history` (read visits), `tabs` (open the archive tab), `storage` (UI state), and `downloads` (save-as fallback). History never leaves the browser except when you export a file on this machine.
