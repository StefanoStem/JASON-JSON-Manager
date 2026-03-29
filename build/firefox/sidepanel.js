/**
 * JASON - JSON Snippet Manager
 * Side panel Chrome extension for managing multiple JSON text snippets
 *
 * Editor uses a single contenteditable <pre> with Prism highlighting.
 * No overlay = no alignment issues.
 */

const MAX_TABS = 20;
const TAB_PREVIEW_LENGTH = 20;
const DEBOUNCE_MS = 500;
const HIGHLIGHT_DEBOUNCE_MS = 1500;
const LAST_ACTIVE_TAB_KEY = 'lastActiveTabId';
const THEME_KEY = 'theme';
const MAX_UNDO = 50;
const CAPTURE_REFRESH_MS = 3000;

// DOM elements
const tabsContainer = document.getElementById('tabs');
const addTabBtn = document.getElementById('addTab');
const contentArea = document.getElementById('contentArea');
const editor = document.getElementById('editor');
const editorCode = document.getElementById('editorCode');
const editorPlaceholder = document.getElementById('editorPlaceholder');
const lineNumbers = document.getElementById('lineNumbers');
const validationEl = document.getElementById('validation');
const formatBtn = document.getElementById('formatBtn');
const copyBtn = document.getElementById('copyBtn');
const clearBtn = document.getElementById('clearBtn');
const collapseBtn = document.getElementById('collapseBtn');
const expandBtn = document.getElementById('expandBtn');
const duplicateBtn = document.getElementById('duplicateBtn');
const minifyBtn = document.getElementById('minifyBtn');
const validateBtn = document.getElementById('validateBtn');
const downloadBtn = document.getElementById('downloadBtn');
const collapseExpandRow = document.querySelector('.collapse-expand-row');
const statusBar = document.getElementById('statusBar');
const statusBarRow = document.querySelector('.status-bar-row');
const editorPanel = document.getElementById('editorPanel');
const foldGutter = document.getElementById('foldGutter');
const foldOverlay = document.getElementById('foldOverlay');
const emptyState = document.getElementById('emptyState');
const editorContainer = document.getElementById('editorContainer');
const themeToggle = document.getElementById('themeToggle');
const sidebarSearch = document.getElementById('sidebarSearch');
const singleModeBtn = document.getElementById('singleModeBtn');
const compareModeBtn = document.getElementById('compareModeBtn');
const captureModeBtn = document.getElementById('captureModeBtn');
const runCompareBtn = document.getElementById('runCompareBtn');
const compareStatus = document.getElementById('compareStatus');
const comparePanel = document.getElementById('comparePanel');
const compareLeftInput = document.getElementById('compareLeftInput');
const compareRightInput = document.getElementById('compareRightInput');
const storeLeftCompareBtn = document.getElementById('storeLeftCompareBtn');
const storeRightCompareBtn = document.getElementById('storeRightCompareBtn');
const clearLeftCompareBtn = document.getElementById('clearLeftCompareBtn');
const clearRightCompareBtn = document.getElementById('clearRightCompareBtn');
const capturePanel = document.getElementById('capturePanel');
const tabsRow = document.getElementById('tabsRow');
const captureList = document.getElementById('captureList');
const captureDetailMeta = document.getElementById('captureDetailMeta');
const captureDetailCode = document.getElementById('captureDetailCode');
const runCaptureScanBtn = document.getElementById('runCaptureScanBtn');
const captureScanConfirm = document.getElementById('captureScanConfirm');
const captureScanConfirmYes = document.getElementById('captureScanConfirmYes');
const captureScanConfirmNo = document.getElementById('captureScanConfirmNo');
const refreshCapturesBtn = document.getElementById('refreshCapturesBtn');
const clearCapturesBtn = document.getElementById('clearCapturesBtn');
const compareSelectedCapturesBtn = document.getElementById('compareSelectedCapturesBtn');
const storeSelectedCapturesBtn = document.getElementById('storeSelectedCapturesBtn');
const moveToCompareBtn = document.getElementById('moveToCompareBtn');

// State
let tabs = [];
let activeTabId = null;
let debounceTimer = null;
let highlightTimer = null;
let editingTabId = null;
/** Timestamp until which we ignore input events (avoids reacting to programmatic content changes that momentarily fire empty) */
let ignoreInputUntil = 0;
/** Set of startLine numbers for currently folded blocks */
let foldedLines = new Set();
/** Undo/redo stacks (text content only) */
let undoStack = [];
let redoStack = [];
/** True while applying undo/redo to avoid pushing to undo */
let isUndoRedo = false;
let uiMode = 'editor'; // editor | compare | captures
let searchQuery = '';
let compareDraft = { leftText: '', rightText: '' };
let captureItems = [];
let selectedCaptureId = null;
let currentBrowserTabId = null;
let capturePollTimer = null;
let selectedCaptureIds = [];
let captureScanArmed = false;

function hasStorage() {
  return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
}

// ─── Theme ─────────────────────────────────────────────────

