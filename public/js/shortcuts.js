/**
 * shortcuts.js - Keyboard Shortcuts for Admin Interface
 *
 * WHY THIS EXISTS:
 * ================
 * Power users expect keyboard shortcuts for common actions.
 * This module provides:
 * - Global navigation shortcuts (g h, g c, etc.)
 * - Context-aware shortcuts (n for new in lists, ctrl+s for save in forms)
 * - Help modal showing all available shortcuts
 * - Cross-platform support (cmd on Mac, ctrl elsewhere)
 *
 * NO DEPENDENCIES - vanilla JavaScript only.
 */

(function(window) {
  'use strict';

  // Detect platform
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const modKey = isMac ? 'cmd' : 'ctrl';

  // State
  let shortcuts = {};
  let context = 'global';
  let pendingKeys = '';
  let pendingTimeout = null;
  let enabled = true;
  let helpModal = null;

  // Shortcut definitions
  const definitions = {
    global: [
      { keys: '?', action: 'showHelp', description: 'Show keyboard shortcuts' },
      { keys: 'g h', action: 'goto:/admin', description: 'Go to dashboard' },
      { keys: 'g c', action: 'goto:/admin/content', description: 'Go to content' },
      { keys: 'g b', action: 'goto:/admin/blueprints', description: 'Go to blueprints' },
      { keys: 'g u', action: 'goto:/admin/users', description: 'Go to users' },
      { keys: 'g m', action: 'goto:/admin/media', description: 'Go to media' },
      { keys: 'g p', action: 'goto:/admin/plugins', description: 'Go to plugins' },
      { keys: 'g a', action: 'goto:/admin/analytics', description: 'Go to analytics' },
      { keys: 'g s', action: 'goto:/admin/search', description: 'Go to search' },
      { keys: '/', action: 'focusSearch', description: 'Focus search' },
      { keys: 'esc', action: 'closeModal', description: 'Close modal / cancel' }
    ],
    'content-list': [
      { keys: 'n', action: 'newContent', description: 'New content' },
      { keys: 'j', action: 'selectNext', description: 'Select next item' },
      { keys: 'k', action: 'selectPrev', description: 'Select previous item' },
      { keys: 'enter', action: 'editSelected', description: 'Edit selected' },
      { keys: 'd', action: 'deleteSelected', description: 'Delete selected' },
      { keys: 'p', action: 'publishSelected', description: 'Publish selected' },
      { keys: 'r', action: 'refresh', description: 'Refresh list' }
    ],
    'content-edit': [
      { keys: `${modKey}+s`, action: 'save', description: 'Save' },
      { keys: `${modKey}+shift+s`, action: 'saveAndContinue', description: 'Save and continue' },
      { keys: `${modKey}+p`, action: 'publish', description: 'Publish' },
      { keys: `${modKey}+d`, action: 'saveDraft', description: 'Save as draft' },
      { keys: `${modKey}+shift+p`, action: 'preview', description: 'Preview' },
      { keys: 'esc', action: 'cancel', description: 'Cancel / go back' }
    ],
    'blueprints': [
      { keys: 'n', action: 'newBlueprint', description: 'New blueprint' },
      { keys: 'j', action: 'selectNext', description: 'Select next' },
      { keys: 'k', action: 'selectPrev', description: 'Select previous' },
      { keys: 'enter', action: 'editSelected', description: 'Edit selected' }
    ]
  };

  // Currently selected row index
  let selectedIndex = -1;

  /**
   * Initialize shortcuts
   */
  function init(options = {}) {
    context = options.context || 'global';
    enabled = options.enabled !== false;

    // Build shortcuts map
    buildShortcuts();

    // Attach event listeners
    document.addEventListener('keydown', handleKeydown);

    // Create help modal
    createHelpModal();

    console.log('[shortcuts] Initialized (context: ' + context + ')');
  }

  /**
   * Build shortcuts map from definitions
   */
  function buildShortcuts() {
    shortcuts = {};

    // Add global shortcuts
    for (const def of definitions.global) {
      shortcuts[def.keys] = def;
    }

    // Add context-specific shortcuts
    if (definitions[context]) {
      for (const def of definitions[context]) {
        shortcuts[def.keys] = def;
      }
    }
  }

  /**
   * Handle keydown events
   */
  function handleKeydown(e) {
    if (!enabled) return;

    // Skip if in input/textarea (unless modifier key)
    const target = e.target;
    const isInput = target.tagName === 'INPUT' ||
                    target.tagName === 'TEXTAREA' ||
                    target.isContentEditable;

    // Allow certain shortcuts in inputs
    const hasModifier = e.ctrlKey || e.metaKey;
    if (isInput && !hasModifier && e.key !== 'Escape') {
      return;
    }

    // Build key string
    const key = buildKeyString(e);
    if (!key) return;

    // Handle multi-key sequences (g h, g c, etc.)
    if (pendingKeys) {
      clearTimeout(pendingTimeout);
      const fullKey = pendingKeys + ' ' + key;
      pendingKeys = '';

      if (shortcuts[fullKey]) {
        e.preventDefault();
        executeAction(shortcuts[fullKey].action);
        return;
      }
    }

    // Check for single key shortcut
    if (shortcuts[key]) {
      e.preventDefault();
      executeAction(shortcuts[key].action);
      return;
    }

    // Check if this could be start of multi-key sequence
    const possibleSequence = Object.keys(shortcuts).some(k => k.startsWith(key + ' '));
    if (possibleSequence) {
      e.preventDefault();
      pendingKeys = key;
      pendingTimeout = setTimeout(() => {
        pendingKeys = '';
      }, 1000);
    }
  }

  /**
   * Build key string from event
   */
  function buildKeyString(e) {
    const parts = [];

    if (e.ctrlKey && !isMac) parts.push('ctrl');
    if (e.metaKey && isMac) parts.push('cmd');
    if (e.altKey) parts.push('alt');
    if (e.shiftKey) parts.push('shift');

    let key = e.key.toLowerCase();

    // Normalize special keys
    if (key === 'escape') key = 'esc';
    if (key === ' ') key = 'space';

    // Skip if only modifier
    if (['control', 'meta', 'alt', 'shift'].includes(key)) {
      return '';
    }

    if (parts.length > 0) {
      parts.push(key);
      return parts.join('+');
    }

    return key;
  }

  /**
   * Execute shortcut action
   */
  function executeAction(action) {
    // Navigation
    if (action.startsWith('goto:')) {
      const url = action.substring(5);
      window.location.href = url;
      return;
    }

    // Built-in actions
    switch (action) {
      case 'showHelp':
        showHelp();
        break;
      case 'closeModal':
        closeModal();
        break;
      case 'focusSearch':
        focusSearch();
        break;
      case 'newContent':
        newContent();
        break;
      case 'newBlueprint':
        newBlueprint();
        break;
      case 'selectNext':
        selectRow(1);
        break;
      case 'selectPrev':
        selectRow(-1);
        break;
      case 'editSelected':
        editSelected();
        break;
      case 'deleteSelected':
        deleteSelected();
        break;
      case 'publishSelected':
        publishSelected();
        break;
      case 'refresh':
        window.location.reload();
        break;
      case 'save':
        submitForm();
        break;
      case 'saveAndContinue':
        submitForm(true);
        break;
      case 'publish':
        publishContent();
        break;
      case 'saveDraft':
        saveDraft();
        break;
      case 'preview':
        previewContent();
        break;
      case 'cancel':
        goBack();
        break;
    }
  }

  /**
   * Show help modal
   */
  function showHelp() {
    if (helpModal) {
      helpModal.style.display = 'flex';
    }
  }

  /**
   * Close any open modal
   */
  function closeModal() {
    if (helpModal && helpModal.style.display !== 'none') {
      helpModal.style.display = 'none';
      return;
    }
    // Check for other modals
    const modal = document.querySelector('.modal.open, .modal[style*="display: block"]');
    if (modal) {
      modal.style.display = 'none';
    }
  }

  /**
   * Focus search input
   */
  function focusSearch() {
    const search = document.querySelector('input[type="search"], input[name="q"], input[name="search"], #search');
    if (search) {
      search.focus();
      search.select();
    }
  }

  /**
   * Navigate to new content page
   */
  function newContent() {
    const path = window.location.pathname;
    const match = path.match(/\/admin\/content\/([^/]+)/);
    if (match) {
      window.location.href = `/admin/content/${match[1]}/new`;
    }
  }

  /**
   * Navigate to new blueprint page
   */
  function newBlueprint() {
    window.location.href = '/admin/blueprints/new';
  }

  /**
   * Select row in table
   */
  function selectRow(direction) {
    const rows = document.querySelectorAll('.admin-table tbody tr');
    if (rows.length === 0) return;

    // Remove previous selection
    rows.forEach(r => r.classList.remove('selected'));

    // Calculate new index
    selectedIndex += direction;
    if (selectedIndex < 0) selectedIndex = rows.length - 1;
    if (selectedIndex >= rows.length) selectedIndex = 0;

    // Select new row
    const row = rows[selectedIndex];
    row.classList.add('selected');
    row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /**
   * Edit selected row
   */
  function editSelected() {
    const row = document.querySelector('.admin-table tbody tr.selected');
    if (row) {
      const editLink = row.querySelector('a[href*="/edit"], a.btn');
      if (editLink) {
        window.location.href = editLink.href;
      }
    }
  }

  /**
   * Delete selected row
   */
  function deleteSelected() {
    const row = document.querySelector('.admin-table tbody tr.selected');
    if (row) {
      const deleteForm = row.querySelector('form[action*="/delete"]');
      if (deleteForm && confirm('Delete this item?')) {
        deleteForm.submit();
      }
    }
  }

  /**
   * Publish selected row
   */
  function publishSelected() {
    const row = document.querySelector('.admin-table tbody tr.selected');
    if (row) {
      const publishForm = row.querySelector('form[action*="/publish"]');
      if (publishForm) {
        publishForm.submit();
      }
    }
  }

  /**
   * Submit current form
   */
  function submitForm(continueEditing = false) {
    const form = document.querySelector('form.admin-form, form[method="POST"]');
    if (form) {
      if (continueEditing) {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = '_continue';
        input.value = '1';
        form.appendChild(input);
      }
      form.submit();
    }
  }

  /**
   * Publish content
   */
  function publishContent() {
    const publishBtn = document.querySelector('button[name="publish"], button[formaction*="/publish"]');
    if (publishBtn) {
      publishBtn.click();
    }
  }

  /**
   * Save as draft
   */
  function saveDraft() {
    const draftBtn = document.querySelector('button[name="draft"], input[name="status"][value="draft"]');
    if (draftBtn) {
      draftBtn.click();
    } else {
      submitForm();
    }
  }

  /**
   * Preview content
   */
  function previewContent() {
    const previewBtn = document.querySelector('a[href*="/preview"], button[name="preview"]');
    if (previewBtn) {
      if (previewBtn.href) {
        window.open(previewBtn.href, '_blank');
      } else {
        previewBtn.click();
      }
    }
  }

  /**
   * Go back
   */
  function goBack() {
    if (document.referrer && document.referrer.includes(window.location.host)) {
      history.back();
    } else {
      window.location.href = '/admin';
    }
  }

  /**
   * Create help modal
   */
  function createHelpModal() {
    helpModal = document.createElement('div');
    helpModal.className = 'shortcuts-modal';
    helpModal.style.cssText = `
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.5);
      z-index: 10000;
      align-items: center;
      justify-content: center;
    `;

    const content = document.createElement('div');
    content.style.cssText = `
      background: white;
      border-radius: 8px;
      max-width: 500px;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    `;

    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1rem 1.5rem;
      border-bottom: 1px solid #eee;
    `;
    header.innerHTML = `
      <h2 style="margin:0;font-size:1.25rem;">Keyboard Shortcuts</h2>
      <button onclick="Shortcuts.closeHelp()" style="background:none;border:none;font-size:1.5rem;cursor:pointer;color:#666;">&times;</button>
    `;

    const body = document.createElement('div');
    body.style.cssText = 'padding: 1rem 1.5rem;';

    // Build shortcuts list
    let html = '';

    const sections = [
      { name: 'Global', shortcuts: definitions.global },
      { name: 'Content List', shortcuts: definitions['content-list'] },
      { name: 'Content Edit', shortcuts: definitions['content-edit'] }
    ];

    for (const section of sections) {
      html += `<h3 style="margin:1rem 0 0.5rem;font-size:0.9rem;color:#666;text-transform:uppercase;">${section.name}</h3>`;
      html += '<table style="width:100%;border-collapse:collapse;">';
      for (const s of section.shortcuts) {
        const displayKey = formatKeyDisplay(s.keys);
        html += `
          <tr>
            <td style="padding:0.4rem 0;width:40%;"><kbd style="background:#f5f5f5;padding:0.2rem 0.5rem;border-radius:3px;font-family:monospace;font-size:0.85rem;">${displayKey}</kbd></td>
            <td style="padding:0.4rem 0;color:#333;">${s.description}</td>
          </tr>
        `;
      }
      html += '</table>';
    }

    body.innerHTML = html;

    content.appendChild(header);
    content.appendChild(body);
    helpModal.appendChild(content);

    // Close on backdrop click
    helpModal.addEventListener('click', (e) => {
      if (e.target === helpModal) {
        helpModal.style.display = 'none';
      }
    });

    document.body.appendChild(helpModal);
  }

  /**
   * Format key for display
   */
  function formatKeyDisplay(keys) {
    return keys
      .replace('cmd', isMac ? '⌘' : 'Ctrl')
      .replace('ctrl', isMac ? '⌃' : 'Ctrl')
      .replace('shift', isMac ? '⇧' : 'Shift')
      .replace('alt', isMac ? '⌥' : 'Alt')
      .replace('esc', 'Esc')
      .replace(/\+/g, ' + ')
      .replace(' ', ' then ');
  }

  /**
   * Close help modal
   */
  function closeHelp() {
    if (helpModal) {
      helpModal.style.display = 'none';
    }
  }

  /**
   * Set context
   */
  function setContext(newContext) {
    context = newContext;
    buildShortcuts();
  }

  /**
   * Enable/disable shortcuts
   */
  function setEnabled(value) {
    enabled = value;
  }

  /**
   * Get all shortcuts for a context
   */
  function getShortcuts(ctx) {
    return definitions[ctx || context] || [];
  }

  /**
   * Get all definitions
   */
  function getDefinitions() {
    return definitions;
  }

  // Export
  window.Shortcuts = {
    init,
    setContext,
    setEnabled,
    getShortcuts,
    getDefinitions,
    showHelp,
    closeHelp
  };

})(window);
