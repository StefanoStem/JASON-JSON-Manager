(() => {
  if (globalThis.__jasonCaptureLoaded) return;
  globalThis.__jasonCaptureLoaded = true;

  const MAX_SCAN_ITEMS = 12;
  const MAX_TEXT_LEN = 120000;
  /** Max characters of a node considered for quick JSON.parse attempts. */
  const MAX_NODE_TEXT_FOR_QUICK = 120000;
  /** Fallback brace walk only within this many characters (avoids pathological pages). */
  const MAX_FALLBACK_SCAN_LEN = 64000;
  /** Optional document.body scan uses only this prefix. */
  const MAX_BODY_SNIPPET_LEN = 48000;
  /** Abort balanced read if this many character visits is exceeded (prevents freezes). */
  const MAX_BRACE_WALK_OPS = 250000;

  function readBalancedJson(text, startIndex, maxOps) {
    const startChar = text[startIndex];
    const endChar = startChar === '{' ? '}' : startChar === '[' ? ']' : '';
    if (!endChar) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;
    let ops = 0;

    for (let i = startIndex; i < text.length; i++) {
      if (++ops > maxOps) return null;
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

  function quickTryParse(raw) {
    const t = String(raw || '').trim();
    if (!t) return null;
    const candidates = [
      t,
      t.replace(/^\)\]\}',?\s*/, '').trim()
    ];
    for (const candidate of candidates) {
      if (!candidate) continue;
      if (!candidate.startsWith('{') && !candidate.startsWith('[')) continue;
      try {
        return JSON.parse(candidate);
      } catch (_) { /* continue */ }
    }
    return null;
  }

  /**
   * Single linear pass: after a balanced candidate fails to parse, advance by one
   * instead of re-walking from every prior offset inside the same span.
   */
  function extractFirstJsonSinglePass(raw, scanLimit) {
    const text = String(raw || '');
    const limit = Math.min(text.length, scanLimit);
    let i = 0;
    while (i < limit) {
      const ch = text[i];
      if (ch !== '{' && ch !== '[') {
        i++;
        continue;
      }
      const snippet = readBalancedJson(text, i, MAX_BRACE_WALK_OPS);
      if (!snippet) {
        i++;
        continue;
      }
      try {
        return JSON.parse(snippet);
      } catch (_) {
        i += Math.max(1, snippet.length);
        continue;
      }
    }
    return null;
  }

  function parseJsonFromNodeText(text, meta) {
    const full = String(text || '');
    const slice = full.slice(0, MAX_NODE_TEXT_FOR_QUICK);
    if (full.length > MAX_NODE_TEXT_FOR_QUICK) meta.scanLimited = true;

    const quick = quickTryParse(slice);
    if (quick) return quick;
    return extractFirstJsonSinglePass(slice, MAX_FALLBACK_SCAN_LEN);
  }

  function normalizeBody(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (text.length <= MAX_TEXT_LEN) return { body: text, truncated: false };
    return { body: text.slice(0, MAX_TEXT_LEN), truncated: true };
  }

  function collectPageJson() {
    const out = [];
    const seen = new Set();
    const meta = { scanLimited: false, pageTooLarge: false };

    const structuredSources = [
      ...document.querySelectorAll('script[type*="json"]'),
      ...document.querySelectorAll('pre'),
      ...document.querySelectorAll('code')
    ];

    for (const node of structuredSources) {
      if (out.length >= MAX_SCAN_ITEMS) break;
      const parsed = parseJsonFromNodeText(node.textContent || '', meta);
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

    if (out.length < MAX_SCAN_ITEMS && document.body) {
      const bodyText = document.body.textContent || '';
      if (bodyText.length > MAX_BODY_SNIPPET_LEN) meta.pageTooLarge = true;
      const snippet = bodyText.slice(0, MAX_BODY_SNIPPET_LEN);
      const parsed = parseJsonFromNodeText(snippet, meta);
      if (parsed) {
        const normalized = normalizeBody(JSON.stringify(parsed));
        if (!seen.has(normalized.body)) {
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
      }
    }

    return { payloads: out, meta };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'capture:scanPage') return;
    (async () => {
      const { payloads, meta } = collectPageJson();
      let stored = 0;
      let quotaFailures = 0;
      for (const payload of payloads) {
        try {
          const res = await chrome.runtime.sendMessage({ type: 'capture:add', payload, force: true });
          if (res && res.ok) stored += 1;
          else if (res && res.reason === 'quota_exceeded') quotaFailures += 1;
        } catch (_) {
          quotaFailures += 1;
        }
      }

      const foundCount = payloads.length;
      const response = {
        ok: true,
        count: stored,
        foundCount,
        quotaFailures,
        scanLimited: !!meta.scanLimited,
        pageTooLarge: !!meta.pageTooLarge
      };
      if (foundCount > 0 && stored === 0 && quotaFailures >= foundCount) {
        response.ok = false;
        response.reason = 'quota_exceeded';
      }
      sendResponse(response);
    })().catch(() => sendResponse({ ok: false, count: 0, foundCount: 0, reason: 'scan_failed' }));
    return true;
  });
})();
