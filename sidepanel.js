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
const statusBar = document.getElementById('statusBar');
const editorPanel = document.getElementById('editorPanel');
const foldGutter = document.getElementById('foldGutter');
const foldOverlay = document.getElementById('foldOverlay');
const emptyState = document.getElementById('emptyState');
const editorContainer = document.getElementById('editorContainer');

// State
let tabs = [];
let activeTabId = null;
let debounceTimer = null;
let highlightTimer = null;
let editingTabId = null;
/** Set of startLine numbers for currently folded blocks */
let foldedLines = new Set();

function hasStorage() {
  return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
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
  const children = Array.from(editor.childNodes);
  const ghosts = children.filter((n) => n !== editorCode && n !== foldOverlay);
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
  if (foldedLines.size > 0 && activeTabId) {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (tab) return tab.content || '';
  }
  consolidateGhostNodes();
  return editorCode.textContent || '';
}

/**
 * Get the plain text from the contenteditable editor (or full content when folded).
 */
function getEditorText() {
  return getFullContent();
}

/** Remove any ghost nodes that are siblings of <code> inside <pre>. */
function clearEditorGhostNodes() {
  Array.from(editor.childNodes).forEach((n) => {
    if (n !== editorCode) n.remove();
  });
}

/**
 * Set editor content as plain text (no highlighting).
 */
function setEditorTextPlain(text) {
  editorCode.textContent = text;
  clearEditorGhostNodes();
  updatePlaceholder(text);
  foldedLines.clear();
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
}

/**
 * Get the caret position as a character offset from start of element.
 */
function getCaretCharOffset(element) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return -1;
  const range = sel.getRangeAt(0);
  const preRange = range.cloneRange();
  preRange.selectNodeContents(element);
  preRange.setEnd(range.startContainer, range.startOffset);
  return preRange.toString().length;
}

/**
 * Set the caret to a character offset within element.
 */
function setCaretCharOffset(element, targetOffset) {
  const sel = window.getSelection();
  const range = document.createRange();
  let found = false;

  function walk(node, offset) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (offset + node.length >= targetOffset) {
        range.setStart(node, targetOffset - offset);
        range.collapse(true);
        found = true;
        return offset + node.length;
      }
      return offset + node.length;
    }
    for (const child of node.childNodes) {
      offset = walk(child, offset);
      if (found) return offset;
    }
    return offset;
  }

  walk(element, 0);

  if (found) {
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

function updatePlaceholder(text) {
  if (!text || !text.trim()) {
    editorPlaceholder.classList.remove('hidden');
  } else {
    editorPlaceholder.classList.add('hidden');
  }
}

// ─── Storage ────────────────────────────────────────────────

async function saveTabs() {
  if (!hasStorage()) return;
  try {
    await chrome.storage.local.set({ tabs, [LAST_ACTIVE_TAB_KEY]: activeTabId });
  } catch (err) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/83038061-d1d3-431b-abcf-197c7d6bb243',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'sidepanel.js:saveTabs:catch',message:'saveTabs threw, setting storage error UI',data:{errMsg:String(err&&err.message)},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
    // #endregion
    console.error('Failed to save tabs:', err);
    validationEl.textContent = '⚠️ Could not save to storage. Changes may not persist.';
    validationEl.className = 'validation warning';
  }
}

async function loadTabs() {
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/83038061-d1d3-431b-abcf-197c7d6bb243',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'sidepanel.js:loadTabs:entry',message:'loadTabs called',data:{},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
  // #endregion
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
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/83038061-d1d3-431b-abcf-197c7d6bb243',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'sidepanel.js:loadTabs:catch',message:'loadTabs threw',data:{errMsg:String(err&&err.message)},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
    // #endregion
    console.error('Failed to load tabs:', err);
    tabs = [];
  }
  if (tabs.length === 0) {
    tabs = [{ id: generateId(), content: '', title: '' }];
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
  tabsContainer.textContent = '';  tabs.forEach((tab) => {
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
      if (tab.content.trim() && !closeBtn.classList.contains('confirming')) {
        closeBtn.classList.add('confirming');
        closeBtn.textContent = '✓';
        setTimeout(() => {
          closeBtn.classList.remove('confirming');
          closeBtn.textContent = '×';
        }, 2000);
      } else {
        deleteTab(tab.id);
      }
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
}

function startEditTabTitle(tab, labelEl) {
  if (editingTabId) return;
  editingTabId = tab.id;

  const input = document.createElement('input');
  input.className = 'tab-title-input';
  input.type = 'text';
  input.value = tab.title || getTabLabel(tab);
  input.setAttribute('data-id', tab.id);

  labelEl.replaceWith(input);
  input.focus();
  input.select();

  function finishEdit() {
    if (!editingTabId) return;
    const t = tabs.find((x) => x.id === tab.id);
    if (t) t.title = input.value.trim();
    editingTabId = null;
    saveTabs();
    renderTabs();
  }

  input.addEventListener('blur', finishEdit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = tab.title || getTabLabel(tab); input.blur(); }
  });
}

