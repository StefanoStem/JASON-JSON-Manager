<p align="center">
  <img src="icons/icon128.png" alt="JASON icon" width="96" height="96">
</p>

<h1 align="center">JASON 1.2.0</h1>

<p align="center">
  A focused browser sidebar for reading, validating, comparing, and organizing JSON payloads.<br>
  Available for <strong>Chrome</strong> and <strong>Firefox</strong>.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/chrome-v1.2.0-brightgreen.svg" alt="Chrome v1.2.0">
  <img src="https://img.shields.io/badge/firefox-v1.2.0-orange.svg" alt="Firefox v1.2.0">
  <img src="https://img.shields.io/badge/no_frameworks-vanilla_JS-yellow.svg" alt="Vanilla JS">
</p>

---

## Product Overview

JASON 1.2.0 is built as a local-first JSON workspace inside your browser side panel.
It is designed for API testers, frontend/backend engineers, QA, and anyone who needs
to quickly inspect and work with JSON without leaving the current page.

### Core workspace modes

- **Store mode** — edit and organize JSON snippets in tabs
- **Compare mode** — compare two JSON payloads side by side with line and inline diff highlights
- **Capture mode** — run page scans and review captured JSON-like blocks from the active tab

### Editing and quality tools

- JSON syntax highlighting (Prism)
- Validation on demand and during editing
- Format and minify actions
- Line numbers and fold/collapse controls
- Undo/redo history
- Download, duplicate, and clipboard copy
- Drag-and-drop and paste-first workflow

### Capture workflow

- Manual **Run Scan** from Capture mode
- Per-tab capture storage
- Chronological capture listing
- Unique capture labels with timestamp + id suffix
- Fast transfer of selected captures into Compare or Store workflows

### User experience

- Light and dark themes
- Global search across stored tabs and capture content
- Real-time size indicator
- Persistent local state across sessions

## Install

Install from the official stores:

| Browser | Version | Install |
|---|---|---|
| **Chrome** | 1.2.0 | [Chrome Web Store](https://chromewebstore.google.com/detail/jason-json-manager/lmagkaeimimgfafdeifljdiaekkljbnk) |
| **Firefox** | 1.2.0 | [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/jason-json-manager/) |

## Development

```bash
git clone https://github.com/StefanoStem/JASON-JSON-Manager.git
cd JASON-JSON-Manager
./build.sh
```

Load unpacked:

- **Chrome:** `chrome://extensions` → Developer mode → Load unpacked → `build/chrome`
- **Firefox:** `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → `build/firefox/manifest.json`

Build outputs:

| Output | Purpose |
|---|---|
| `build/chrome/` | Unpacked extension for Chrome |
| `build/firefox/` | Unpacked extension for Firefox |
| `build/jason-chrome.zip` | Chrome store submission artifact |
| `build/jason-firefox.zip` | Firefox add-ons submission artifact |

## Architecture

Shared source lives at repo root:

- `sidepanel.js`
- `sidepanel.html`
- `sidepanel.css`
- `content-capture.js`

Browser-specific entry points:

- `backgrounds/chrome.js`
- `backgrounds/firefox.js`
- `manifests/chrome.json`
- `manifests/firefox.json`

`build.sh` creates clean Chrome/Firefox builds by copying shared assets plus browser-specific manifests and backgrounds.

## Permissions Justification

### `tabs`

JASON uses the `tabs` permission only to resolve the currently active tab so capture actions run in the correct context.  
It is used to run user-triggered scans, and to list/clear captures for the active tab only.

### `host_permissions` (`<all_urls>`)

JASON uses host access so users can manually run **Run Scan** on pages they choose and extract JSON-like content visible in that page context (for example JSON blocks in script/code/pre areas).  
No scan runs automatically in the background on behalf of the user.

## Privacy

JASON makes zero network requests and stores data locally in browser storage.
See [PRIVACY.md](PRIVACY.md) for full details.

## Responsible Use

JASON is a local tool, but users are responsible for using it in compliance with applicable laws, internal policies, and website terms of service.  
Some websites may restrict automated data extraction or reuse of page content.

## Terms

Use of JASON is subject to [TERMS.md](TERMS.md), including authorized-use, compliance, and limitation-of-liability terms.

## Support

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-donate-yellow)](https://buymeacoffee.com/stemtest197)

## License

[MIT](LICENSE)
