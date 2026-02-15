/**
 * JASON - JSON Snippet Manager
 * Side panel Chrome extension for managing multiple JSON text snippets
 */

const MAX_TABS = 20;
const TAB_PREVIEW_LENGTH = 20;
const DEBOUNCE_MS = 500;

// DOM elements
const tabsContainer = document.getElementById('tabs');
const addTabBtn = document.getElementById('addTab');
const contentArea = document.getElementById('contentArea');
const editor = document.getElementById('editor');
const lineNumbers = document.getElementById('lineNumbers');
const editorHighlight = document.getElementById('editorHighlight');
const editorCode = document.getElementById('editorCode');
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

// Generate unique ID
function generateId() {
  return 'tab_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
}

// Get display label for tab: title if set, else preview of content
function getTabLabel(tab) {
  if (tab.title && tab.title.trim()) return tab.title.trim();
  const text = (tab.content || '').trim();
  if (!text) return '(empty)';
  const preview = text.slice(0, TAB_PREVIEW_LENGTH);
  return preview + (text.length > TAB_PREVIEW_LENGTH ? '…' : '');
}

// Save tabs to chrome.storage.local
async function saveTabs() {
  await chrome.storage.local.set({ tabs });
}

// Load tabs from chrome.storage.local
async function loadTabs() {
  const result = await chrome.storage.local.get('tabs');
  tabs = (result.tabs || []).map((t) => ({
    id: t.id,
    content: t.content || '',
    title: t.title || ''
  }));
  
  if (tabs.length === 0) {
    tabs = [{ id: generateId(), content: '', title: '' }];
    await saveTabs();
  }
}

// Render tab buttons
let editingTabId = null;

