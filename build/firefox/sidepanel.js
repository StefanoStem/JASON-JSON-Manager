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
const downloadBtn = document.getElementById('downloadBtn');
const statusBar = document.getElementById('statusBar');
const editorPanel = document.getElementById('editorPanel');
const foldGutter = document.getElementById('foldGutter');
const foldOverlay = document.getElementById('foldOverlay');
const emptyState = document.getElementById('emptyState');
const editorContainer = document.getElementById('editorContainer');
const themeToggle = document.getElementById('themeToggle');

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
  ignoreInputUntil = Date.now() + 80;
  _cachedFoldText = null;
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
  element.innerHTML = html;
}

function setEditorTextHighlighted(text, clearFolds = true) {
  // #region agent log
  if (text && text.length <= 3) {
    fetch('http://127.0.0.1:7244/ingest/83038061-d1d3-431b-abcf-197c7d6bb243',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9bf3b1'},body:JSON.stringify({sessionId:'9bf3b1',location:'sidepanel.js:setEditorTextHighlighted',message:'setEditorTextHighlighted short',data:{text:JSON.stringify(text),trimmed:!!text.trim()},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
  }
  // #endregion
  ignoreInputUntil = Date.now() + 80;
  _cachedFoldText = null;
  if (clearFolds) foldedLines.clear();
  if (text.trim()) {
    try {
      if (text.length <= 3) {
        editorCode.textContent = text;
      } else {
        safeSetHTML(editorCode, Prism.highlight(text, Prism.languages.json, 'json'));
      }
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
  // #region agent log
  if (text && text.trim() && text.length <= 3) {
    const html = Prism.highlight(text, Prism.languages.json, 'json');
    fetch('http://127.0.0.1:7244/ingest/83038061-d1d3-431b-abcf-197c7d6bb243',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9bf3b1'},body:JSON.stringify({sessionId:'9bf3b1',location:'sidepanel.js:reHighlight',message:'reHighlight short content',data:{text:JSON.stringify(text),htmlLen:html?.length,startsWithBrace:text.trimStart().startsWith('{')},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
  }
  // #endregion
  if (!text.trim()) return;

  const offset = getCaretCharOffset(editorCode);

  try {
    if (text.length <= 3) {
      editorCode.textContent = text;
    } else {
      safeSetHTML(editorCode, Prism.highlight(text, Prism.languages.json, 'json'));
    }
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
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

function updatePlaceholder(text) {
  // #region agent log
  if (text && text.trim() && text.length <= 3) {
    fetch('http://127.0.0.1:7244/ingest/83038061-d1d3-431b-abcf-197c7d6bb243',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9bf3b1'},body:JSON.stringify({sessionId:'9bf3b1',location:'sidepanel.js:updatePlaceholder',message:'updatePlaceholder short content',data:{text:JSON.stringify(text),willHide:!!(text&&text.trim())},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
  }
  // #endregion
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
  const res = validateJson();
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
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/83038061-d1d3-431b-abcf-197c7d6bb243',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9bf3b1'},body:JSON.stringify({sessionId:'9bf3b1',location:'sidepanel.js:performRedo',message:'performRedo called',data:{redoStackLen:redoStack.length,bailed:redoStack.length===0},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
  // #endregion
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
    validationEl.textContent = '⚠️ Could not save to storage. Changes may not persist.';
    validationEl.className = 'validation warning';
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
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/83038061-d1d3-431b-abcf-197c7d6bb243',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9bf3b1'},body:JSON.stringify({sessionId:'9bf3b1',location:'sidepanel.js:loadTabs',message:'loadTabs done',data:{tabsCount:tabs.length,firstTabContentLen:(tabs[0]?.content||'').length},timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
  // #endregion
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
  undoStack.length = 0;
  redoStack.length = 0;

  activeTabId = id;
  const tab = tabs.find((t) => t.id === id);

  if (tab) {
    setEditorTextHighlighted(tab.content);
    if (foldedLines.size === 0) editor.contentEditable = 'true';
    editorContainer.classList.remove('hidden');
    emptyState.classList.add('hidden');
  }

  renderTabs();
  saveTabs();
  updateLineNumbers();
  const result = validateJson();
  formatBtn.disabled = !result.valid;
  updateMinifyButton();
  updateCollapseExpandButtons();
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

    // Always show editor when we have at least one tab (never show empty state)
    editorContainer.classList.remove('hidden');
    emptyState.classList.add('hidden');
  }

  renderTabs();
  await saveTabs();
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
  const result = validateJson();
  formatBtn.disabled = !result.valid;
  updateCollapseExpandButtons();
  updateStatusBar();
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
    validateJson();
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
    return;
  }
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
  // #region agent log
  if ((e.key === 'z' || e.key === 'y') && e.ctrlKey) {
    fetch('http://127.0.0.1:7244/ingest/83038061-d1d3-431b-abcf-197c7d6bb243',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9bf3b1'},body:JSON.stringify({sessionId:'9bf3b1',location:'sidepanel.js:onEditorKeydown',message:'Ctrl+Z/Y keydown',data:{key:e.key,shift:e.shiftKey,redoStackLen:redoStack.length,undoStackLen:undoStack.length,editorFocused:document.activeElement===editor},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
  }
  // #endregion
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
  validateJson();
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
  validateJson();
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

// ─── Init ───────────────────────────────────────────────────

async function init() {
  const theme = await loadTheme();
  applyTheme(theme);

  await loadTabs();

  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
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
  updateLineNumbers();
  updateStatusBar();
  const result = validateJson();
  formatBtn.disabled = !result.valid;
  updateCollapseExpandButtons();

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        if (editor.contains(document.activeElement)) {
          e.preventDefault();
          performRedo();
        }
      }
      if (e.shiftKey && e.key === 'F') { e.preventDefault(); formatContent(); }
      if (e.shiftKey && e.key === 'M') { e.preventDefault(); minifyContent(); }
      if (e.shiftKey && e.key === 'X') { e.preventDefault(); clearContent(); }
      if (e.shiftKey && e.key === 'C') { e.preventDefault(); copyContent(); }
    }
  });

  // beforeinput: push current state to undo before typing (enables Ctrl+Z)
  editor.addEventListener('beforeinput', (e) => {
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
  addTabBtn.addEventListener('click', () => addTab());
  copyBtn.addEventListener('click', copyContent);
  formatBtn.addEventListener('click', formatContent);
  clearBtn.addEventListener('click', clearContent);
  minifyBtn.addEventListener('click', minifyContent);
  duplicateBtn.addEventListener('click', () => duplicateTab(activeTabId));
  downloadBtn.addEventListener('click', downloadContent);
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
    flushActiveTab();
    if (hasStorage()) {
      try {
        chrome.storage.local.set({ tabs, [LAST_ACTIVE_TAB_KEY]: activeTabId });
      } catch (_) {}
      chrome.runtime.sendMessage({ type: 'saveTabs', tabs, lastActiveTabId: activeTabId }).catch(() => {});
    }
  }
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'hidden') {
      saveBeforeClose();
    } else if (document.visibilityState === 'visible' && hasStorage()) {
      // Reload from storage when panel becomes visible (helps Firefox when sidebar is reopened)
      const result = await chrome.storage.local.get(['tabs', LAST_ACTIVE_TAB_KEY]);
      if (result.tabs && result.tabs.length > 0) {
        tabs = result.tabs
          .filter((t) => t && typeof t.id === 'string')
          .map((t) => ({
            id: t.id,
            content: typeof t.content === 'string' ? t.content : '',
            title: typeof t.title === 'string' ? t.title : ''
          }));
        activeTabId = result[LAST_ACTIVE_TAB_KEY] || tabs[0]?.id;
        const activeTab = tabs.find((t) => t.id === activeTabId);
        setEditorTextHighlighted(activeTab?.content || '');
        renderTabs();
        updateLineNumbers();
        updateStatusBar();
        validateJson();
        formatBtn.disabled = !validateJson().valid;
        updateCollapseExpandButtons();
      }
    }
  });
  window.addEventListener('pagehide', saveBeforeClose);
}

init();
