// Firefox opens the sidebar automatically via sidebar_action in the manifest.
const CAPTURE_STATE_KEY = 'captureState';
const CAPTURE_MAX_PER_TAB = 80;
const CAPTURE_MAX_BODY_CHARS = 120000;

function tabKey(tabId) {
  return String(typeof tabId === 'number' ? tabId : 'global');
}

function normalizeCapture(payload) {
  const body = typeof payload.body === 'string'
    ? payload.body.slice(0, CAPTURE_MAX_BODY_CHARS)
    : '';
  let prettyBody = body;
  try {
    prettyBody = JSON.stringify(JSON.parse(body), null, 2);
  } catch (_) {}
  let urlPath = payload.url || '';
  try {
    urlPath = new URL(payload.url).pathname || payload.url;
  } catch (_) {}

  return {
    id: 'cap_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    ts: payload.ts || Date.now(),
    method: payload.method || 'GET',
    url: payload.url || '',
    urlPath,
    status: payload.status || 0,
    contentType: payload.contentType || '',
    body,
    prettyBody,
    size: new Blob([body]).size
  };
}

async function getActiveTabId() {
  if (!chrome.tabs?.query) return null;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

function getCaptureState(rawState) {
  const state = rawState && typeof rawState === 'object' ? rawState : {};
  return { capturesByTab: state.capturesByTab || {} };
}

// Persist tabs and handle capture routing
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === 'capture:add' && msg.payload) {
      const senderTabId = sender?.tab?.id ?? null;
      const key = tabKey(senderTabId);
      const state = await chrome.storage.local.get([CAPTURE_STATE_KEY]);
      const captureState = getCaptureState(state[CAPTURE_STATE_KEY]);

      const item = normalizeCapture(msg.payload);
      const existing = Array.isArray(captureState.capturesByTab[key]) ? captureState.capturesByTab[key] : [];
      captureState.capturesByTab[key] = [item, ...existing].slice(0, CAPTURE_MAX_PER_TAB);
      await chrome.storage.local.set({ [CAPTURE_STATE_KEY]: captureState });
      chrome.runtime.sendMessage({ type: 'capture:updated', tabId: senderTabId }).catch(() => {});
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === 'capture:list') {
      const activeTabId = typeof msg.tabId === 'number' ? msg.tabId : await getActiveTabId();
      const state = await chrome.storage.local.get([CAPTURE_STATE_KEY]);
      const captureState = getCaptureState(state[CAPTURE_STATE_KEY]);
      const items = captureState.capturesByTab?.[tabKey(activeTabId)] || [];
      sendResponse({ items, tabId: activeTabId });
      return;
    }

    if (msg.type === 'capture:clear') {
      const activeTabId = typeof msg.tabId === 'number' ? msg.tabId : await getActiveTabId();
      const state = await chrome.storage.local.get([CAPTURE_STATE_KEY]);
      const captureState = getCaptureState(state[CAPTURE_STATE_KEY]);
      if (captureState.capturesByTab) captureState.capturesByTab[tabKey(activeTabId)] = [];
      await chrome.storage.local.set({ [CAPTURE_STATE_KEY]: captureState });
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === 'capture:delete' && msg.id) {
      const activeTabId = typeof msg.tabId === 'number' ? msg.tabId : await getActiveTabId();
      const state = await chrome.storage.local.get([CAPTURE_STATE_KEY]);
      const captureState = getCaptureState(state[CAPTURE_STATE_KEY]);
      const key = tabKey(activeTabId);
      const items = Array.isArray(captureState.capturesByTab?.[key]) ? captureState.capturesByTab[key] : [];
      captureState.capturesByTab[key] = items.filter((item) => item.id !== msg.id);
      await chrome.storage.local.set({ [CAPTURE_STATE_KEY]: captureState });
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === 'capture:scanCurrentTab') {
      const activeTabId = typeof msg.tabId === 'number' ? msg.tabId : await getActiveTabId();
      if (typeof activeTabId !== 'number' || !chrome.tabs?.sendMessage) {
        sendResponse({ ok: false, count: 0 });
        return;
      }
      try {
        const result = await chrome.tabs.sendMessage(activeTabId, { type: 'capture:scanPage' });
        sendResponse({ ok: true, count: result?.count || 0, tabId: activeTabId });
      } catch (_) {
        sendResponse({ ok: false, count: 0, tabId: activeTabId });
      }
      return;
    }

    if (msg.type === 'saveTabs' && msg.tabs != null) {
      await chrome.storage.local.set({ tabs: msg.tabs, lastActiveTabId: msg.lastActiveTabId });
      sendResponse({ ok: true });
      return;
    }
  })().catch((err) => {
    console.error('Background message handler error:', err);
    sendResponse({ ok: false });
  });
  return true;
});