function applyTheme(theme) {
  document.body.setAttribute('data-theme', theme === 'light' ? 'light' : '');
  if (themeToggle) {
    themeToggle.setAttribute('aria-label', theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
    themeToggle.title = theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
  }
}

async function loadTheme() {
  if (!hasStorage()) return 'dark';
  try {
    const result = await chrome.storage.local.get([THEME_KEY]);
    return result[THEME_KEY] === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

async function toggleTheme() {
  const current = document.body.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  const next = current === 'light' ? 'dark' : 'light';
  applyTheme(next);
  if (hasStorage()) {
    try {
      await chrome.storage.local.set({ [THEME_KEY]: next });
    } catch (err) {
      console.error('Failed to save theme:', err);
    }
  }
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setMode(nextMode, options = {}) {
  const prevMode = uiMode;
  uiMode = nextMode;
  const isEditor = uiMode === 'editor';
  const isCompare = uiMode === 'compare';
  const isCaptures = uiMode === 'captures';

  if (editorPanel) editorPanel.classList.toggle('hidden', !isEditor);
  if (comparePanel) comparePanel.classList.toggle('hidden', !isCompare);
  if (capturePanel) capturePanel.classList.toggle('hidden', !isCaptures);
  if (tabsRow) tabsRow.classList.toggle('hidden', !isEditor);
  if (runCompareBtn) runCompareBtn.classList.toggle('hidden', !isCompare);
  if (compareStatus) compareStatus.classList.toggle('hidden', !isCompare);
  if (collapseExpandRow) collapseExpandRow.classList.toggle('is-compare', isCompare);
  if (collapseBtn) collapseBtn.classList.toggle('hidden', !isEditor);
  if (expandBtn) expandBtn.classList.toggle('hidden', !isEditor);
  if (statusBarRow) statusBarRow.classList.toggle('hidden', !isEditor);

  if (singleModeBtn) {
    singleModeBtn.setAttribute('aria-pressed', String(isEditor));
    singleModeBtn.classList.toggle('active', isEditor);
  }
  if (compareModeBtn) {
    compareModeBtn.setAttribute('aria-pressed', String(isCompare));
    compareModeBtn.classList.toggle('active', isCompare);
  }
  if (captureModeBtn) {
    captureModeBtn.setAttribute('aria-pressed', String(isCaptures));
    captureModeBtn.classList.toggle('active', isCaptures);
  }
  if (!isCaptures) {
    hideCaptureScanConfirm();
    captureScanArmed = false;
  }

  if (isCompare) {
    if (options.preserveCompareDraft) {
      compareLeftInput.textContent = compareDraft.leftText || '';
      compareRightInput.textContent = compareDraft.rightText || '';
      compareLeftInput.dataset.compareRendered = 'false';
      compareRightInput.dataset.compareRendered = 'false';
    } else if (options.seedFromEditor) {
      compareDraft.leftText = getEditorText();
      compareLeftInput.textContent = compareDraft.leftText;
      compareLeftInput.dataset.compareRendered = 'false';
      if (!options.keepRightDraft) compareDraft.rightText = '';
      compareRightInput.textContent = compareDraft.rightText || '';
      compareRightInput.dataset.compareRendered = 'false';
    } else {
      // Entering Compare mode from the top toggle starts empty by design.
      compareDraft.leftText = '';
      compareDraft.rightText = '';
      compareLeftInput.textContent = '';
      compareRightInput.textContent = '';
      compareLeftInput.dataset.compareRendered = 'false';
      compareRightInput.dataset.compareRendered = 'false';
      setCompareStatus('neutral', 'Ready to compare');
    }
  }

  if (isCaptures) {
    startCapturePolling();
    refreshCaptures();
  } else {
    stopCapturePolling();
  }

  if (!isEditor) clearValidationMessage();

  syncBottomActionButtonsState();
  applySearchHighlights();
}

function setCompareStatus(kind, text) {
  if (!compareStatus) return;
  compareStatus.classList.remove('is-match', 'is-diff', 'is-neutral');
  if (!text) {
    compareStatus.textContent = '';
    compareStatus.classList.add('hidden');
    return;
  }
  compareStatus.textContent = text;
  compareStatus.classList.add('is-' + kind);
  if (uiMode === 'compare') compareStatus.classList.remove('hidden');
}

function normalizeJsonText(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function syncBottomActionButtonsState() {
  const isEditor = uiMode === 'editor';
  const isCompare = uiMode === 'compare';

  if (copyBtn) copyBtn.classList.toggle('hidden', !isEditor);
  if (formatBtn) formatBtn.classList.toggle('hidden', !isEditor);
  if (minifyBtn) minifyBtn.classList.toggle('hidden', !isEditor);
  if (validateBtn) validateBtn.classList.toggle('hidden', !isEditor);
  if (duplicateBtn) duplicateBtn.classList.toggle('hidden', !isEditor);
  if (downloadBtn) downloadBtn.classList.toggle('hidden', !isEditor);
  if (moveToCompareBtn) moveToCompareBtn.classList.toggle('hidden', !isEditor);
  if (clearBtn) clearBtn.classList.toggle('hidden', !isEditor);

  if (isCompare) {
    clearBtn.disabled = true;
    copyBtn.disabled = true;
    formatBtn.disabled = true;
    minifyBtn.disabled = true;
    if (validateBtn) validateBtn.disabled = true;
    duplicateBtn.disabled = true;
    downloadBtn.disabled = true;
    if (moveToCompareBtn) moveToCompareBtn.disabled = true;
    return;
  }

  if (!isEditor) {
    clearBtn.disabled = true;
    copyBtn.disabled = true;
    formatBtn.disabled = true;
    minifyBtn.disabled = true;
    if (validateBtn) validateBtn.disabled = true;
    duplicateBtn.disabled = true;
    downloadBtn.disabled = true;
    if (moveToCompareBtn) moveToCompareBtn.disabled = true;
    return;
  }

  copyBtn.disabled = false;
  clearBtn.disabled = false;
  duplicateBtn.disabled = false;
  downloadBtn.disabled = false;
  if (validateBtn) validateBtn.disabled = !(getEditorText() || '').trim();
  if (moveToCompareBtn) moveToCompareBtn.disabled = !(getEditorText() || '').trim();
  const result = validateJson(false);
  formatBtn.disabled = !result.valid;
  updateMinifyButton();
}

// ─── Helpers ────────────────────────────────────────────────

function generateId() {
  return 'tab_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
}

function getTabLabel(tab) {
  if (tab.title && tab.title.trim()) return tab.title.trim();
  const text = (tab.content || '').trim();
  if (!text) return '(empty)';
  const preview = text.slice(0, TAB_PREVIEW_LENGTH);
  return preview + (text.length > TAB_PREVIEW_LENGTH ? '…' : '');
}

function matchesSearch(value) {
  if (!searchQuery) return true;
  return String(value || '').toLowerCase().includes(searchQuery);
}

function clearSearchHighlights(root) {
  if (!root) return;
  const marks = root.querySelectorAll('mark.search-hit');
  marks.forEach((mark) => {
    const textNode = document.createTextNode(mark.textContent || '');
    mark.replaceWith(textNode);
  });
  root.normalize();
}

function highlightSearchInElement(root, query) {
  if (!root) return 0;
  clearSearchHighlights(root);
  const term = String(query || '').trim();
  if (!term) return 0;

  const lowerTerm = term.toLowerCase();
  const textNodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (parent && parent.closest('mark.search-hit')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  let currentNode = walker.nextNode();
  while (currentNode) {
    textNodes.push(currentNode);
    currentNode = walker.nextNode();
  }

  let totalMatches = 0;
  textNodes.forEach((node) => {
    const value = node.nodeValue || '';
    const lowerValue = value.toLowerCase();
    let fromIndex = 0;
    let matchIndex = lowerValue.indexOf(lowerTerm, fromIndex);
    if (matchIndex === -1) return;

    const frag = document.createDocumentFragment();
    while (matchIndex !== -1) {
      if (matchIndex > fromIndex) {
        frag.appendChild(document.createTextNode(value.slice(fromIndex, matchIndex)));
      }
      const hit = document.createElement('mark');
      hit.className = 'search-hit';
      hit.textContent = value.slice(matchIndex, matchIndex + term.length);
      frag.appendChild(hit);
      totalMatches++;
      fromIndex = matchIndex + term.length;
      matchIndex = lowerValue.indexOf(lowerTerm, fromIndex);
    }
    if (fromIndex < value.length) {
      frag.appendChild(document.createTextNode(value.slice(fromIndex)));
    }
    node.parentNode.replaceChild(frag, node);
  });

  return totalMatches;
}

function applySearchHighlights() {
  if (!searchQuery) {
    clearSearchHighlights(tabsContainer);
    clearSearchHighlights(editorCode);
    clearSearchHighlights(compareLeftInput);
    clearSearchHighlights(compareRightInput);
    clearSearchHighlights(captureList);
    clearSearchHighlights(captureDetailCode);
    return;
  }
  highlightSearchInElement(tabsContainer, searchQuery);
  if (uiMode === 'editor') highlightSearchInElement(editorCode, searchQuery);
  if (uiMode === 'compare') {
    highlightSearchInElement(compareLeftInput, searchQuery);
    highlightSearchInElement(compareRightInput, searchQuery);
  }
  if (uiMode === 'captures') {
    highlightSearchInElement(captureList, searchQuery);
    highlightSearchInElement(captureDetailCode, searchQuery);
  }
}

function scrollToFirstEditorSearchHit() {
  if (!searchQuery || uiMode !== 'editor') return;
  const firstHit = editorCode?.querySelector('mark.search-hit');
  if (!firstHit) return;
  try {
    firstHit.scrollIntoView({ block: 'center', inline: 'nearest' });
  } catch (_) {
    // Ignore scroll failures from detached nodes or hidden states.
  }
}

function computeLineDiff(leftText, rightText) {
  const leftLines = String(leftText || '').split('\n');
  const rightLines = String(rightText || '').split('\n');
  const maxLen = Math.max(leftLines.length, rightLines.length);
  const leftDiff = new Set();
  const rightDiff = new Set();
  for (let i = 0; i < maxLen; i++) {
    const l = leftLines[i] ?? '';
    const r = rightLines[i] ?? '';
    if (l !== r) {
      leftDiff.add(i);
      rightDiff.add(i);
    }
  }
  return { leftLines, rightLines, leftDiff, rightDiff };
}

function buildInlineDiffHtml(line, otherLine) {
  const current = line || '';
  const opposite = otherLine || '';
  if (current === opposite) return escapeHtml(current || ' ');

  let prefix = 0;
  const minLen = Math.min(current.length, opposite.length);
  while (prefix < minLen && current[prefix] === opposite[prefix]) prefix++;

  let suffix = 0;
  while (
    suffix < (minLen - prefix)
    && current[current.length - 1 - suffix] === opposite[opposite.length - 1 - suffix]
  ) {
    suffix++;
  }

  const start = current.slice(0, prefix);
  const changed = current.slice(prefix, current.length - suffix);
  const end = suffix > 0 ? current.slice(current.length - suffix) : '';

  if (!changed) return escapeHtml(current || ' ');
  return `${escapeHtml(start)}<span class="compare-char-diff">${escapeHtml(changed)}</span>${escapeHtml(end)}`;
}

function renderCompareResult(element, lines, diffSet, otherLines) {
  const html = lines
    .map((line, idx) => {
      const klass = diffSet.has(idx) ? 'compare-line compare-line-diff' : 'compare-line';
      const content = diffSet.has(idx)
        ? buildInlineDiffHtml(line, otherLines[idx] || '')
        : escapeHtml(line || ' ');
      return `<span class="${klass}">${content}</span>`;
    })
    .join('');
  element.innerHTML = html || '<span class="compare-line"> </span>';
  element.dataset.compareRendered = 'true';
}

function getCompareInputPlainText(element, side) {
  if (!element) return '';
  if (element.dataset.compareRendered === 'true') {
    return side === 'left' ? (compareDraft.leftText || '') : (compareDraft.rightText || '');
  }
  return element.textContent || '';
}

function getSelectionOffsetWithin(element) {
  try {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return -1;
    const range = selection.getRangeAt(0);
    if (!element.contains(range.startContainer)) return -1;
    const preRange = range.cloneRange();
    preRange.selectNodeContents(element);
    preRange.setEnd(range.startContainer, range.startOffset);
    return (preRange.toString() || '').length;
  } catch {
    return -1;
  }
}

function setSelectionOffsetWithin(element, targetOffset) {
  try {
    const selection = window.getSelection();
    if (!selection) return;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    let consumed = 0;

    while (node) {
      const len = node.nodeValue ? node.nodeValue.length : 0;
      if (consumed + len >= targetOffset) {
        const range = document.createRange();
        range.setStart(node, Math.max(0, targetOffset - consumed));
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      }
      consumed += len;
      node = walker.nextNode();
    }

    // Fallback: place caret at end when targetOffset exceeds current length.
    const fallback = document.createRange();
    fallback.selectNodeContents(element);
    fallback.collapse(false);
    selection.removeAllRanges();
    selection.addRange(fallback);
  } catch {
    // ignore selection errors
  }
}

function ensureCompareEditorPlainText(element, side) {
  if (!element || element.dataset.compareRendered !== 'true') return;
  const cursorOffset = getSelectionOffsetWithin(element);
  const text = side === 'left' ? (compareDraft.leftText || '') : (compareDraft.rightText || '');
  element.textContent = text;
  element.dataset.compareRendered = 'false';
  if (cursorOffset >= 0) setSelectionOffsetWithin(element, Math.min(cursorOffset, text.length));
}

function insertPlainTextAtSelection(target, text) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    target.textContent += text;
    return;
  }
  const range = selection.getRangeAt(0);
  if (!target.contains(range.commonAncestorContainer)) {
    target.textContent += text;
    return;
  }
  range.deleteContents();
  range.insertNode(document.createTextNode(text));
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function runCompare() {
  const rawLeft = getCompareInputPlainText(compareLeftInput, 'left');
  const rawRight = getCompareInputPlainText(compareRightInput, 'right');

  // Ignore indentation/whitespace-only differences when both inputs are valid JSON.
  // We compare canonical pretty JSON so "same data, different spacing" is a match.
  let leftText = rawLeft;
  let rightText = rawRight;
  try {
    const leftParsed = JSON.parse(String(rawLeft || '').trim());
    const rightParsed = JSON.parse(String(rawRight || '').trim());
    leftText = JSON.stringify(leftParsed, null, 2);
    rightText = JSON.stringify(rightParsed, null, 2);
  } catch {
    // Keep raw text comparison when one side is not valid JSON yet.
  }

  compareDraft.leftText = leftText;
  compareDraft.rightText = rightText;
  const diff = computeLineDiff(compareDraft.leftText, compareDraft.rightText);
  renderCompareResult(compareLeftInput, diff.leftLines, diff.leftDiff, diff.rightLines);
  renderCompareResult(compareRightInput, diff.rightLines, diff.rightDiff, diff.leftLines);
  const diffCount = diff.leftDiff.size;
  const hasContent = compareDraft.leftText.trim() || compareDraft.rightText.trim();
  if (!hasContent) setCompareStatus('neutral', 'Ready to compare');
  else if (diffCount === 0) setCompareStatus('match', 'Correct match \u2713');
  else setCompareStatus('diff', `${diffCount} line${diffCount === 1 ? '' : 's'} differ`);
  applySearchHighlights();
}

function updateCompareSelectedCapturesButton() {
  if (!compareSelectedCapturesBtn) return;
  compareSelectedCapturesBtn.disabled = selectedCaptureIds.length < 2;
}

function updateStoreSelectedCapturesButton() {
  if (!storeSelectedCapturesBtn) return;
  const hasSelection = selectedCaptureIds.length > 0;
  storeSelectedCapturesBtn.disabled = !hasSelection;
  storeSelectedCapturesBtn.classList.toggle('active', hasSelection);
}

function toggleCaptureCompareSelection(captureId) {
  const index = selectedCaptureIds.indexOf(captureId);
  if (index >= 0) {
    selectedCaptureIds.splice(index, 1);
  } else {
    selectedCaptureIds.push(captureId);
  }
  updateCompareSelectedCapturesButton();
  updateStoreSelectedCapturesButton();
}

function openSelectedCapturesInCompare() {
  if (selectedCaptureIds.length < 2) return;
  const leftItem = captureItems.find((item) => item.id === selectedCaptureIds[0]);
  const rightItem = captureItems.find((item) => item.id === selectedCaptureIds[1]);
  if (!leftItem || !rightItem) return;

  compareLeftInput.textContent = normalizeJsonText(leftItem.prettyBody || leftItem.body || '');
  compareRightInput.textContent = normalizeJsonText(rightItem.prettyBody || rightItem.body || '');
  compareLeftInput.dataset.compareRendered = 'false';
  compareRightInput.dataset.compareRendered = 'false';
  compareDraft.leftText = compareLeftInput.textContent;
  compareDraft.rightText = compareRightInput.textContent;
  setMode('compare', { preserveCompareDraft: true });
  runCompare();
}

async function storeSelectedCapturesToTabs() {
  if (selectedCaptureIds.length === 0) return;
  const selectedItems = selectedCaptureIds
    .map((id) => captureItems.find((item) => item.id === id))
    .filter(Boolean);
  if (selectedItems.length === 0) return;

  for (const item of selectedItems) {
    const text = normalizeJsonText(item.prettyBody || item.body || '');
    if (!text) continue;
    await addTab(text);
  }
  setMode('editor');
}

async function runtimeMessage(payload) {
  if (!chrome?.runtime?.sendMessage) return null;
  try {
    return await chrome.runtime.sendMessage(payload);
  } catch {
    return null;
  }
}

function formatCaptureTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return '';
  }
}

function formatCaptureTimestamp(ts) {
  try {
    const d = new Date(ts);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
  } catch {
    return '';
  }
}

function filteredCaptures() {
  if (!searchQuery) return captureItems;
  return captureItems.filter((item) => (
    matchesSearch(item.urlPath)
    || matchesSearch(item.url)
    || matchesSearch(item.method)
    || matchesSearch(String(item.status || ''))
    || matchesSearch(item.body)
    || matchesSearch(item.prettyBody)
  ));
}

function renderCaptureDetail(item) {
  if (!item) {
    captureDetailMeta.textContent = 'Select a capture item to inspect JSON.';
    captureDetailCode.textContent = '';
    applySearchHighlights();
    return;
  }
  const meta = `${item.method || 'GET'} ${item.status || '-'} • ${formatCaptureTime(item.ts)} • ${item.url || ''}`;
  captureDetailMeta.textContent = meta;
  captureDetailCode.textContent = item.prettyBody || item.body || '';
  applySearchHighlights();
}

function renderCaptureList() {
  if (!captureList) return;
  const items = filteredCaptures();
  captureList.textContent = '';

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'capture-item';
    empty.textContent = searchQuery
      ? 'No captures match your search.'
      : 'No captures yet. Click Run Scan for this tab.';
    captureList.appendChild(empty);
    const selectedStored = captureItems.find((x) => x.id === selectedCaptureId);
    if (selectedStored && searchQuery) renderCaptureDetail(selectedStored);
    else renderCaptureDetail(null);
    updateCompareSelectedCapturesButton();
    updateStoreSelectedCapturesButton();
    return;
  }

  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'capture-item'
      + (item.id === selectedCaptureId ? ' active' : '')
      + (selectedCaptureIds.includes(item.id) ? ' compare-selected' : '');

    const title = document.createElement('div');
    title.className = 'capture-item-title';
    const shortId = String(item.id || '').slice(-6);
    title.textContent = `${item.urlPath || item.url || '(unknown URL)'} • #${shortId}`;

    const meta = document.createElement('div');
    meta.className = 'capture-item-meta';
    meta.textContent = `${item.method || 'GET'} ${item.status || '-'} • ${formatCaptureTimestamp(item.ts)} • #${shortId}`;

    const topRow = document.createElement('div');
    topRow.className = 'capture-row-top';
    topRow.appendChild(title);

    const selectBtn = document.createElement('button');
    selectBtn.className = 'capture-select-btn';
    if (selectedCaptureIds.includes(item.id)) selectBtn.classList.add('is-selected');
    selectBtn.textContent = selectedCaptureIds.includes(item.id) ? 'Selected' : 'Select';
    selectBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleCaptureCompareSelection(item.id);
      renderCaptureList();
    });
    topRow.appendChild(selectBtn);

    row.appendChild(topRow);
    row.appendChild(meta);
    row.addEventListener('click', () => {
      selectedCaptureId = item.id;
      renderCaptureList();
      renderCaptureDetail(item);
    });
    captureList.appendChild(row);
  });

  const selectedVisible = items.find((x) => x.id === selectedCaptureId);
  const selectedStored = captureItems.find((x) => x.id === selectedCaptureId);
  if (selectedVisible) {
    renderCaptureDetail(selectedVisible);
  } else if (selectedStored && searchQuery) {
    renderCaptureDetail(selectedStored);
  } else {
    const fallback = items[0] || null;
    selectedCaptureId = fallback?.id || null;
    renderCaptureDetail(fallback);
  }
  updateCompareSelectedCapturesButton();
  updateStoreSelectedCapturesButton();
  applySearchHighlights();
}

