(() => {
  if (globalThis.__jasonCaptureLoaded) return;
  globalThis.__jasonCaptureLoaded = true;

  const MAX_SCAN_ITEMS = 12;
  const MAX_TEXT_LEN = 120000;
  const MAX_FALLBACK_SCAN_LEN = 500000;

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
    const scanLimit = Math.min(raw.length, MAX_FALLBACK_SCAN_LEN);
    for (let i = 0; i < scanLimit; i++) {
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
    if (text.length <= MAX_TEXT_LEN) return { body: text, truncated: false };
    return { body: text.slice(0, MAX_TEXT_LEN), truncated: true };
  }

  function collectPageJson() {
    const out = [];
    const seen = new Set();
    const sources = [
      ...document.querySelectorAll('script[type*="json"]'),
      ...document.querySelectorAll('pre'),
      ...document.querySelectorAll('code')
    ];
    // Some pages render JSON samples as regular body text, not <pre>/<code>.
    if (document.body) sources.push(document.body);

    for (const node of sources) {
      if (out.length >= MAX_SCAN_ITEMS) break;
      const parsed = parseCandidate(node.textContent || '');
      if (!parsed) continue;
      const normalized = normalizeBody(JSON.stringify(parsed));
      if (seen.has(normalized.body)) continue;
      seen.add(normalized.body);
      out.push({
        method: 'SCAN',
        url: location.href,
        status: 200,
        contentType: normalized.truncated ? 'application/json; truncated' : 'application/json',
        body: normalized.body,
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
