// Firefox opens the sidebar automatically via sidebar_action in the manifest.
const CAPTURE_STATE_KEY = 'captureState';
const CAPTURE_MAX_PER_TAB = 80;
const CAPTURE_MAX_BODY_CHARS = 120000;
/** Conservative cap vs extension storage quota so capture writes fail predictably with eviction. */
const CAPTURE_STORAGE_BUDGET_BYTES = 8 * 1024 * 1024;
let lastActiveTabId = null;

function derivePrettyBody(body) {
  if (typeof body !== 'string') return '';
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch (_) {
    return body;
  }
}

function enrichCaptureItem(item) {
  if (!item || typeof item !== 'object') return item;
  return { ...item, prettyBody: derivePrettyBody(item.body) };
}

function slimCaptureState(captureState) {
  const out = { capturesByTab: {} };
  for (const [k, arr] of Object.entries(captureState.capturesByTab || {})) {
    if (!Array.isArray(arr)) continue;
    out.capturesByTab[k] = arr.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const { prettyBody, ...rest } = item;
      return rest;
    });
  }
  return out;
}

function evictOldestCaptureOnce(captureState) {
  const byTab = captureState.capturesByTab;
  if (!byTab || typeof byTab !== 'object') return false;
  let bestKey = null;
  let bestIdx = -1;
  let bestTs = Infinity;
  for (const [key, arr] of Object.entries(byTab)) {
    if (!Array.isArray(arr) || arr.length === 0) continue;
    for (let idx = 0; idx < arr.length; idx++) {
      const item = arr[idx];
      const t = typeof item?.ts === 'number' ? item.ts : 0;
      if (t < bestTs) {
        bestTs = t;
        bestKey = key;
        bestIdx = idx;
      }
    }
  }
  if (bestKey === null || bestIdx < 0) return false;
  byTab[bestKey].splice(bestIdx, 1);
  return true;
}

async function measureMergedStorageBytes(patch) {
  const all = await chrome.storage.local.get(null);
  for (const [k, v] of Object.entries(patch)) all[k] = v;
  return new Blob([JSON.stringify(all)]).size;
}

async function writeCaptureState(captureState) {
  const slim = slimCaptureState(captureState);
  for (;;) {
    const bytes = await measureMergedStorageBytes({ [CAPTURE_STATE_KEY]: slim });
    if (bytes <= CAPTURE_STORAGE_BUDGET_BYTES) break;
    if (!evictOldestCaptureOnce(slim)) {
      return { ok: false, reason: 'quota_exceeded' };
    }
  }
  try {
    await chrome.storage.local.set({ [CAPTURE_STATE_KEY]: slim });
    return { ok: true };
  } catch (_e) {
    return { ok: false, reason: 'quota_exceeded' };
  }
}

async function injectCaptureScanner(tabId) {
  try {
    if (chrome.scripting?.executeScript) {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content-capture.js'] });
      return true;
    }
    if (chrome.tabs?.executeScript) {
      await new Promise((resolve, reject) => {
        chrome.tabs.executeScript(tabId, { file: 'content-capture.js' }, () => {
          const err = chrome.runtime.lastError;
          if (err) reject(new Error(err.message));
          else resolve();
        });
      });
      return true;
    }
  } catch (_e) {
    /* ignore */
  }
  return false;
}

function tabKey(tabId) {
  return String(typeof tabId === 'number' ? tabId : 'global');
}