// ─── Tab operations ─────────────────────────────────────────

function switchTab(id) {
  flushActiveTab();

  activeTabId = id;
  const tab = tabs.find((t) => t.id === id);

  if (tab) {
    setEditorTextHighlighted(tab.content);
    editorContainer.classList.remove('hidden');
    emptyState.classList.add('hidden');
  }

  renderTabs();
  saveTabs();
  updateLineNumbers();
  const result = validateJson();
  formatBtn.disabled = !result.valid;
  updateCollapseExpandButtons();
}

async function addTab(initialContent = '') {
  if (tabs.length >= MAX_TABS) return;

  flushActiveTab();

  const newTab = { id: generateId(), content: initialContent || '', title: '' };
  tabs.push(newTab);
  activeTabId = newTab.id;

  setEditorTextHighlighted(newTab.content);
  editorContainer.classList.remove('hidden');
  emptyState.classList.add('hidden');

  renderTabs();
  await saveTabs();
  updateLineNumbers();
  const result = validateJson();
  formatBtn.disabled = !result.valid;
  updateCollapseExpandButtons();
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
    const res = validateJson();
    formatBtn.disabled = !res.valid;
    updateCollapseExpandButtons();

    if (tabs.length === 1 && !newTab?.content?.trim()) {
      editorContainer.classList.add('hidden');
      emptyState.classList.remove('hidden');
    }
  }

  renderTabs();
  await saveTabs();
}

async function duplicateTab(id) {
  if (tabs.length >= MAX_TABS) return;
  flushActiveTab();
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
  const result = validateJson();
  formatBtn.disabled = !result.valid;
  updateCollapseExpandButtons();
  updateStatusBar();
}

// ─── Line numbers ───────────────────────────────────────────

function updateLineNumbers() {
  const text = getEditorText();
  const lines = text.split('\n');
  const count = Math.max(1, lines.length);
  const maxWidth = count.toString().length;
  const hidden = getFoldedHiddenLineSet();
  lineNumbers.textContent = Array.from({ length: count }, (_, i) =>
    hidden.has(i) ? ' '.repeat(maxWidth) : (i + 1).toString().padStart(maxWidth, ' ')
  ).join('\n');
  updateFoldGutter();
  updateFoldOverlay();
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
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

function validateJson() {
  const text = getEditorText().trim();
  if (!text) {
    validationEl.textContent = '';
    validationEl.className = 'validation';
    validationEl.removeAttribute('title');
    return { valid: false };
  }
  try {
    JSON.parse(text);
    validationEl.textContent = 'Valid JSON';
    validationEl.className = 'validation valid';
    validationEl.removeAttribute('title');
    return { valid: true };
  } catch (err) {
    let msg = err.message || 'Invalid JSON';
    const trimmed = text.replace(/\s+/g, ' ').trim();
    if (/after JSON at position \d+/i.test(msg) && /\}\s*,?\s*\{/.test(trimmed)) {
      msg = 'Multiple values at top level. Use one object or wrap in an array: [ {...}, {...} ]';
    }
    validationEl.textContent = 'Invalid JSON';
    validationEl.className = 'validation invalid';
    validationEl.title = msg;
    return { valid: false };
  }
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
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/83038061-d1d3-431b-abcf-197c7d6bb243',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'sidepanel.js:onEditorInput',message:'editor input fired',data:{},timestamp:Date.now(),hypothesisId:'H4'})}).catch(()=>{});
  // #endregion
  const text = getEditorText();
  updatePlaceholder(text);
  updateLineNumbers();
  updateStatusBar();
  const result = validateJson();
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
}

// ─── Key handlers for contenteditable ───────────────────────

/**
 * Insert text at the current cursor position using direct text manipulation.
 * Avoids execCommand which splits <code> elements and creates ghost nodes.
 */
function insertAtCursor(chars) {
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
  const result = validateJson();
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
  if (e.key === 'Enter') {
    e.preventDefault();
    insertAtCursor('\n');
  }

  if (e.key === 'Tab') {
    e.preventDefault();
    insertAtCursor('  ');
  }
}

// ─── Paste handler (strip HTML, insert plain text) ──────────

function onEditorPaste(e) {
  e.preventDefault();
  const pastedText = e.clipboardData?.getData('text/plain') || '';
  if (!pastedText) return;

  const currentText = getEditorText();
  let offset = getCaretCharOffset(editorCode);
  if (offset < 0) offset = currentText.length;
  const newText = currentText.slice(0, offset) + pastedText + currentText.slice(offset);

  clearTimeout(highlightTimer);
  clearTimeout(debounceTimer);
  highlightTimer = null;

  setEditorTextHighlighted(newText);
  updateLineNumbers();
  const result = validateJson();
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
  }
}