function renderTabs() {
  tabsContainer.innerHTML = '';
  
  tabs.forEach((tab) => {
    const tabEl = document.createElement('div');
    tabEl.className = 'tab' + (tab.id === activeTabId ? ' active' : '');
    tabEl.setAttribute('role', 'tab');
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
    
    // Click tab to switch; click label to edit (only when tab is already active)
    tabEl.addEventListener('click', (e) => {
      if (e.target === closeBtn) return;
      switchTab(tab.id);
    });
    
    labelEl.addEventListener('click', (e) => {
      // Only allow edit when this tab is already selected
      if (tab.id !== activeTabId) return;
      e.stopPropagation(); // Prevent switchTab from re-rendering before we can edit
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
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    }
    if (e.key === 'Escape') {
      input.value = tab.title || getTabLabel(tab);
      input.blur();
    }
  });
}

// Switch to a tab
function switchTab(id) {
  // Save current content before switching
  if (activeTabId) {
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (activeTab) {
      activeTab.content = editor.value;
    }
  }
  
  activeTabId = id;
  const tab = tabs.find((t) => t.id === id);
  
  if (tab) {
    editor.value = tab.content;
    editorContainer.classList.remove('hidden');
    emptyState.classList.add('hidden');
  }
  
  renderTabs();
  saveTabs();
  updateHighlight();
  const result = validateJson();
  formatBtn.disabled = !result.valid;
}

// Add new tab (optionally with content)
async function addTab(initialContent = '') {
  if (tabs.length >= MAX_TABS) return;
  
  const newTab = { id: generateId(), content: initialContent || '', title: '' };
  tabs.push(newTab);
  activeTabId = newTab.id;
  
  editor.value = newTab.content;
  editorContainer.classList.remove('hidden');
  emptyState.classList.add('hidden');
  
  renderTabs();
  await saveTabs();
  updateHighlight();
  const result = validateJson();
  formatBtn.disabled = !result.valid;
  editor.focus();
}

// Delete tab
async function deleteTab(id) {
  const index = tabs.findIndex((t) => t.id === id);
  if (index === -1) return;
  
  tabs.splice(index, 1);
  
  if (tabs.length === 0) {
    tabs = [{ id: generateId(), content: '', title: '' }];
    await saveTabs();
  }
  
  if (activeTabId === id) {
    const newActiveIndex = Math.min(index, tabs.length - 1);
    activeTabId = tabs[newActiveIndex].id;
    const newTab = tabs.find((t) => t.id === activeTabId);
    editor.value = newTab ? newTab.content : '';
    updateHighlight();
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

// Update line numbers
function updateLineNumbers() {
  const lines = editor.value.split('\n');
  const count = Math.max(1, lines.length);
  lineNumbers.innerHTML = Array.from({ length: count }, (_, i) => i + 1).join('\n');
}

// Update Prism syntax highlighting
function updateHighlight() {
  const text = editor.value;
  updateLineNumbers();
  if (text.trim() === '') {
    editorCode.textContent = '';
  } else {
    try {
      editorCode.innerHTML = Prism.highlight(text, Prism.languages.json, 'json');
    } catch {
      editorCode.textContent = text;
    }
  }
}

// Validate JSON and update indicator
function validateJson() {
  const text = editor.value.trim();
  if (!text) {
    validationEl.textContent = '';
    validationEl.className = 'validation';
    return { valid: false }; // Disable format when empty
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

// Sync scroll between textarea, highlight, and line numbers
function syncScroll() {
  editorHighlight.scrollTop = editor.scrollTop;
  editorHighlight.scrollLeft = editor.scrollLeft;
  lineNumbers.scrollTop = editor.scrollTop;
}

// Debounced save, highlight, and validation on editor input
function onEditorInput() {
  updateHighlight();
  const result = validateJson();
  formatBtn.disabled = !result.valid;
  syncScroll();

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    if (activeTabId) {
      const tab = tabs.find((t) => t.id === activeTabId);
      if (tab) {
        tab.content = editor.value;
        saveTabs();
        renderTabs();
      }
    }
  }, DEBOUNCE_MS);
}

// Copy content to clipboard
async function copyContent() {
  try {
    await navigator.clipboard.writeText(editor.value);
    const originalText = copyBtn.textContent;
    copyBtn.textContent = 'Copied!';
    setTimeout(() => {
      copyBtn.textContent = originalText;
    }, 1500);
  } catch (err) {
    console.error('Copy failed:', err);
  }
}

// Clear editor
function clearContent() {
  editor.value = '';
  updateHighlight();
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

// Format JSON
function formatContent() {
  const text = editor.value.trim();
  if (!text) return;
  try {
    const parsed = JSON.parse(text);
    editor.value = JSON.stringify(parsed, null, 2);
    updateHighlight();
  } catch {
    return; // Format button is disabled when invalid
  }
  if (activeTabId) {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (tab) {
      tab.content = editor.value;
      saveTabs();
      renderTabs();
    }
  }
  editor.focus();
}

// Setup drop zone - drop adds text to current tab (or creates one if none)
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
        const newContent = editor.value + (editor.value ? '\n' : '') + text;
        editor.value = newContent;
        tab.content = newContent;
        editorContainer.classList.remove('hidden');
        emptyState.classList.add('hidden');
        updateHighlight();
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

// Handle paste - add to current tab when pasting in content area (not in editor/buttons)
function onPaste(e) {
  if (editorContainer.contains(e.target)) return;

  if (contentArea.contains(e.target)) {
    const text = e.clipboardData?.getData('text/plain');
    if (text) {
      e.preventDefault();
      if (activeTabId) {
        const tab = tabs.find((t) => t.id === activeTabId);
        if (tab) {
          const newContent = editor.value + (editor.value ? '\n' : '') + text;
          editor.value = newContent;
          tab.content = newContent;
          editorContainer.classList.remove('hidden');
          emptyState.classList.add('hidden');
          updateHighlight();
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

// Initialize
async function init() {
  await loadTabs();
  
  if (tabs.length > 0) {
    activeTabId = tabs[0].id;
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (activeTab && activeTab.content.trim()) {
      editor.value = activeTab.content;
      editorContainer.classList.remove('hidden');
      emptyState.classList.add('hidden');
    } else {
      editor.value = activeTab?.content || '';
      editorContainer.classList.remove('hidden');
      emptyState.classList.add('hidden');
    }
  } else {
    emptyState.classList.remove('hidden');
    editorContainer.classList.add('hidden');
  }
  
  renderTabs();
  
  updateHighlight();
  const result = validateJson();
  formatBtn.disabled = !result.valid;
  
  addTabBtn.addEventListener('click', () => addTab());
  editor.addEventListener('input', onEditorInput);
  editor.addEventListener('scroll', syncScroll);
  copyBtn.addEventListener('click', copyContent);
  formatBtn.addEventListener('click', formatContent);
  clearBtn.addEventListener('click', clearContent);

  document.addEventListener('paste', onPaste);
  setupDropZone(contentArea);

  // Focus content area when clicking empty/drop zone (so paste works)
  contentArea.addEventListener('click', (e) => {
    if (!editorContainer.contains(e.target)) {
      contentArea.focus();
    }
  });
}

init();