async function refreshCaptures() {
  // Always resolve from current active browser tab first, so scan/list
  // cannot get stuck on a stale tab id after navigation.
  const res = await runtimeMessage({ type: 'capture:list' });
  if (typeof res?.tabId === 'number') currentBrowserTabId = res.tabId;
  captureItems = Array.isArray(res?.items) ? res.items : [];
  renderCaptureList();
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hideCaptureScanConfirm() {
  if (captureScanConfirm) captureScanConfirm.classList.add('hidden');
}

function askCaptureScanConfirmation() {
  return new Promise((resolve) => {
    if (!captureScanConfirm || !captureScanConfirmYes || !captureScanConfirmNo) {
      resolve(true);
      return;
    }

    const cleanup = () => {
      captureScanConfirmYes.removeEventListener('click', onConfirm);
      captureScanConfirmNo.removeEventListener('click', onCancel);
    };
    const onConfirm = () => {
      cleanup();
      hideCaptureScanConfirm();
      resolve(true);
    };
    const onCancel = () => {
      cleanup();
      hideCaptureScanConfirm();
      resolve(false);
    };

    captureScanConfirm.classList.remove('hidden');
    captureScanConfirmYes.addEventListener('click', onConfirm, { once: true });
    captureScanConfirmNo.addEventListener('click', onCancel, { once: true });
    captureScanConfirmYes.focus();
  });
}

async function runCaptureScan() {
  if (!captureScanArmed) return;
  // One-shot guard: every scan must be preceded by an explicit confirmation.
  captureScanArmed = false;
  const startedAt = Date.now();
  const initialCount = captureItems.length;
  if (runCaptureScanBtn) {
    runCaptureScanBtn.disabled = true;
    runCaptureScanBtn.textContent = 'Scanning...';
  }
  try {
    // Refresh once to resolve the active tab id before scanning.
    const activeRes = await runtimeMessage({ type: 'capture:list' });
    if (typeof activeRes?.tabId === 'number') currentBrowserTabId = activeRes.tabId;

    let scanRes = await runtimeMessage({ type: 'capture:scanCurrentTab', tabId: currentBrowserTabId, confirmed: true });
    // Retry once when content script was not ready (common after extension reload).
    if (!scanRes?.ok) {
      await waitMs(250);
      const retryActive = await runtimeMessage({ type: 'capture:list' });
      if (typeof retryActive?.tabId === 'number') currentBrowserTabId = retryActive.tabId;
      scanRes = await runtimeMessage({ type: 'capture:scanCurrentTab', tabId: currentBrowserTabId, confirmed: true });
    }
    if (typeof scanRes?.tabId === 'number') currentBrowserTabId = scanRes.tabId;

    // Poll briefly so late capture:add writes can land before UI reports no results.
    // This avoids the "button reacts too fast" feeling on slower pages.
    let attempts = 0;
    do {
      await refreshCaptures();
      if ((scanRes?.count || 0) > 0 || captureItems.length > initialCount) break;
      attempts++;
      if (attempts < 4) await waitMs(250);
    } while (attempts < 4);

    if (!scanRes?.ok) {
      captureDetailMeta.textContent = 'Scan script is not ready for this tab yet. Refresh this page and run scan again.';
    } else if ((scanRes?.count || 0) === 0 && captureItems.length <= initialCount) {
      captureDetailMeta.textContent = 'Scan completed. No JSON blocks were found on this page.';
    } else if ((scanRes?.count || 0) > 0) {
      captureDetailMeta.textContent = `Scan completed. Found ${scanRes.count} item${scanRes.count === 1 ? '' : 's'}.`;
    }
  } finally {
    const elapsed = Date.now() - startedAt;
    if (elapsed < 700) await waitMs(700 - elapsed);
    if (runCaptureScanBtn) {
      runCaptureScanBtn.disabled = false;
      runCaptureScanBtn.textContent = 'Run Scan';
    }
  }
}

function startCapturePolling() {
  if (capturePollTimer) return;
  capturePollTimer = setInterval(() => {
    refreshCaptures();
  }, CAPTURE_REFRESH_MS);
}

function stopCapturePolling() {
  clearInterval(capturePollTimer);
  capturePollTimer = null;
}

// ─── Editor text helpers ────────────────────────────────────

/**
 * Recursively extract text from a DOM node, treating <br> as \n.
 * Unlike innerText, this does not add newlines for display:block boundaries.
 */
function extractText(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeName === 'BR') return '\n';
  let text = '';
  for (const child of node.childNodes) text += extractText(child);
  return text;
}

