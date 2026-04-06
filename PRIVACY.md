# Privacy Policy

**Last updated:** March 2026 (v1.2.0)

JASON does not collect, transmit, or share any data with external services. All snippets, settings, and captures are stored locally in your browser using `chrome.storage.local` and never leave your device.

- **No analytics or tracking**
- **No third-party services**
- **Optional local capture only:** when triggered by you via **Run Scan**, JASON inspects JSON-like content already present in the current page (via an injected `content-capture.js` helper that reads `script`, `pre`, `code`, and body text where needed) so it can be viewed in the sidebar.
- **Capture retention:** capture items are scoped to the current tab context and remain local until you clear them, switch tabs, close the tab, or the tab navigates to a different page.

### Permissions used

| Permission | Why |
|---|---|
| `storage` | Save your snippets and tab names locally between sessions |
| `sidePanel` / `sidebar` | Display the editor in the browser sidebar |
| `tabs` | Resolve the active tab so capture can be enabled/queried per tab |
| `host_permissions` / `<all_urls>` + `content-capture.js` | **Chrome:** declared host access and a content script so **Run Scan** can inspect JSON-like content in the live page. **Firefox:** `<all_urls>` in permissions with the same script. Scan still runs only when you click **Run Scan**; the extension does not fetch arbitrary URLs from the background. |

### Responsible use

JASON performs local processing only, but users are responsible for ensuring use complies with applicable laws, company policies, and website terms of service.
See [TERMS.md](TERMS.md) for full use terms and limitation-of-liability language.

### Contact

Questions? [Open an issue](https://github.com/StefanoStem/JASON-JSON-Manager/issues).
