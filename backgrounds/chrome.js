// Open side panel when extension icon is clicked
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

const CAPTURE_STATE_KEY = 'captureState';
const CAPTURE_MAX_PER_TAB = 80;
const CAPTURE_MAX_BODY_CHARS = 120000;
const CAPTURE_SCAN_MAX_ITEMS = 12;
let lastActiveTabId = null;

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

async function clearCapturesForTab(tabId) {
  if (typeof tabId !== 'number') return;
  const state = await chrome.storage.local.get([CAPTURE_STATE_KEY]);
  const captureState = getCaptureState(state[CAPTURE_STATE_KEY]);
  if (!captureState.capturesByTab) captureState.capturesByTab = {};
  captureState.capturesByTab[tabKey(tabId)] = [];
  await chrome.storage.local.set({ [CAPTURE_STATE_KEY]: captureState });
  chrome.runtime.sendMessage({ type: 'capture:updated', tabId }).catch(() => {});
}

function isRestrictedPageUrl(url) {
  if (typeof url !== 'string' || !url) return true;
  return (
    url.startsWith('chrome://')
    || url.startsWith('chrome-extension://')
    || url.startsWith('devtools://')
    || url.startsWith('about:')
    || url.startsWith('view-source:')
    || url.startsWith('edge://')
  );
}

function collectPageJsonOnDemand(maxItems, maxTextLen) {
  function readBalancedJson(text, startIndex) {
    const startChar = text[startIndex];
    const endChar = startChar === '{' ? '}' : startChar === '[' ? ']' : '';
    if (!endChar) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = startIndex; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === startChar) depth++;
      if (ch === endChar) {
        depth--;
        if (depth === 0) return text.slice(startIndex, i + 1);
      }
    }
    return null;
  }

  function parseCandidate(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;

    const quickCandidates = [
      raw,
      raw.replace(/^\)\]\}',?\s*/, '').trim()
    ];
    for (const candidate of quickCandidates) {
      if (!candidate) continue;
      if (!candidate.startsWith('{') && !candidate.startsWith('[')) continue;
      try {
        return JSON.parse(candidate);
      } catch (_) {}
    }

    // Fallback: extract the first balanced JSON object/array from mixed text.
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (ch !== '{' && ch !== '[') continue;
      const snippet = readBalancedJson(raw, i);
      if (!snippet) continue;
      try {
        return JSON.parse(snippet);
      } catch (_) {}
    }
    return null;
  }

  function normalizeBody(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text.length > maxTextLen ? text.slice(0, maxTextLen) : text;
  }

  const out = [];
  const seen = new Set();
  const sources = [
    ...document.querySelectorAll('script[type*="json"]'),
    ...document.querySelectorAll('pre'),
    ...document.querySelectorAll('code')
  ];
  // Some pages (like docs/examples) render JSON as plain body text rather than
  // in <pre>/<code>, so include body as a fallback scan source.
  if (document.body) sources.push(document.body);

  for (const node of sources) {
    if (out.length >= maxItems) break;
    const parsed = parseCandidate(node.textContent || '');
    if (!parsed) continue;
    const body = normalizeBody(JSON.stringify(parsed));
    if (seen.has(body)) continue;
    seen.add(body);
    out.push({
      method: 'SCAN',
      url: location.href,
      status: 200,
      contentType: 'application/json',
      body,
      ts: Date.now()
    });
  }
  return out;
}

// Persist tabs when side panel closes (background outlives panel, so save completes)
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg.type === 'capture:add' && msg.payload) {
      const senderTabId = _sender?.tab?.id ?? null;
      const key = tabKey(senderTabId);
      const state = await chrome.storage.local.get([CAPTURE_STATE_KEY]);
      const captureState = getCaptureState(state[CAPTURE_STATE_KEY]);

      const item = normalizeCapture(msg.payload);
      const existing = Array.isArray(captureState.capturesByTab[key]) ? captureState.capturesByTab[key] : [];
      // Keep capture list in chronological order (oldest -> newest),
      // so first captured item appears at the top.
      const next = [...existing, item].slice(-CAPTURE_MAX_PER_TAB);
      captureState.capturesByTab[key] = next;
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
      if (typeof activeTabId !== 'number') {
        sendResponse({ ok: false, count: 0 });
        return;
      }
      if (msg.confirmed !== true) {
        sendResponse({ ok: false, count: 0, tabId: activeTabId, reason: 'confirmation_required' });
        return;
      }
      if (!chrome.scripting?.executeScript) {
        sendResponse({ ok: false, count: 0, tabId: activeTabId, reason: 'scripting_unavailable' });
        return;
      }

      try {
        const tab = await chrome.tabs.get(activeTabId);
        if (isRestrictedPageUrl(tab?.url || '')) {
          sendResponse({ ok: false, count: 0, tabId: activeTabId, reason: 'restricted_page' });
          return;
        }

        const execResults = await chrome.scripting.executeScript({
          target: { tabId: activeTabId },
          func: collectPageJsonOnDemand,
          args: [CAPTURE_SCAN_MAX_ITEMS, CAPTURE_MAX_BODY_CHARS]
        });
        const payloads = Array.isArray(execResults?.[0]?.result) ? execResults[0].result : [];

        if (payloads.length > 0) {
          const state = await chrome.storage.local.get([CAPTURE_STATE_KEY]);
          const captureState = getCaptureState(state[CAPTURE_STATE_KEY]);
          const key = tabKey(activeTabId);
          const existing = Array.isArray(captureState.capturesByTab[key]) ? captureState.capturesByTab[key] : [];
          const next = [...existing];
          for (const payload of payloads) {
            next.push(normalizeCapture(payload));
          }
          captureState.capturesByTab[key] = next.slice(-CAPTURE_MAX_PER_TAB);
          await chrome.storage.local.set({ [CAPTURE_STATE_KEY]: captureState });
          chrome.runtime.sendMessage({ type: 'capture:updated', tabId: activeTabId }).catch(() => {});
        }

        sendResponse({ ok: true, count: payloads.length, tabId: activeTabId });
      } catch (err) {
        const message = String(err?.message || '');
        const reason = /Cannot access|Missing host permission|chrome:\/\//i.test(message)
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