/**
 * Merge any ghost nodes (siblings of <code> inside <pre>) into editorCode,
 * preserving cursor position. Called before reading text to ensure all
 * content lives inside <code>.
 */
function consolidateGhostNodes() {
  // If the browser detached editorCode (happens when user deletes all content), re-attach it.
  if (!editor.contains(editorCode)) {
    editor.insertBefore(editorCode, editor.firstChild || null);
  }

  const children = Array.from(editor.childNodes);
  const ghosts = children.filter((n) => n !== editorCode && n !== foldOverlay && n !== editorPlaceholder);
  if (ghosts.length === 0) return;

  let cursorOffset = -1;
  try {
    const sel = window.getSelection();
    if (sel.rangeCount && editor.contains(sel.getRangeAt(0).startContainer)) {
      const range = sel.getRangeAt(0);
      const preRange = range.cloneRange();
      preRange.selectNodeContents(editor);
      preRange.setEnd(range.startContainer, range.startOffset);
      cursorOffset = extractText(preRange.cloneContents()).length;
    }
  } catch (e) { /* ignore range errors */ }

  let fullText = '';
  for (const child of children) {
    if (child === editorPlaceholder) continue;
    fullText += extractText(child);
  }

  editorCode.textContent = fullText;
  ghosts.forEach((n) => n.remove());

  if (cursorOffset >= 0) {
    setCaretCharOffset(editorCode, Math.min(cursorOffset, fullText.length));
  }
}

/**
 * Get the full document text. When any block is folded we use the active tab's
 * content so save/validate/copy use the real document, not the collapsed view.
 */
function getFullContent() {
  // Keep line numbers/fold indicators aligned with what is currently rendered.
  // While unfolded we must read live editor text, not debounced tab state.
  if (foldedLines.size === 0) {
    consolidateGhostNodes();
    return editorCode.textContent || '';
  }
  if (activeTabId) {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (tab) return tab.content || '';
  }
  return '';
}

/**
 * Get the plain text from the contenteditable editor (or full content when folded).
 */
function getEditorText() {
  return getFullContent();
}

/** Remove any ghost nodes that are siblings of <code> inside <pre>. */
function clearEditorGhostNodes() {
  Array.from(editor.childNodes)
    .filter((n) => n !== editorCode && n !== foldOverlay && n !== editorPlaceholder)
    .forEach((n) => n.remove());
}

/**
 * Set editor content as plain text (no highlighting).
 */
function setEditorTextPlain(text) {
  ignoreInputUntil = Date.now() + 80;
  _cachedFoldText = null;
  editorCode.textContent = text;
  clearEditorGhostNodes();
  updatePlaceholder(text);
  foldedLines.clear();
  syncBottomActionButtonsState();
}

/**
 * Set editor content with Prism syntax highlighting.
 * Use when cursor position doesn't matter (load, switch, format, clear).
 */
function safeSetHTML(element, html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  element.textContent = '';
  while (doc.body.firstChild) {
    element.appendChild(doc.body.firstChild);
  }
}

function setEditorTextHighlighted(text, clearFolds = true) {
  ignoreInputUntil = Date.now() + 80;
  _cachedFoldText = null;
  if (clearFolds) foldedLines.clear();
  if (text.trim()) {
    try {
      safeSetHTML(editorCode, Prism.highlight(text, Prism.languages.json, 'json'));
    } catch {
      editorCode.textContent = text;
    }
  } else {
    editorCode.textContent = text;
  }
  appendTrailingBR(text);
  clearEditorGhostNodes();
  updatePlaceholder(text);
  updateStatusBar();
  applySearchHighlights();
  syncBottomActionButtonsState();
}

/**
 * In contenteditable <pre>, a trailing \n at the end of content is visually
 * collapsed — the browser won't render the cursor on the new line. Appending
 * a sentinel <br> gives the browser an anchor so the cursor appears correctly.
 * <br> is invisible to textContent and Range.toString(), so it doesn't affect
 * text reading or offset calculations.
 */
function appendTrailingBR(text) {
  if (text.endsWith('\n')) {
    editorCode.appendChild(document.createElement('br'));
  }
}

/**
 * Re-apply Prism highlighting while preserving cursor position.
 * Called on debounce during typing.
 */
function reHighlight() {
  const text = getEditorText();
  if (!text.trim()) return;

  const offset = getCaretCharOffset(editorCode);

  try {
    safeSetHTML(editorCode, Prism.highlight(text, Prism.languages.json, 'json'));
  } catch {
    editorCode.textContent = text;
  }
  appendTrailingBR(text);
  clearEditorGhostNodes();

  if (offset >= 0) {
    setCaretCharOffset(editorCode, offset);
  }
  applySearchHighlights();
}

/**
 * Get the caret position as a character offset from start of element.
 * Uses extractText for consistency with setCaretCharOffset's walk (handles <br> as \n).
 */
function getCaretCharOffset(element) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return -1;
  const range = sel.getRangeAt(0);
  if (!element.contains(range.startContainer)) return -1;
  const preRange = range.cloneRange();
  preRange.selectNodeContents(element);
  preRange.setEnd(range.startContainer, range.startOffset);
  const frag = preRange.cloneContents();
  const wrap = document.createElement('div');
  wrap.appendChild(frag);
  return extractText(wrap).length;
}

/**
 * Set the caret to a character offset within element.
 * Walk matches extractText (text nodes + <br> as \n) for correct positioning.
 */
function setCaretCharOffset(element, targetOffset) {
  const sel = window.getSelection();
  const range = document.createRange();
  let found = false;

  function walk(node, offset) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (offset + node.length >= targetOffset) {
        range.setStart(node, Math.min(targetOffset - offset, node.length));
        range.collapse(true);
        found = true;
        return offset + node.length;
      }
      return offset + node.length;
    }
    if (node.nodeName === 'BR') {
      if (offset + 1 >= targetOffset) {
        const parent = node.parentNode;
        const idx = Array.from(parent.childNodes).indexOf(node);
        range.setStart(parent, targetOffset <= offset ? idx : idx + 1);
        range.collapse(true);
        found = true;
        return offset + 1;
      }
      return offset + 1;
    }
    for (const child of node.childNodes) {
      offset = walk(child, offset);
      if (found) return offset;
    }
    return offset;
  }

  walk(element, 0);

  if (found) {
    try {
      if (range.startContainer?.isConnected) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } catch (_) { /* addRange can throw if range isn't in document */ }
  }
}

function updatePlaceholder(text) {
  if (!text || !text.trim()) {
    editorPlaceholder.classList.remove('hidden');
  } else {
    editorPlaceholder.classList.add('hidden');
  }
}

// ─── Undo / Redo ────────────────────────────────────────────

function pushUndoState(text) {
  if (isUndoRedo) return;
  if (undoStack.length > 0 && undoStack[undoStack.length - 1] === text) return;
  if (undoStack.length >= MAX_UNDO) undoStack.shift();
  undoStack.push(text);
  redoStack.length = 0;
}

function applyUndoState(text) {
  isUndoRedo = true;
  setEditorTextHighlighted(text);
  if (activeTabId) {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (tab) tab.content = text;
  }
  updateLineNumbers();
  updateStatusBar();
  const res = validateJson(false);
  formatBtn.disabled = !res.valid;
  updateCollapseExpandButtons();
  saveTabs();
  renderTabs();
  isUndoRedo = false;
}

function performUndo() {
  if (undoStack.length === 0) return;
  redoStack.push(getEditorText());
  const prev = undoStack.pop();
  applyUndoState(prev);
}

function performRedo() {
  if (redoStack.length === 0) return;
  undoStack.push(getEditorText());
  const next = redoStack.pop();
  applyUndoState(next);
}

// ─── Storage ────────────────────────────────────────────────

async function saveTabs() {
  if (!hasStorage()) return;
  try {
    await chrome.storage.local.set({ tabs, [LAST_ACTIVE_TAB_KEY]: activeTabId });
  } catch (err) {
    console.error('Failed to save tabs:', err);
    if (validationEl) {
      validationEl.textContent = '⚠️ Could not save to storage. Changes may not persist.';
      validationEl.className = 'validation warning';
    }
  }
}

async function loadTabs() {
  if (!hasStorage()) {
    tabs = [{ id: generateId(), content: '', title: '' }];
    activeTabId = tabs[0].id;
    return;
  }
  try {
    const result = await chrome.storage.local.get(['tabs', LAST_ACTIVE_TAB_KEY]);
    tabs = (result.tabs || [])
      .filter((t) => t && typeof t.id === 'string')
      .map((t) => ({
        id: t.id,
        content: typeof t.content === 'string' ? t.content : '',
        title: typeof t.title === 'string' ? t.title : ''
      }));
    activeTabId = result[LAST_ACTIVE_TAB_KEY] || null;
  } catch (err) {
    console.error('Failed to load tabs:', err);
    tabs = [];
  }
  if (tabs.length === 0) {
    tabs = [{ id: generateId(), content: '', title: '' }];
    activeTabId = tabs[0].id;
    await saveTabs();
  }
}

/**
 * Flush the current editor content to the active tab and cancel pending timers.
 * Call before any tab switch, add, or delete to prevent data loss.
 */
function flushActiveTab() {
  clearTimeout(debounceTimer);
  clearTimeout(highlightTimer);
  debounceTimer = null;
  highlightTimer = null;

  if (activeTabId) {
    const cur = tabs.find((t) => t.id === activeTabId);
    if (cur) cur.content = getEditorText();
  }
}