function normalizeCapture(payload) {
  const body = typeof payload.body === 'string'
    ? payload.body.slice(0, CAPTURE_MAX_BODY_CHARS)
    : '';
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

async function clearCapturesForTab(tabId) {
  if (typeof tabId !== 'number') return;
  const state = await chrome.storage.local.get([CAPTURE_STATE_KEY]);
  const captureState = getCaptureState(state[CAPTURE_STATE_KEY]);
  if (!captureState.capturesByTab) captureState.capturesByTab = {};
  captureState.capturesByTab[tabKey(tabId)] = [];
  await writeCaptureState(captureState);
  chrome.runtime.sendMessage({ type: 'capture:updated', tabId }).catch(() => {});
}

function isRestrictedPageUrl(url) {
  if (typeof url !== 'string' || !url) return true;
  return (
    url.startsWith('chrome://')
    || url.startsWith('chrome-extension://')
    || url.startsWith('moz-extension://')
    || url.startsWith('devtools://')
    || url.startsWith('about:')
    || url.startsWith('view-source:')
    || url.startsWith('edge://')
    || url.startsWith('brave://')
    || url.startsWith('vivaldi://')
    || url.startsWith('file:')
    || url.startsWith('data:')
  );
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
      // Keep capture list in chronological order (oldest -> newest),
      // so first captured item appears at the top.
      captureState.capturesByTab[key] = [...existing, item].slice(-CAPTURE_MAX_PER_TAB);
      const wrote = await writeCaptureState(captureState);
      if (!wrote.ok) {
        sendResponse({ ok: false, reason: wrote.reason || 'quota_exceeded' });
        return;
      }
      chrome.runtime.sendMessage({ type: 'capture:updated', tabId: senderTabId }).catch(() => {});
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === 'capture:list') {
      const activeTabId = typeof msg.tabId === 'number' ? msg.tabId : await getActiveTabId();
      const state = await chrome.storage.local.get([CAPTURE_STATE_KEY]);
      const captureState = getCaptureState(state[CAPTURE_STATE_KEY]);
      const raw = captureState.capturesByTab?.[tabKey(activeTabId)] || [];
      const items = raw.map((it) => enrichCaptureItem(it));
      sendResponse({ items, tabId: activeTabId });
      return;
    }

    if (msg.type === 'capture:clear') {
      const activeTabId = typeof msg.tabId === 'number' ? msg.tabId : await getActiveTabId();
      const state = await chrome.storage.local.get([CAPTURE_STATE_KEY]);
      const captureState = getCaptureState(state[CAPTURE_STATE_KEY]);
      if (captureState.capturesByTab) captureState.capturesByTab[tabKey(activeTabId)] = [];
      await writeCaptureState(captureState);
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
      await writeCaptureState(captureState);
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === 'capture:scanCurrentTab') {
      const activeTabId = typeof msg.tabId === 'number' ? msg.tabId : await getActiveTabId();
      if (typeof activeTabId !== 'number' || !chrome.tabs?.sendMessage) {
        sendResponse({ ok: false, count: 0 });
        return;
      }
      if (msg.confirmed !== true) {
        sendResponse({ ok: false, count: 0, tabId: activeTabId, reason: 'confirmation_required' });
        return;
      }

      try {
        const tab = await chrome.tabs.get(activeTabId);
        if (isRestrictedPageUrl(tab?.url || '')) {
          sendResponse({ ok: false, count: 0, tabId: activeTabId, reason: 'restricted_page' });
          return;
        }

        const injected = await injectCaptureScanner(activeTabId);
        if (!injected) {
          sendResponse({ ok: false, count: 0, tabId: activeTabId, reason: 'injection_failed' });
          return;
        }

        const result = await chrome.tabs.sendMessage(activeTabId, { type: 'capture:scanPage' });
        sendResponse({
          ok: result != null && result.ok !== false,
          count: result?.count ?? 0,
          foundCount: result?.foundCount,
          quotaFailures: result?.quotaFailures,
          scanLimited: result?.scanLimited,
          pageTooLarge: result?.pageTooLarge,
          tabId: activeTabId,
          reason: result?.reason
        });
      } catch (err) {
        const message = String(err?.message || '');
        const reason = /Cannot access|Missing host permission|moz-extension|about:/i.test(message)
          ? 'restricted_page'
          : 'injection_failed';
        sendResponse({ ok: false, count: 0, tabId: activeTabId, reason });
      }
      return;
    }

    if (msg.type === 'saveTabs' && msg.tabs != null) {
      await chrome.storage.local.set({ tabs: msg.tabs, lastActiveTabId: msg.lastActiveTabId });
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false, reason: 'unknown_message' });
  })().catch((err) => {
    console.error('Background message handler error:', err);
    sendResponse({ ok: false });
  });
  return true;
});

if (chrome.tabs?.onUpdated) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    // Clear captures when the top-level page changes in this tab.
    if (typeof changeInfo?.url === 'string' && changeInfo.url.length > 0) {
      clearCapturesForTab(tabId).catch(() => {});
    }
  });
}

if (chrome.tabs?.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    clearCapturesForTab(tabId).catch(() => {});
    if (lastActiveTabId === tabId) lastActiveTabId = null;
  });
}

if (chrome.tabs?.onActivated) {
  chrome.tabs.onActivated.addListener(({ tabId }) => {
    // Capture-only privacy hardening: wipe capture buffers on tab switch.
    if (typeof lastActiveTabId === 'number' && lastActiveTabId !== tabId) {
      clearCapturesForTab(lastActiveTabId).catch(() => {});
    }
    if (typeof tabId === 'number') {
      clearCapturesForTab(tabId).catch(() => {});
      lastActiveTabId = tabId;
    }
  });
}