function clearContent() {
  setEditorTextPlain('');
  updateLineNumbers();
  updateStatusBar();
  validateJson();
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

function formatContent() {
  const text = getEditorText().trim();
  if (!text) return;
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
  validateJson();
  editor.focus();
}

/** Enable/disable Collapse and Expand based on whether JSON is visible (editor open and non-empty). */
function updateCollapseExpandButtons() {
  const visible = !editorContainer.classList.contains('hidden');
  const hasContent = (getEditorText() || '').trim().length > 0;
  const enabled = visible && hasContent;
  if (collapseBtn) collapseBtn.disabled = !enabled;
  if (expandBtn) expandBtn.disabled = !enabled;
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

/**
 * View rows when collapsed (VS Code style): only visible lines, no separate fold row.
 * Each item is { type: 'line', lineIndex, content, foldedBlock }.
 * foldedBlock is set on the opening line of a folded block (value = endLine) so we append " ...".
 */
function getViewLines(fullText) {
  const lines = fullText.split('\n');
  if (lines.length === 0) return [];
  const ranges = computeFoldRanges(fullText);
  const viewLines = [];
  for (let i = 0; i < lines.length; i++) {
    const folded = ranges.find((r) => foldedLines.has(r.startLine) && r.startLine <= i && r.endLine >= i);
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
  const ranges = computeFoldRanges(full);
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
        icon.textContent = '▶';
        icon.setAttribute('aria-label', 'Expand');
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

  if (foldedLines.size > 0) {
    const viewLines = getViewLines(full);
    const maxWidth = Math.max(...viewLines.map((v) => (v.lineIndex + 1).toString().length), 1);
    lineNumbers.textContent = viewLines
      .map((v) => (v.lineIndex + 1).toString().padStart(maxWidth, ' '))
      .join('\n');
  } else {
    const maxWidth = count.toString().length;
    lineNumbers.textContent = Array.from({ length: count }, (_, i) => (i + 1).toString().padStart(maxWidth, ' ')).join('\n');
  }
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
        const res = validateJson();
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
  // If paste is inside the editor, the editor's own paste handler deals with it
  if (editor.contains(e.target)) return;

  if (contentArea.contains(e.target)) {
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
          const res = validateJson();
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
}

// ─── Init ───────────────────────────────────────────────────

async function init() {
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/83038061-d1d3-431b-abcf-197c7d6bb243',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'sidepanel.js:init:entry',message:'init started',data:{chromeExists:typeof chrome!=='undefined',storageExists:typeof chrome!=='undefined'&&!!chrome.storage},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
  // #endregion
  await loadTabs();

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
  updateLineNumbers();
  updateStatusBar();
  const result = validateJson();
  formatBtn.disabled = !result.valid;
  updateCollapseExpandButtons();

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.shiftKey && e.key === 'F') { e.preventDefault(); formatContent(); }
      if (e.shiftKey && e.key === 'X') { e.preventDefault(); clearContent(); }
      if (e.shiftKey && e.key === 'C') { e.preventDefault(); copyContent(); }
    }
  });

  // Editor events
  editor.addEventListener('input', onEditorInput);
  editor.addEventListener('keydown', onEditorKeydown);
  editor.addEventListener('paste', onEditorPaste);
  editor.addEventListener('scroll', syncScroll);

  editor.addEventListener('focus', () => {
    const sel = window.getSelection();
    if (!sel.rangeCount || !editorCode.contains(sel.getRangeAt(0).startContainer)) {
      const range = document.createRange();
      range.selectNodeContents(editorCode);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  });

  // Button events
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/83038061-d1d3-431b-abcf-197c7d6bb243',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'sidepanel.js:init:buttonListeners',message:'attaching button listeners',data:{},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
  // #endregion
  addTabBtn.addEventListener('click', () => addTab());
  copyBtn.addEventListener('click', copyContent);
  formatBtn.addEventListener('click', formatContent);
  clearBtn.addEventListener('click', clearContent);
  collapseBtn.addEventListener('click', collapseAll);
  expandBtn.addEventListener('click', expandAll);
  duplicateBtn.addEventListener('click', () => duplicateTab(activeTabId));
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
}

init();
