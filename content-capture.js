(() => {
  const MAX_SCAN_ITEMS = 12;
  const MAX_TEXT_LEN = 120000;

  function parseCandidate(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    if (!raw.startsWith('{') && !raw.startsWith('[')) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function normalizeBody(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text.length > MAX_TEXT_LEN ? text.slice(0, MAX_TEXT_LEN) : text;
  }

  function collectPageJson() {
    const out = [];
    const seen = new Set();
    const sources = [
      ...document.querySelectorAll('script[type*="json"]'),
      ...document.querySelectorAll('pre'),
      ...document.querySelectorAll('code')
    ];

    for (const node of sources) {
      if (out.length >= MAX_SCAN_ITEMS) break;
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

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'capture:scanPage') return;
    (async () => {
      const items = collectPageJson();
      for (const payload of items) {
        await chrome.runtime.sendMessage({ type: 'capture:add', payload, force: true }).catch(() => {});
      }
      sendResponse({ ok: true, count: items.length });
    })().catch(() => sendResponse({ ok: false, count: 0 }));
    return true;
  });
})();