// ─── Tabs ───────────────────────────────────────────────────

function renderTabs() {
  tabsContainer.textContent = '';
  tabs.forEach((tab) => {
    const tabEl = document.createElement('div');
    const isActive = tab.id === activeTabId;
    tabEl.className = 'tab' + (isActive ? ' active' : '');
    tabEl.setAttribute('role', 'tab');
    tabEl.setAttribute('aria-selected', isActive ? 'true' : 'false');
    tabEl.setAttribute('data-id', tab.id);
    tabEl.draggable = true;
    if (tab.content && tab.content.trim()) tabEl.setAttribute('data-has-content', 'true');

    const labelEl = document.createElement('span');
    labelEl.className = 'tab-preview';
    labelEl.textContent = getTabLabel(tab);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'tab-close';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Close tab');

    tabEl.appendChild(labelEl);
    tabEl.appendChild(closeBtn);

    tabEl.addEventListener('click', (e) => {
      if (e.target === closeBtn) return;
      if (e.target && e.target.closest && e.target.closest('.tab-title-input')) return;
      if (tab.id === activeTabId) return;
      switchTab(tab.id);
    });

    labelEl.addEventListener('click', (e) => {
      if (tab.id !== activeTabId) return;
      e.stopPropagation();
      if (editingTabId === tab.id) return;
      startEditTabTitle(tab, labelEl);
    });

    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteTab(tab.id);
    });

    tabEl.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', tab.id);
      e.dataTransfer.effectAllowed = 'move';
    });
    tabEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    tabEl.addEventListener('drop', (e) => {
      e.preventDefault();
      const draggedId = e.dataTransfer.getData('text/plain');
      const targetId = e.currentTarget.getAttribute('data-id');
      if (!draggedId || !targetId || draggedId === targetId) return;
      const fromIndex = tabs.findIndex((t) => t.id === draggedId);
      const toIndex = tabs.findIndex((t) => t.id === targetId);
      if (fromIndex === -1 || toIndex === -1) return;
      const [removed] = tabs.splice(fromIndex, 1);
      tabs.splice(toIndex, 0, removed);
      saveTabs();
      renderTabs();
    });

    tabsContainer.appendChild(tabEl);
  });

  addTabBtn.disabled = tabs.length >= MAX_TABS;
  applySearchHighlights();
}

function startEditTabTitle(tab, labelEl) {
  if (editingTabId) {
    const activeTitleInput = tabsContainer.querySelector('.tab-title-input');
    if (!activeTitleInput || !activeTitleInput.isConnected) {
      editingTabId = null;
    } else {
      return;
    }
  }
  editingTabId = tab.id;
  const originalTitle = tab.title || '';

  const input = document.createElement('input');
  input.className = 'tab-title-input';
  input.type = 'text';
  input.value = tab.title || getTabLabel(tab);
  input.setAttribute('data-id', tab.id);

  labelEl.replaceWith(input);
  input.focus();
  input.select();

  let finished = false;
  function finishEdit(shouldCommit = true) {
    if (finished || editingTabId !== tab.id) return;
    finished = true;
    document.removeEventListener('pointerdown', onOutsideInteract, true);
    document.removeEventListener('mousedown', onOutsideInteract, true);
    document.removeEventListener('touchstart', onOutsideInteract, true);
    document.removeEventListener('click', onOutsideInteract, true);
    document.removeEventListener('focusin', onOutsideInteract, true);
    window.removeEventListener('blur', onWindowBlur, true);
    const t = tabs.find((x) => x.id === tab.id);
    if (t) {
      t.title = shouldCommit ? input.value.trim() : originalTitle;
    }
    editingTabId = null;
    saveTabs();
    renderTabs();
  }

  function onOutsideInteract(e) {
    if (e.target === input || input.contains(e.target)) return;
    finishEdit(true);
  }

  function onWindowBlur() {
    finishEdit(true);
  }

  document.addEventListener('pointerdown', onOutsideInteract, true);
  document.addEventListener('mousedown', onOutsideInteract, true);
  document.addEventListener('touchstart', onOutsideInteract, true);
  document.addEventListener('click', onOutsideInteract, true);
  document.addEventListener('focusin', onOutsideInteract, true);
  window.addEventListener('blur', onWindowBlur, true);
  input.addEventListener('blur', () => finishEdit(true));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finishEdit(true);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      finishEdit(false);
    }
  });
}

// ─── Tab operations ─────────────────────────────────────────

function switchTab(id) {
  flushActiveTab();
  undoStack.length = 0;
  redoStack.length = 0;

  activeTabId = id;
  const tab = tabs.find((t) => t.id === id);

  if (tab) {
    setEditorTextHighlighted(tab.content);
    if (uiMode === 'compare') {
      compareDraft.leftText = tab.content || '';
      compareLeftInput.textContent = compareDraft.leftText;
      runCompare();
    }
    if (foldedLines.size === 0) editor.contentEditable = 'true';
    editorContainer.classList.remove('hidden');
    emptyState.classList.add('hidden');
  }

  renderTabs();
  saveTabs();
  updateLineNumbers();
  clearValidationMessage();
  const result = validateJson(false);
  formatBtn.disabled = !result.valid;
  updateMinifyButton();
  updateCollapseExpandButtons();
  syncBottomActionButtonsState();
  if (searchQuery) scrollToFirstEditorSearchHit();
}

async function addTab(initialContent = '') {
  if (tabs.length >= MAX_TABS) return;

  flushActiveTab();
  undoStack.length = 0;
  redoStack.length = 0;

  const newTab = { id: generateId(), content: initialContent || '', title: '' };
  tabs.push(newTab);
  activeTabId = newTab.id;

  setEditorTextHighlighted(newTab.content);
  editorContainer.classList.remove('hidden');
  emptyState.classList.add('hidden');

  renderTabs();
  await saveTabs();
  updateLineNumbers();
  clearValidationMessage();
  const result = validateJson(false);
  formatBtn.disabled = !result.valid;
  updateCollapseExpandButtons();
  syncBottomActionButtonsState();
  editor.focus();
}

async function deleteTab(id) {
  const index = tabs.findIndex((t) => t.id === id);
  if (index === -1) return;

  flushActiveTab();

  tabs.splice(index, 1);

  if (tabs.length === 0) {
    tabs = [{ id: generateId(), content: '', title: '' }];
    await saveTabs();
  }

  if (activeTabId === id) {
    const newActiveIndex = Math.min(index, tabs.length - 1);
    activeTabId = tabs[newActiveIndex].id;
    const newTab = tabs.find((t) => t.id === activeTabId);
    setEditorTextHighlighted(newTab ? newTab.content : '');
    updateLineNumbers();
    clearValidationMessage();
    const res = validateJson(false);
    formatBtn.disabled = !res.valid;
    updateCollapseExpandButtons();
    syncBottomActionButtonsState();

    // Always show editor when we have at least one tab (never show empty state)
    editorContainer.classList.remove('hidden');
    emptyState.classList.add('hidden');
  }

  renderTabs();
  await saveTabs();
  syncBottomActionButtonsState();
}

async function duplicateTab(id) {
  if (tabs.length >= MAX_TABS) return;
  flushActiveTab();
  undoStack.length = 0;
  redoStack.length = 0;
  const original = tabs.find((t) => t.id === id);
  if (!original) return;
  const newTab = { id: generateId(), content: original.content, title: original.title + ' (copy)' };
  tabs.push(newTab);
  activeTabId = newTab.id;
  setEditorTextHighlighted(newTab.content);
  editorContainer.classList.remove('hidden');
  emptyState.classList.add('hidden');
  renderTabs();
  await saveTabs();
  updateLineNumbers();
  clearValidationMessage();
  const result = validateJson(false);
  formatBtn.disabled = !result.valid;
  updateCollapseExpandButtons();
  syncBottomActionButtonsState();
  updateStatusBar();
  syncBottomActionButtonsState();
}

// ─── Line numbers ───────────────────────────────────────────

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function updateStatusBar() {
  if (!statusBar) return;
  const text = getEditorText();
  const bytes = new Blob([text]).size;
  const size = formatFileSize(bytes);
  statusBar.textContent = size;
}

// ─── Validation ─────────────────────────────────────────────

function clearValidationMessage() {
  if (!validationEl) return;
  validationEl.textContent = '';
  validationEl.className = 'validation';
  validationEl.removeAttribute('title');
}

function validateJson(showMessage = false) {
  const text = getEditorText().trim();
  if (!showMessage || !validationEl) {
    if (!text) return { valid: false };
    try {
      JSON.parse(text);
      return { valid: true };
    } catch {
      return { valid: false };
    }
  }
  if (!text) {
    clearValidationMessage();
    return { valid: false };
  }
  try {
    JSON.parse(text);
    validationEl.textContent = 'Valid JSON';
    validationEl.className = 'validation valid';
    validationEl.removeAttribute('title');
    return { valid: true };
  } catch (err) {
    let msg = (err && err.message) ? String(err.message) : 'Invalid JSON';
    const trimmed = text.replace(/\s+/g, ' ').trim();
    if (/after JSON at position \d+/i.test(msg) && /\}\s*,?\s*\{/.test(trimmed)) {
      msg = 'Multiple values at top level. Use one object or wrap in an array: [ {...}, {...} ]';
    }
    msg = msg.slice(0, 200).replace(/\s+/g, ' ');
    validationEl.textContent = 'Invalid JSON — ' + msg;
    validationEl.className = 'validation invalid';
    validationEl.title = msg;
    return { valid: false };
  }
}

function validateStoreContent() {
  if (uiMode !== 'editor') return;
  validateJson(true);
}

// ─── Scroll sync ────────────────────────────────────────────

function syncScroll() {
  lineNumbers.scrollTop = editor.scrollTop;
  foldGutter.scrollTop = editor.scrollTop;
  if (foldedLines.size > 0) {
    foldOverlay.style.transform = `translateY(-${editor.scrollTop}px)`;
  }
}

// ─── Editor input handling ──────────────────────────────────

