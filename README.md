<p align="center">
  <img src="icons/icon128.png" alt="JASON icon" width="96" height="96">
</p>

<h1 align="center">JASON</h1>

<p align="center">
  A browser sidebar for saving and managing JSON snippets.<br>
  Available for <strong>Chrome</strong> and <strong>Firefox</strong>.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/version-1.1.2-brightgreen.svg" alt="Version 1.1.2">
  <img src="https://img.shields.io/badge/manifest-v3-blue.svg" alt="Manifest V3">
  <img src="https://img.shields.io/badge/no_frameworks-vanilla_JS-orange.svg" alt="Vanilla JS">
</p>

---

## Features

- **Sidebar editor** -- opens alongside your current page, one click away
- **Tabs** -- up to 20 tabs with editable names, each holding a separate snippet
- **Syntax highlighting** -- color-coded JSON via [Prism.js](https://prismjs.com/)
- **Live validation** -- instant feedback as you type
- **Format** -- pretty-print with 2-space indentation
- **Minify** -- collapse JSON to a single line (Ctrl+Shift+M)
- **Undo / Redo** -- full undo history per tab (Ctrl+Z / Ctrl+Shift+Z)
- **Download** -- save the current snippet as a `.json` file
- **Duplicate** -- clone the current tab's content into a new tab
- **Folding** -- collapse and expand JSON blocks with gutter arrows
- **Theme** -- light/dark mode toggle that persists across sessions
- **Line numbers** -- synced scrolling with the editor
- **Copy / Clear** -- one-click clipboard copy and clear
- **Drag & drop** -- drop text from any page into the editor
- **Auto-save** -- all content persists across browser sessions
- **Privacy first** -- no data collection, no network requests, everything stays local

## Install

Install from the official stores:

| Browser | Install |
|--------|--------|
| **Chrome** | [Chrome Web Store](https://chromewebstore.google.com/detail/jason-json-manager/lmagkaeimimgfafdeifljdiaekkljbnk) |
| **Firefox** | [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/jason-json-manager/) |

No zip files or developer mode needed for normal use.

### Development / load unpacked

To run from source (e.g. for development):

**Chrome:** `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select `build/chrome`

**Firefox:** `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → select `build/firefox/manifest.json`

**Run `./build.sh` first** to produce fresh build output (required for testing):

```bash
git clone https://github.com/StefanoStem/JASON-JSON-Manager.git
cd JASON-JSON-Manager
./build.sh
```

| Output | Purpose |
|--------|--------|
| `build/chrome/` | Unpacked extension for Chrome |
| `build/firefox/` | Unpacked extension for Firefox |
| `build/jason-chrome.zip` | For Chrome Web Store submission |
| `build/jason-firefox.zip` | For Firefox Add-ons submission |

### Release workflow

**Run a fresh build before QA or publishing.** Stale build artifacts cause manifest-sync failures and inconsistent tested artifacts.

1. **Always run `./build.sh`** to regenerate `build/*/` from source before testing or releasing. The built `manifest.json` files are copied from `manifests/*.json` — do not edit `build/*/manifest.json` manually.
2. The build script verifies that `build/*/manifest.json` matches `manifests/*.json` and fails if they diverge.
3. Load the extension from `build/chrome` or `build/firefox` for QA, then submit the corresponding zip for publishing.
4. For Firefox QA and AMO upload prep, follow `FIREFOX_UPLOAD_TEST_CHECKLIST_1.1.3.md`.

## What's new in 1.1.3

### Patch fixes in 1.1.3

- Fixed Firefox tab title editing getting locked on the same tab after click-away/no-change interactions
- Prevented same-tab clicks from re-triggering tab switch during rename, which could detach the edit input and leave stale rename state

---

## What's new in 1.1.2

### Patch fixes in 1.1.2

- Fixed duplicate paste after clearing and re-pasting JSON (same paste event being handled twice)
- Fixed Firefox tab rename lock after cancel (`Esc`) so tab titles can be edited again without reopening the sidebar

---

### Features introduced in 1.1.0

### New features

- **Undo / Redo** — full undo history per tab; Ctrl+Z to undo, Ctrl+Shift+Z to redo
- **Minify** — new toolbar button and Ctrl+Shift+M shortcut to collapse JSON to a single line
- **Download** — save the current snippet directly as a `.json` file
- **Duplicate** — create a new tab pre-filled with the current tab's content
- **Folding** — VS Code-style collapse/expand for JSON objects and arrays via gutter arrows
- **Theme toggle** — switch between light and dark mode with the sun/moon icon; choice persists across sessions
- **Always-open editor** — the editor now always starts with at least one tab so it's ready to use immediately

### Bug fixes

- Fixed invisible editor content after deleting all text (browser detaching `<code>` from `<pre>`)
- Fixed ghost text appearing when placeholder node was merged into editor content
- Fixed invisible text and broken Ctrl+Shift+Z redo after certain edit sequences
- Fixed Firefox sidebar losing content between sessions

### Internal

- Removed Edge support
- Tightened Content Security Policy
- Build script now supports `DEBUG=1` mode for local development with a browser mock (`debug.html`)
- Brighter sage/orange accent colors for improved contrast

## How it works

The shared source (`sidepanel.js`, `sidepanel.html`, `sidepanel.css`) lives in the project root. `build.sh` copies it alongside browser-specific manifests and background scripts into each build folder. No bundlers, no transpilers -- just a copy.

| | Chrome | Firefox |
|---|---|---|
| Manifest | V3 | V2 |
| Sidebar API | `chrome.sidePanel` | `browser.sidebarAction` |
| Storage | `chrome.storage.local` | `chrome.storage.local` |

## Privacy

JASON makes **zero network requests**. All data is stored locally in your browser. See [PRIVACY.md](PRIVACY.md) for the full policy.

## Support

If you find JASON useful, you can support its development:

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-donate-yellow)](https://buymeacoffee.com/stemtest197)

## License

[MIT](LICENSE)
