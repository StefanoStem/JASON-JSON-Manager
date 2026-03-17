# Firefox Upload + QA Checklist (v1.1.3)

Use this checklist to prepare the Firefox package, validate regressions, and submit to AMO.

---

## 1) Build release artifacts

- [ ] From repo root, run: `./build.sh`
- [ ] Confirm build completes with no errors
- [ ] Confirm artifact exists: `build/jason-firefox.zip`
- [ ] Confirm unpacked test build exists: `build/firefox/manifest.json`

---

## 2) Load temporary add-on in Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `build/firefox/manifest.json`
4. Open the JASON sidebar

- [ ] Sidebar loads correctly
- [ ] Existing tabs/content restore from storage

---

## 3) Must-pass regression test: tab title cancel lock

This validates the Firefox-only bug fix where canceling tab rename locked renaming for all tabs.

1. Click active tab title to rename
2. Type a temporary title
3. Press `Esc` to cancel
4. Try renaming the same tab again
5. Switch tabs and try renaming another tab

- [ ] Rename is still available after cancel on same tab
- [ ] Rename works on other tabs after cancel
- [ ] No need to close/reopen sidebar to unlock rename

---

## 4) Core smoke test before upload

- [ ] Paste valid JSON and click **Format**
- [ ] Click **Minify**
- [ ] Duplicate tab and verify copied content
- [ ] Toggle theme, close sidebar, reopen, confirm state persists
- [ ] Close/reopen browser, confirm tabs/content persist

---

## 5) Upload prep (AMO)

- [ ] Upload file: `build/jason-firefox.zip`
- [ ] Version in `manifests/firefox.json` matches release target
- [ ] Changelog includes Firefox tab-title cancel-lock fix
- [ ] Save AMO review notes and submission link