function onEditorInput() {
  if (Date.now() < ignoreInputUntil) return;
  const text = getEditorText();
  /* When content is empty or only whitespace, only update UI; do not overwrite the editor DOM (avoids content disappearing when getEditorText is briefly wrong or when folded). */
  if (!text || !text.trim()) {
    updatePlaceholder(text || '');
    updateLineNumbers();
    updateStatusBar();
    clearValidationMessage();
    formatBtn.disabled = true;
    updateCollapseExpandButtons();
    clearTimeout(highlightTimer);
    highlightTimer = null;
    debounceTimer = setTimeout(() => {
      if (activeTabId) {
        const tab = tabs.find((t) => t.id === activeTabId);
        if (tab) {
          tab.content = getEditorText();
          saveTabs();
          renderTabs();
        }
      }
    }, DEBOUNCE_MS);
    syncBottomActionButtonsState();
    return;
  }
  updatePlaceholder(text);
  updateLineNumbers();
  updateStatusBar();
  clearValidationMessage();
  const result = validateJson(false);
  formatBtn.disabled = !result.valid;
  updateCollapseExpandButtons();

  // Debounced re-highlight (longer delay to preserve undo/redo)
  clearTimeout(highlightTimer);
  highlightTimer = setTimeout(() => {
    reHighlight();
  }, HIGHLIGHT_DEBOUNCE_MS);

  // Debounced save
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    if (activeTabId) {
      const tab = tabs.find((t) => t.id === activeTabId);
      if (tab) {
        tab.content = getEditorText();
        saveTabs();
        renderTabs();
      }
    }
  }, DEBOUNCE_MS);
  syncBottomActionButtonsState();
}

// ─── Key handlers for contenteditable ───────────────────────

/**
 * Insert text at the current cursor position using direct text manipulation.
 * Avoids execCommand which splits <code> elements and creates ghost nodes.
 */
function insertAtCursor(chars) {
  pushUndoState(getEditorText());
  const text = getEditorText();
  let offset = getCaretCharOffset(editorCode);
  if (offset < 0) offset = text.length;

  const newText = text.slice(0, offset) + chars + text.slice(offset);

  clearTimeout(highlightTimer);
  clearTimeout(debounceTimer);
  highlightTimer = null;

  setEditorTextHighlighted(newText);
  setCaretCharOffset(editorCode, offset + chars.length);

  updatePlaceholder(newText);
  updateLineNumbers();
  const result = validateJson(false);
  formatBtn.disabled = !result.valid;
  updateCollapseExpandButtons();

  debounceTimer = setTimeout(() => {
    if (activeTabId) {
      const tab = tabs.find((t) => t.id === activeTabId);
      if (tab) {
        tab.content = getEditorText();
        saveTabs();
        renderTabs();
      }
    }
  }, DEBOUNCE_MS);
}

function onEditorKeydown(e) {
  if (e.key === 'z' || e.key === 'y' || e.key === 'Z') {
    if (e.ctrlKey || e.metaKey) {
      if (e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        performRedo();
        return;
      }
      if (!e.shiftKey) {
        if (e.key === 'z') {
          e.preventDefault();
          performUndo();
          return;
        }
        if (e.key === 'y') {
          e.preventDefault();
          performRedo();
          return;
        }
      }
    }
  }


  if (e.key === 'Enter') {
    e.preventDefault();
    insertAtCursor('\n');
  }

  if (e.key === 'Tab') {
    e.preventDefault();
    insertAtCursor('  ');
  }

  /* Manual arrow handling: only when selection is in editorCode; avoid getEditorText() so we don't consolidate and destroy Prism DOM on every key */
  /* Bypass custom handling when Shift is pressed to preserve native text selection (Shift+Arrow) */
  if (e.shiftKey) return;
  const offset = getCaretCharOffset(editorCode);
  if (offset < 0) return; /* selection not in editor (e.g. in ghost node): let browser handle */
  const text = editorCode.textContent || '';
  const len = text.length;

  if (e.key === 'ArrowLeft' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (offset > 0) {
      e.preventDefault();
      e.stopPropagation();
      setCaretCharOffset(editorCode, offset - 1);
      editor.focus();
    }
    return;
  }
  if (e.key === 'ArrowRight' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (offset < len) {
      e.preventDefault();
      e.stopPropagation();
      setCaretCharOffset(editorCode, offset + 1);
      editor.focus();
    }
    return;
  }
  if (e.key === 'ArrowUp' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const before = text.slice(0, offset);
    const lineStart = before.lastIndexOf('\n') + 1;
    const col = offset - lineStart;
    if (lineStart > 0) {
      e.preventDefault();
      e.stopPropagation();
      const prevChunk = text.slice(0, lineStart - 1);
      const prevLineStart = prevChunk.lastIndexOf('\n') + 1;
      const prevLine = text.slice(prevLineStart, lineStart - 1);
      const newCol = Math.min(col, prevLine.length);
      setCaretCharOffset(editorCode, prevLineStart + newCol);
      editor.focus();
    }
    return;
  }
  if (e.key === 'ArrowDown' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const before = text.slice(0, offset);
    const lineStart = before.lastIndexOf('\n') + 1;
    const col = offset - lineStart;
    const lineEnd = text.indexOf('\n', offset);
    const nextLineStart = lineEnd === -1 ? len : lineEnd + 1;
    if (nextLineStart < len || (lineEnd !== -1 && offset < len)) {
      e.preventDefault();
      e.stopPropagation();
      const nextLineEnd = text.indexOf('\n', nextLineStart);
      const nextLineLen = nextLineEnd === -1 ? len - nextLineStart : nextLineEnd - nextLineStart;
      const newCol = Math.min(col, nextLineLen);
      setCaretCharOffset(editorCode, nextLineStart + newCol);
      editor.focus();
    }
    return;
  }
}

// ─── Paste handler (strip HTML, insert plain text) ──────────

function onEditorPaste(e) {
  e.preventDefault();
  const pastedText = e.clipboardData?.getData('text/plain') || '';
  if (!pastedText) return;

  pushUndoState(getEditorText());

  const currentText = getEditorText();
  let offset = getCaretCharOffset(editorCode);
  if (offset < 0) offset = currentText.length;
  const newText = currentText.slice(0, offset) + pastedText + currentText.slice(offset);

  clearTimeout(highlightTimer);
  clearTimeout(debounceTimer);
  highlightTimer = null;

  setEditorTextHighlighted(newText);
  updateLineNumbers();
  const result = validateJson(false);
  formatBtn.disabled = !result.valid;
  updateCollapseExpandButtons();

  const newOffset = offset + pastedText.length;
  if (newOffset >= 0) setCaretCharOffset(editorCode, newOffset);

  debounceTimer = setTimeout(() => {
    if (activeTabId) {
      const tab = tabs.find((t) => t.id === activeTabId);
      if (tab) {
        tab.content = getEditorText();
        saveTabs();
        renderTabs();
      }
    }
  }, DEBOUNCE_MS);
}

// ─── Actions ────────────────────────────────────────────────

async function copyContent() {
  try {
    await navigator.clipboard.writeText(getEditorText());
    const originalText = copyBtn.textContent;
    copyBtn.textContent = 'Copied!';
    setTimeout(() => { copyBtn.textContent = originalText; }, 1500);
  } catch (err) {
    console.error('Copy failed:', err);
    const originalText = copyBtn.textContent;
    copyBtn.textContent = 'Copy failed';
    copyBtn.title = err instanceof Error ? err.message : 'Clipboard access denied';
    setTimeout(() => {
      copyBtn.textContent = originalText;
      copyBtn.title = 'Copy the current JSON to the clipboard (Ctrl+Shift+C)';
    }, 2000);
  }
}

function clearContent() {
  pushUndoState(getEditorText());
  setEditorTextPlain('');
  updateLineNumbers();
  updateStatusBar();
  clearValidationMessage();
  formatBtn.disabled = true;
  updateCollapseExpandButtons();
  if (activeTabId) {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (tab) {
      tab.content = '';
      saveTabs();
      renderTabs();
    }
  }
  editor.focus();
}

function clearCompareInputs() {
  compareDraft.leftText = '';
  compareDraft.rightText = '';
  compareLeftInput.textContent = '';
  compareRightInput.textContent = '';
  compareLeftInput.dataset.compareRendered = 'false';
  compareRightInput.dataset.compareRendered = 'false';
  setCompareStatus('neutral', 'Ready to compare');
  applySearchHighlights();
}

function clearCompareInput(side) {
  if (side === 'left') {
    compareDraft.leftText = '';
    compareLeftInput.textContent = '';
    compareLeftInput.dataset.compareRendered = 'false';
  } else {
    compareDraft.rightText = '';
    compareRightInput.textContent = '';
    compareRightInput.dataset.compareRendered = 'false';
  }
  setCompareStatus('neutral', 'Ready to compare');
  applySearchHighlights();
}

function handleClearAction() {
  if (uiMode === 'compare') {
    clearCompareInputs();
    return;
  }
  clearContent();
}

async function storeCompareInput(side) {
  const raw = side === 'left'
    ? getCompareInputPlainText(compareLeftInput, 'left')
    : getCompareInputPlainText(compareRightInput, 'right');
  const text = String(raw || '').trim();
  if (!text) return;
  const normalized = normalizeJsonText(text);
  await addTab(normalized);
  setMode('editor');
}

function moveEditorToCompare() {
  const text = normalizeJsonText(getEditorText());
  if (!text) return;
  compareDraft.leftText = text;
  compareDraft.rightText = compareDraft.rightText || '';
  compareLeftInput.textContent = compareDraft.leftText;
  compareRightInput.textContent = compareDraft.rightText;
  compareLeftInput.dataset.compareRendered = 'false';
  compareRightInput.dataset.compareRendered = 'false';
  setMode('compare', { preserveCompareDraft: true });
}

function formatContent() {
  const text = getEditorText().trim();
  if (!text) return;
  pushUndoState(getEditorText());
  try {
    const parsed = JSON.parse(text);
    const formatted = JSON.stringify(parsed, null, 2);
    setEditorTextHighlighted(formatted);
    updateLineNumbers();
  } catch {
    return;
  }
  if (activeTabId) {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (tab) {
      tab.content = getEditorText();
      saveTabs();
      renderTabs();
    }
  }
  clearValidationMessage();
  editor.focus();
}

