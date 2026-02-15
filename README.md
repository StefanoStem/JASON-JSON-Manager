# JASON (JSON Manager)

A Chrome extension for quickly saving and managing JSON snippets in a sidebar. Perfect for developers who frequently copy JSON between tools, APIs, and documentation.

## Features

- **Side Panel** – Opens as a resizable side panel when you click the extension icon
- **Tab System** – Up to 20 tabs, each holding one snippet with editable titles
- **Syntax Highlighting** – JSON syntax coloring via Prism.js (Tomorrow theme)
- **Line Numbers** – Line numbers on the left for easy reference
- **JSON Validation** – Live validation with "Valid JSON" / "Not valid JSON" indicator
- **Format** – One-click formatting with 2-space indentation (when JSON is valid)
- **Copy & Clear** – Quick copy to clipboard and clear buttons
- **Drag & Drop** – Drop text anywhere in the content area to add it to the current tab
- **Paste** – Paste into the content area to add text to the current tab
- **Auto-save** – Content saves automatically (500ms debounce) to `chrome.storage.local`
- **Dark Theme** – Dark-friendly editor styling

## Installation

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in top-right)
4. Click **Load unpacked**
5. Select the `jason-extension` folder

## Usage

- **Open panel** – Click the JASON icon in the toolbar
- **Add tab** – Click "+ New Tab" or drop/paste text into the content area
- **Switch tabs** – Click a tab to switch; click the tab label (when active) to rename it
- **Delete tab** – Click × on a tab
- **Format JSON** – Click Format (enabled when JSON is valid)
- **Copy** – Copy the current snippet to clipboard

## Tech Stack

- Manifest V3
- Chrome Side Panel API
- Pure HTML/CSS/JavaScript (no frameworks)
- [Prism.js](https://prismjs.com/) for syntax highlighting

## License

MIT License – see [LICENSE](LICENSE) for details.
