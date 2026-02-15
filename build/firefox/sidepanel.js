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
const HIGHLIGHT_DEBOUNCE_MS = 800;

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
const emptyState = document.getElementById('emptyState');
const editorContainer = document.getElementById('editorContainer');

// State
let tabs = [];
let activeTabId = null;
let debounceTimer = null;
let highlightTimer = null;
let editingTabId = null;

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
 * Get the plain text from the contenteditable editor.
 * Uses innerText which preserves newlines from <br> and block elements.
 */
function getEditorText() {
  // innerText respects visual line breaks
  return editor.innerText || '';
}

/**
 * Set editor content as plain text (no highlighting).
 */
function setEditorTextPlain(text) {
  editorCode.textContent = text;
  updatePlaceholder(text);
}

/**
 * Set editor content with Prism syntax highlighting.
 * Use when cursor position doesn't matter (load, switch, format, clear).
 */
function setEditorTextHighlighted(text) {
  if (text.trim()) {
    try {
      editorCode.innerHTML = Prism.highlight(text, Prism.languages.json, 'json');
    } catch {
      editorCode.textContent = text;
    }
  } else {
    editorCode.textContent = text;
  }
  updatePlaceholder(text);
}

/**
 * Re-apply Prism highlighting while preserving cursor position.
 * Called on debounce during typing.
 */
function reHighlight() {
  const text = getEditorText();
  if (!text.trim()) return;

  // Save cursor offset
  const offset = getCaretCharOffset(editorCode);

  try {
    editorCode.innerHTML = Prism.highlight(text, Prism.languages.json, 'json');
  } catch {
    editorCode.textContent = text;
  }

  // Restore cursor
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
  try {
    await chrome.storage.local.set({ tabs });
  } catch (err) {
    console.error('Failed to save tabs:', err);
  }
}

async function loadTabs() {
  try {
    const result = await chrome.storage.local.get('tabs');
    tabs = (result.tabs || [])
      .filter((t) => t && typeof t.id === 'string')
      .map((t) => ({
        id: t.id,
        content: typeof t.content === 'string' ? t.content : '',
        title: typeof t.title === 'string' ? t.title : ''
      }));
  } catch (err) {
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
  tabsContainer.innerHTML = '';  tabs.forEach((tab) => {
    const tabEl = document.createElement('div');
    const isActive = tab.id === activeTabId;
    tabEl.className = 'tab' + (isActive ? ' active' : '');
    tabEl.setAttribute('role', 'tab');
    tabEl.setAttribute('aria-selected', isActive ? 'true' : 'false');
    tabEl.setAttribute('data-id', tab.id);

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

    if (tabs.length === 1 && !newTab?.content?.trim()) {
      editorContainer.classList.add('hidden');
      emptyState.classList.remove('hidden');
    }
  }

  renderTabs();
  await saveTabs();
}

// ─── Line numbers ───────────────────────────────────────────

function updateLineNumbers() {
  const text = getEditorText();
  const lines = text.split('\n');
  const count = Math.max(1, lines.length);
  lineNumbers.innerHTML = Array.from({ length: count }, (_, i) => i + 1).join('\n');
}

// ─── Validation ─────────────────────────────────────────────

function validateJson() {
  const text = getEditorText().trim();
  if (!text) {
    validationEl.textContent = '';
    validationEl.className = 'validation';
    return { valid: false };
  }
  try {
    JSON.parse(text);
    validationEl.textContent = '✅ Valid JSON';
    validationEl.className = 'validation valid';
    return { valid: true };
  } catch {
    validationEl.textContent = '❌ Not valid JSON';
    validationEl.className = 'validation invalid';
    return { valid: false };
  }
}

// ─── Scroll sync ────────────────────────────────────────────

function syncScroll() {
  lineNumbers.scrollTop = editor.scrollTop;
}

// ─── Editor input handling ──────────────────────────────────

function onEditorInput() {
  const text = getEditorText();
  updatePlaceholder(text);
  updateLineNumbers();
  const result = validateJson();
  formatBtn.disabled = !result.valid;

  // Debounced re-highlight (doesn't run on every keystroke)
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

function onEditorKeydown(e) {
  // Enter: insert \n (prevent browser from inserting <br> or <div>)
  if (e.key === 'Enter') {
    e.preventDefault();
    document.execCommand('insertText', false, '\n');
  }

  // Tab: insert 2 spaces
  if (e.key === 'Tab') {
    e.preventDefault();
    document.execCommand('insertText', false, '  ');
  }
}

// ─── Paste handler (strip HTML, insert plain text) ──────────

function onEditorPaste(e) {
  e.preventDefault();
  const text = e.clipboardData?.getData('text/plain') || '';
  document.execCommand('insertText', false, text);
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
  validateJson();
  formatBtn.disabled = true;
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
  editor.focus();
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
        const res = validateJson();
        formatBtn.disabled = !res.valid;
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
          const res = validateJson();
          formatBtn.disabled = !res.valid;
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
  await loadTabs();

  if (tabs.length > 0) {
    activeTabId = tabs[0].id;
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
  const result = validateJson();
  formatBtn.disabled = !result.valid;

  // Editor events
  editor.addEventListener('input', onEditorInput);
  editor.addEventListener('keydown', onEditorKeydown);
  editor.addEventListener('paste', onEditorPaste);
  editor.addEventListener('scroll', syncScroll);

  // Button events
  addTabBtn.addEventListener('click', () => addTab());
  copyBtn.addEventListener('click', copyContent);
  formatBtn.addEventListener('click', formatContent);
  clearBtn.addEventListener('click', clearContent);

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
