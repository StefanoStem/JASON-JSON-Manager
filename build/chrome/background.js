// Open side panel when extension icon is clicked
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

// Persist tabs when side panel closes (background outlives panel, so save completes)
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'saveTabs' && msg.tabs != null) {
    chrome.storage.local
      .set({ tabs: msg.tabs, lastActiveTabId: msg.lastActiveTabId })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error('Background save failed:', err);
        sendResponse({ ok: false });
      });
    return true; // keep channel open for async sendResponse
  }
});