function minifyContent() {
  const text = getEditorText().trim();
  if (!text) return;
  pushUndoState(getEditorText());
  try {
    const parsed = JSON.parse(text);
    const minified = JSON.stringify(parsed);
    setEditorTextHighlighted(minified);
    updateLineNumbers();
  } catch {
    return;
  }
  if (activeTabId) {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (tab) {
      tab.content = getEditorText();
      saveTabs();
      renderTabs();
    }
  }
  clearValidationMessage();
  editor.focus();
}

function downloadContent() {
  const text = getEditorText().trim();
  if (!text) return;
  const tab = activeTabId ? tabs.find((t) => t.id === activeTabId) : null;
  const baseName = (tab?.title || 'json').trim() || 'json';
  const safeName = baseName.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').slice(0, 80) || 'export';
  const filename = safeName.endsWith('.json') ? safeName : safeName + '.json';
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Enable/disable Collapse and Expand based on whether JSON is visible (editor open and non-empty). */
function updateCollapseExpandButtons() {
  const visible = !editorContainer.classList.contains('hidden');
  const hasContent = (getEditorText() || '').trim().length > 0;
  const enabled = visible && hasContent;
  if (collapseBtn) collapseBtn.disabled = !enabled;
  if (expandBtn) expandBtn.disabled = !enabled;
  updateMinifyButton();
}

/** Enable/disable Minify based on valid JSON. */
function updateMinifyButton() {
  const text = (getEditorText() || '').trim();
  let valid = false;
  if (text) {
    try {
      JSON.parse(text);
      valid = true;
    } catch (_) {}
  }
  if (minifyBtn) minifyBtn.disabled = !valid;
}

function collapseAll() {
  const full = getFullContent();
  if (!full.trim()) return;
  const ranges = computeFoldRanges(full);
  ranges.forEach((r) => foldedLines.add(r.startLine));
  applyFoldView();
  updateLineNumbers();
  updateCollapseExpandButtons();
}

function expandAll() {
  foldedLines.clear();
  applyFoldView();
  updateLineNumbers();
  updateCollapseExpandButtons();
}

// ─── Code folding (gutter arrows) ───────────────────────────

const EDITOR_LINE_HEIGHT = 1.5;
const EDITOR_FONT_SIZE_PX = 13;
const EDITOR_PADDING = 12;

/**
 * Find foldable blocks: each item is { startLine, endLine } for a { } or [ ] block.
 * Uses brace matching; ignores braces inside strings.
 */
function computeFoldRanges(text) {
  const ranges = [];
  let inString = null;
  let escape = false;
  const stack = [];
  let line = 0;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\n') {
      line++;
      continue;
    }
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (c === '\\') escape = true;
      else if (c === inString) inString = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = c;
      continue;
    }
    if (c === '{' || c === '[') {
      stack.push({ type: c === '{' ? '}' : ']', startLine: line });
      continue;
    }
    if (c === '}' || c === ']') {
      if (stack.length > 0 && stack[stack.length - 1].type === c) {
        const { startLine } = stack.pop();
        if (line > startLine) ranges.push({ startLine, endLine: line });
      }
      continue;
    }
  }
  // One fold per start line: keep outermost block (max endLine) so one arrow per line
  const byStart = new Map();
  ranges.forEach((r) => {
    const existing = byStart.get(r.startLine);
    if (!existing || r.endLine > existing.endLine) byStart.set(r.startLine, r);
  });
  return Array.from(byStart.values());
}

/** Cached fold computation; invalidated when content changes. */
let _cachedFoldText = null;
let _cachedFoldRanges = null;

function getFoldBoundaries(fullText) {
  if (_cachedFoldText === fullText) return _cachedFoldRanges;
  _cachedFoldText = fullText;
  _cachedFoldRanges = computeFoldRanges(fullText);
  return _cachedFoldRanges;
}

/** Build indexed map: lineIndex -> fold range if line is inside a folded block, else null. O(lines) total. */
function buildLineToFoldIndex(fullText) {
  const ranges = getFoldBoundaries(fullText);
  const lines = fullText.split('\n');
  const lineToFold = new Array(lines.length);
  for (const r of ranges) {
    if (!foldedLines.has(r.startLine)) continue;
    for (let i = r.startLine; i <= r.endLine; i++) {
      lineToFold[i] = r;
    }
  }
  return lineToFold;
}

/**
 * View rows when collapsed (VS Code style): only visible lines, no separate fold row.
 * Each item is { type: 'line', lineIndex, content, foldedBlock }.
 * foldedBlock is set on the opening line of a folded block (value = endLine) so we append " ...".
 */
function getViewLines(fullText) {
  const lines = fullText.split('\n');
  if (lines.length === 0) return [];
  const lineToFold = buildLineToFoldIndex(fullText);
  const viewLines = [];
  for (let i = 0; i < lines.length; i++) {
    const folded = lineToFold[i];
    if (folded && i > folded.startLine && i < folded.endLine) continue;
    if (folded && i === folded.startLine) {
      viewLines.push({ type: 'line', lineIndex: i, content: lines[i], foldedBlock: folded.endLine });
      i = folded.endLine - 1;
      continue;
    }
    viewLines.push({ type: 'line', lineIndex: i, content: lines[i], foldedBlock: null });
  }
  return viewLines;
}

/** Collapsed view as a single string (VS Code style: opening line + " ...", then closing line). */
function getDisplayText(fullText) {
  const viewLines = getViewLines(fullText);
  return viewLines
    .map((v) => {
      const line = v.content;
      if (v.foldedBlock != null) {
        const trimmed = line.trimEnd();
        return trimmed + (trimmed ? ' ' : '') + '...';
      }
      return line;
    })
    .join('\n');
}

/** Show collapsed view in editor when folded; full content when not. Editor read-only when folded. */
function applyFoldView() {
  if (foldedLines.size > 0) {
    const full = getFullContent();
    if (full) {
      const display = getDisplayText(full);
      setEditorTextHighlighted(display, false);
    }
    editor.contentEditable = 'false';
  } else {
    const tab = activeTabId ? tabs.find((t) => t.id === activeTabId) : null;
    const full = tab ? tab.content : getFullContent();
    setEditorTextHighlighted(full, false);
    editor.contentEditable = 'true';
  }
}

function updateFoldGutter() {
  const full = getFullContent();
  const lines = full.split('\n');
  const ranges = getFoldBoundaries(full);
  const startLineSet = new Set(ranges.map((r) => r.startLine));

  foldGutter.textContent = '';
  foldGutter.style.lineHeight = String(EDITOR_LINE_HEIGHT);

  if (foldedLines.size > 0) {
    const viewLines = getViewLines(full);
    viewLines.forEach((v) => {
      const row = document.createElement('div');
      row.className = 'fold-gutter-row';
      row.dataset.line = String(v.lineIndex);
      if (startLineSet.has(v.lineIndex)) {
        const icon = document.createElement('span');
        icon.className = 'fold-icon';
        icon.textContent = foldedLines.has(v.lineIndex) ? '▶' : '▼';
        icon.setAttribute('aria-label', foldedLines.has(v.lineIndex) ? 'Expand' : 'Collapse');
        row.appendChild(icon);
      }
      foldGutter.appendChild(row);
    });
  } else {
    const count = Math.max(1, lines.length);
    for (let i = 0; i < count; i++) {
      const row = document.createElement('div');
      row.className = 'fold-gutter-row';
      row.dataset.line = String(i);
      if (startLineSet.has(i)) {
        const icon = document.createElement('span');
        icon.className = 'fold-icon';
        icon.textContent = '▼';
        icon.setAttribute('aria-label', 'Collapse');
        row.appendChild(icon);
      }
      foldGutter.appendChild(row);
    }
  }
}

function updateFoldOverlay() {
  foldOverlay.innerHTML = '';
  foldOverlay.style.display = 'none';
  foldOverlay.style.transform = '';
}

function updateLineNumbers() {
  const full = getFullContent();
  const lines = full.split('\n');
  const count = Math.max(1, lines.length);

  let maxWidth;
  if (foldedLines.size > 0) {
    const viewLines = getViewLines(full);
    maxWidth = Math.max(...viewLines.map((v) => (v.lineIndex + 1).toString().length), 1);
    lineNumbers.textContent = viewLines
      .map((v) => (v.lineIndex + 1).toString().padStart(maxWidth, ' '))
      .join('\n');
  } else {
    maxWidth = count.toString().length;
    lineNumbers.textContent = Array.from({ length: count }, (_, i) => (i + 1).toString().padStart(maxWidth, ' ')).join('\n');
  }
  lineNumbers.style.minWidth = Math.max(36, maxWidth * 8 + 28) + 'px';
  updateFoldGutter();
  updateFoldOverlay();
}

function toggleFold(startLine) {
  if (foldedLines.has(startLine)) foldedLines.delete(startLine);
  else foldedLines.add(startLine);
  applyFoldView();
  updateLineNumbers();
}

function onFoldGutterClick(e) {
  const row = e.target.closest('.fold-gutter-row');
  if (!row || !row.querySelector('.fold-icon')) return;
  e.preventDefault();
  e.stopPropagation();
  const line = parseInt(row.dataset.line, 10);
  if (Number.isNaN(line)) return;
  toggleFold(line);
}

// ─── Drop zone ──────────────────────────────────────────────

function setupDropZone(el) {
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    el.classList.add('drag-over');
  });
  el.addEventListener('dragleave', (e) => {
    if (!el.contains(e.relatedTarget)) el.classList.remove('drag-over');
  });
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('drag-over');
    const text = e.dataTransfer.getData('text/plain');
    if (!text) return;
    if (activeTabId) {
      const tab = tabs.find((t) => t.id === activeTabId);
      if (tab) {
        const current = getEditorText();
        const newContent = current + (current ? '\n' : '') + text;
        tab.content = newContent;
        setEditorTextHighlighted(newContent);
        editorContainer.classList.remove('hidden');
        emptyState.classList.add('hidden');
        updateLineNumbers();
        updateStatusBar();
        const res = validateJson(false);
        formatBtn.disabled = !res.valid;
        updateCollapseExpandButtons();
        saveTabs();
        renderTabs();
      }
    } else {
      addTab(text);
    }
  });
}

