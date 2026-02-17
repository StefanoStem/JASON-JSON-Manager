# JASON (JSON Manager)

A browser extension for quickly saving and managing JSON snippets in a sidebar. Works on **Chrome**, **Firefox**, and **Edge**. Perfect for developers who frequently copy JSON between tools, APIs, and documentation.

## Features

- **Side Panel / Sidebar** – Opens as a resizable panel when you click the extension icon
- **Tab System** – Up to 20 tabs, each holding one snippet with editable titles
- **Syntax Highlighting** – JSON syntax coloring via Prism.js (Tomorrow theme)
- **Line Numbers** – Line numbers on the left for easy reference
- **JSON Validation** – Live validation with "Valid JSON" / "Not valid JSON" indicator
- **Format** – One-click formatting with 2-space indentation (when JSON is valid)
- **Copy & Clear** – Quick copy to clipboard and clear buttons
- **Drag & Drop** – Drop text anywhere in the content area to add it to the current tab
- **Paste** – Paste into the content area to add text to the current tab
- **Auto-save** – Content saves automatically (500ms debounce) to local storage
- **Dark Theme** – Dark-friendly editor styling

## Building

The shared source lives in the project root. A build script produces browser-specific packages:

```bash
./build.sh
```

This creates:
- `build/chrome/` – unpacked extension for Chrome
- `build/firefox/` – unpacked extension for Firefox
- `build/edge/` – unpacked extension for Edge
- `build/jason-chrome.zip` – ready to upload to Chrome Web Store
- `build/jason-firefox.zip` – ready to upload to Firefox Add-ons (AMO)
- `build/jason-edge.zip` – ready to upload to Edge Add-ons

## Installation

### Chrome
1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked** → select the `build/chrome` folder

### Firefox
1. Open Firefox → `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…** → select `build/firefox/manifest.json`

### Edge
1. Open Edge → `edge://extensions`
2. Enable **Developer mode** (toggle in bottom-left)
3. Click **Load unpacked** → select the `build/edge` folder

## Usage

- **Open panel** – Click the JASON icon in the toolbar (Chrome: side panel; Firefox: sidebar)
- **Add tab** – Click "+ New Tab" or drop/paste text into the content area
- **Switch tabs** – Click a tab to switch; click the tab label (when active) to rename it
- **Delete tab** – Click × on a tab
- **Format JSON** – Click Format (enabled when JSON is valid)
- **Copy** – Copy the current snippet to clipboard

## Tech Stack

- Chrome/Edge: Manifest V3 + Side Panel API
- Firefox: Manifest V2 + Sidebar Action API
- Pure HTML/CSS/JavaScript (no frameworks)
- [Prism.js](https://prismjs.com/) for syntax highlighting

## License

MIT License – see [LICENSE](LICENSE) for details.
