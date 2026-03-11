// Firefox opens the sidebar automatically via sidebar_action in the manifest.
// Persist tabs when side panel closes (background outlives panel, so save completes)
function storageSet(value, cb) {
  try {
    const maybePromise = chrome.storage.local.set(value, () => {
      const err = chrome.runtime && chrome.runtime.lastError;
      if (err) {
        cb(err);
        return;
      }
      cb(null);
    });
    if (maybePromise && typeof maybePromise.then === 'function') {
      maybePromise.then(() => cb(null)).catch((err) => cb(err));
    }
  } catch (err) {
    cb(err);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'saveTabs' && msg.tabs != null) {
    storageSet({ tabs: msg.tabs, lastActiveTabId: msg.lastActiveTabId }, (err) => {
      if (err) {
        console.error('Background save failed:', err);
        sendResponse({ ok: false });
        return;
      }
      sendResponse({ ok: true });
    });
    return true; // keep channel open for async sendResponse
  }
});