// ─── Paste on content area (outside editor) ─────────────────

function onGlobalPaste(e) {
  // If another handler already consumed this paste event, do nothing.
  if (e.defaultPrevented) return;

  // If paste is inside the editor, the editor's own paste handler deals with it
  if (editor.contains(e.target)) return;

  const text = e.clipboardData?.getData('text/plain');
  if (text) {
    e.preventDefault();
    if (activeTabId) {
        const tab = tabs.find((t) => t.id === activeTabId);
        if (tab) {
          const current = getEditorText();
          const newContent = current + (current ? '\n' : '') + text;
          tab.content = newContent;
          setEditorTextHighlighted(newContent);
          editorContainer.classList.remove('hidden');
          emptyState.classList.add('hidden');
          updateLineNumbers();
          updateStatusBar();
          const res = validateJson(false);
          formatBtn.disabled = !res.valid;
          updateCollapseExpandButtons();
        saveTabs();
        renderTabs();
      }
    } else {
      addTab(text);
    }
  }
}

// ─── Init ───────────────────────────────────────────────────

async function init() {
  const theme = await loadTheme();
  applyTheme(theme);

  await loadTabs();

  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }
  if (sidebarSearch) {
    sidebarSearch.addEventListener('input', (e) => {
      searchQuery = (e.target.value || '').trim().toLowerCase();
      renderTabs();
      renderCaptureList();
      applySearchHighlights();
      scrollToFirstEditorSearchHit();
    });
  }
  if (compareModeBtn) {
    compareModeBtn.addEventListener('click', () => {
      setMode('compare');
    });
  }
  if (captureModeBtn) {
    captureModeBtn.addEventListener('click', () => setMode('captures'));
  }
  if (singleModeBtn) {
    singleModeBtn.addEventListener('click', () => setMode('editor'));
  }
  if (runCompareBtn) runCompareBtn.addEventListener('click', runCompare);
  if (compareLeftInput) {
    compareLeftInput.addEventListener('beforeinput', () => {
      clearSearchHighlights(compareLeftInput);
      ensureCompareEditorPlainText(compareLeftInput, 'left');
    });
    compareLeftInput.addEventListener('paste', (e) => {
      e.preventDefault();
      ensureCompareEditorPlainText(compareLeftInput, 'left');
      const text = e.clipboardData?.getData('text/plain') || '';
      if (!text) return;
      compareLeftInput.focus();
      insertPlainTextAtSelection(compareLeftInput, text);
      compareDraft.leftText = compareLeftInput.textContent || '';
      compareLeftInput.dataset.compareRendered = 'false';
    });
    compareLeftInput.addEventListener('input', () => {
      compareDraft.leftText = compareLeftInput.textContent || '';
      compareLeftInput.dataset.compareRendered = 'false';
      setCompareStatus('neutral', 'Ready to compare');
      if (searchQuery) applySearchHighlights();
    });
  }
  if (compareRightInput) {
    compareRightInput.addEventListener('beforeinput', () => {
      clearSearchHighlights(compareRightInput);
      ensureCompareEditorPlainText(compareRightInput, 'right');
    });
    compareRightInput.addEventListener('paste', (e) => {
      e.preventDefault();
      ensureCompareEditorPlainText(compareRightInput, 'right');
      const text = e.clipboardData?.getData('text/plain') || '';
      if (!text) return;
      compareRightInput.focus();
      insertPlainTextAtSelection(compareRightInput, text);
      compareDraft.rightText = compareRightInput.textContent || '';
      compareRightInput.dataset.compareRendered = 'false';
    });
    compareRightInput.addEventListener('input', () => {
      compareDraft.rightText = compareRightInput.textContent || '';
      compareRightInput.dataset.compareRendered = 'false';
      setCompareStatus('neutral', 'Ready to compare');
      if (searchQuery) applySearchHighlights();
    });
  }
  if (storeLeftCompareBtn) {
    storeLeftCompareBtn.addEventListener('click', () => {
      storeCompareInput('left');
    });
  }
  if (clearLeftCompareBtn) {
    clearLeftCompareBtn.addEventListener('click', () => {
      clearCompareInput('left');
    });
  }
  if (storeRightCompareBtn) {
    storeRightCompareBtn.addEventListener('click', () => {
      storeCompareInput('right');
    });
  }
  if (clearRightCompareBtn) {
    clearRightCompareBtn.addEventListener('click', () => {
      clearCompareInput('right');
    });
  }
  if (runCaptureScanBtn) {
    runCaptureScanBtn.addEventListener('click', async () => {
      const confirmed = await askCaptureScanConfirmation();
      if (!confirmed) return;
      captureScanArmed = true;
      await runCaptureScan();
    });
  }
  if (refreshCapturesBtn) refreshCapturesBtn.addEventListener('click', refreshCaptures);
  if (clearCapturesBtn) {
    clearCapturesBtn.addEventListener('click', async () => {
      await refreshCaptures();
      await runtimeMessage({ type: 'capture:clear', tabId: currentBrowserTabId });
      selectedCaptureId = null;
      selectedCaptureIds = [];
      await refreshCaptures();
    });
  }
  if (compareSelectedCapturesBtn) {
    compareSelectedCapturesBtn.addEventListener('click', openSelectedCapturesInCompare);
  }
  if (storeSelectedCapturesBtn) {
    storeSelectedCapturesBtn.addEventListener('click', storeSelectedCapturesToTabs);
  }

  if (tabs.length > 0) {
    const validActiveId = activeTabId && tabs.some((t) => t.id === activeTabId);
    if (!validActiveId) activeTabId = tabs[0].id;
    const activeTab = tabs.find((t) => t.id === activeTabId);
    setEditorTextHighlighted(activeTab?.content || '');
    editorContainer.classList.remove('hidden');
    emptyState.classList.add('hidden');
  } else {
    emptyState.classList.remove('hidden');
    editorContainer.classList.add('hidden');
  }

  renderTabs();
  renderCaptureList();
  updateLineNumbers();
  updateStatusBar();
  const result = validateJson(false);
  formatBtn.disabled = !result.valid;
  updateCollapseExpandButtons();
  setMode('editor');

  if (chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === 'capture:updated' && uiMode === 'captures') {
        refreshCaptures();
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (uiMode !== 'editor') return;
    if (e.ctrlKey || e.metaKey) {
      if (e.shiftKey && e.key === 'F') { e.preventDefault(); formatContent(); }
      if (e.shiftKey && e.key === 'M') { e.preventDefault(); minifyContent(); }
      if (e.shiftKey && e.key === 'X') { e.preventDefault(); clearContent(); }
      if (e.shiftKey && e.key === 'C') { e.preventDefault(); copyContent(); }
    }
  });

  // beforeinput: push current state to undo before typing (enables Ctrl+Z)
  editor.addEventListener('beforeinput', (e) => {
    if (searchQuery) clearSearchHighlights(editorCode);
    if (isUndoRedo || foldedLines.size > 0) return;
    const types = ['insertText', 'insertFromDrop', 'insertLineBreak',
      'deleteContentBackward', 'deleteContentForward', 'deleteByCut'];
    if (types.includes(e.inputType)) pushUndoState(getEditorText());
  });

  // Editor events — arrow keys use capture so we run before browser default
  editor.addEventListener('input', onEditorInput);
  editor.addEventListener('keydown', onEditorKeydown, { capture: true });
  editor.addEventListener('paste', onEditorPaste);
  editor.addEventListener('scroll', syncScroll);

  editor.addEventListener('focus', () => {
    if (foldedLines.size === 0 && editor.contentEditable !== 'true') {
      editor.contentEditable = 'true';
    }
    try {
      const sel = window.getSelection();
      if (!sel.rangeCount || !editor.contains(sel.getRangeAt(0).startContainer)) {
        const range = document.createRange();
        range.selectNodeContents(editorCode);
        range.collapse(false);
        if (range.startContainer?.isConnected) {
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
    } catch (_) { /* addRange can throw if range isn't in document */ }
  });

  // Button events
  addTabBtn.addEventListener('click', () => addTab());
  copyBtn.addEventListener('click', copyContent);
  formatBtn.addEventListener('click', formatContent);
  clearBtn.addEventListener('click', handleClearAction);
  minifyBtn.addEventListener('click', minifyContent);
  if (validateBtn) validateBtn.addEventListener('click', validateStoreContent);
  duplicateBtn.addEventListener('click', () => duplicateTab(activeTabId));
  downloadBtn.addEventListener('click', downloadContent);
  if (moveToCompareBtn) moveToCompareBtn.addEventListener('click', moveEditorToCompare);
  collapseBtn.addEventListener('click', collapseAll);
  expandBtn.addEventListener('click', expandAll);
  foldGutter.addEventListener('click', onFoldGutterClick);

  // Global paste and drop
  document.addEventListener('paste', onGlobalPaste);
  setupDropZone(contentArea);

  // Focus content area for paste when clicking empty zone
  contentArea.addEventListener('click', (e) => {
    if (!editorContainer.contains(e.target)) {
      contentArea.focus();
    }
  });

  // Save when panel is closed/hidden so changes persist (debounce may not have fired).
  // Send to background script so persistence completes even if panel context is torn down.
  function saveBeforeClose() {
    stopCapturePolling();
    flushActiveTab();
    if (hasStorage()) {
      chrome.storage.local.set({ tabs, [LAST_ACTIVE_TAB_KEY]: activeTabId }).catch(() => {});
      chrome.runtime.sendMessage({ type: 'saveTabs', tabs, lastActiveTabId: activeTabId }).catch(() => {});
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveBeforeClose();
  });
  window.addEventListener('pagehide', saveBeforeClose);
  window.addEventListener('beforeunload', saveBeforeClose);
}

init();
