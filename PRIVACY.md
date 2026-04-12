# Privacy Policy

**Last updated:** March 2026 (v1.2.0)

JASON does not collect, transmit, or share any data with external services. All snippets, settings, and captures are stored locally in your browser using `chrome.storage.local` and never leave your device.

- **No analytics or tracking**
- **No third-party services**
- **Optional local capture only:** when triggered by you via **Run Scan**, JASON inspects JSON-like content already present in the current page so it can be viewed in the sidebar. No data leaves your browser.
- **Capture retention:** capture items are scoped to the current tab context and remain local until you clear them, switch tabs, close the tab, or the tab navigates to a different page.

### Permissions used

| Permission | Why |
|---|---|
| `storage` | Save your snippets and tab names locally between sessions |
| `sidePanel` / `sidebar` | Display the editor in the browser sidebar |
| `tabs` | Resolve the active tab so capture can be enabled/queried per tab |
| Host access (`<all_urls>`) | Allow **Run Scan** to read JSON-like content from the current page. Scan runs only when you click **Run Scan**; JASON does not access pages in the background or send data anywhere. |

### Responsible use

JASON performs local processing only, but users are responsible for ensuring use complies with applicable laws, company policies, and website terms of service.
See [TERMS.md](TERMS.md) for full use terms and limitation-of-liability language.

### Contact

Questions? [Open an issue](https://github.com/StefanoStem/JASON-JSON-Manager/issues).
