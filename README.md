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
- **Line numbers** -- synced scrolling with the editor
- **Copy / Clear** -- one-click clipboard copy and clear
- **Drag & drop** -- drop text from any page into the editor
- **Auto-save** -- all content persists across browser sessions
- **Privacy first** -- no data collection, no network requests, everything stays local

## Install

### Chrome
1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select `build/chrome`

### Firefox
1. Go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on** and select `build/firefox/manifest.json`

## Build from source

```bash
git clone https://github.com/StefanoStem/JASON-JSON-Manager.git
cd JASON-JSON-Manager
./build.sh
```

This produces:

| Output | Purpose |
|---|---|
| `build/chrome/` | Unpacked extension for Chrome |
| `build/firefox/` | Unpacked extension for Firefox |
| `build/jason-chrome.zip` | Upload to Chrome Web Store |
| `build/jason-firefox.zip` | Upload to Firefox Add-ons |

## How it works

The shared source (`sidepanel.js`, `sidepanel.html`, `sidepanel.css`) lives in the project root. `build.sh` copies it alongside browser-specific manifests and background scripts into each build folder. No bundlers, no transpilers -- just a copy.

| | Chrome | Firefox |
|---|---|---|
| Manifest | V3 | V2 |
| Sidebar API | `chrome.sidePanel` | `browser.sidebarAction` |
| Storage | `chrome.storage.local` | `chrome.storage.local` |

## Privacy

JASON makes **zero network requests**. All data is stored locally in your browser. See [PRIVACY.md](PRIVACY.md) for the full policy.

## License

[MIT](LICENSE)
