/**
 * CMS Core - Admin JavaScript Utilities
 * Version: 2.0.0
 * Zero dependencies, vanilla JS
 */

const CMS = {
  // CSRF token for forms
  csrfToken: null,

  init() {
    this.csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
    this.initDarkMode();
    this.initSidebar();
    this.initCollapsibles();
    this.initTabs();
    this.initConfirm();
    this.initDragSort();
    this.initContextual();
    this.initAutoSave();
    this.initPasswordToggle();
    this.initA11yChecker();
    this.initAIEditorAssist();
    this.initInfiniteScroll();
  },

  // ========================================================================
  // Dark Mode
  // ========================================================================

  initDarkMode() {
    const toggle = document.querySelector('.dark-mode-toggle');
    if (!toggle) return;

    toggle.addEventListener('click', () => {
      const html = document.documentElement;
      const current = html.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', next);
      localStorage.setItem('cms-theme', next);
    });

    // Listen for OS-level theme changes when no explicit preference is saved
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (!localStorage.getItem('cms-theme')) {
          document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
        }
      });
    }

    // Accent color: restore saved color on load
    const savedAccent = localStorage.getItem('cms-accent-color');
    if (savedAccent) {
      this.applyAccentColor(savedAccent);
    }

    // Accent color picker
    const picker = document.querySelector('.accent-color-picker');
    if (picker) {
      if (savedAccent) picker.value = savedAccent;
      picker.addEventListener('input', (e) => {
        this.applyAccentColor(e.target.value);
        localStorage.setItem('cms-accent-color', e.target.value);
      });
    }
  },

  applyAccentColor(hex) {
    // Convert #rrggbb to "r, g, b" for CSS variable --gin-primary-rgb
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    document.documentElement.style.setProperty('--gin-primary-rgb', `${r}, ${g}, ${b}`);
    // Derive hover/active shades (darken by 15% / 25%)
    const darken = (v, pct) => Math.max(0, Math.round(v * (1 - pct)));
    document.documentElement.style.setProperty('--gin-primary-hover',
      `rgb(${darken(r, 0.15)}, ${darken(g, 0.15)}, ${darken(b, 0.15)})`);
    document.documentElement.style.setProperty('--gin-primary-active',
      `rgb(${darken(r, 0.25)}, ${darken(g, 0.25)}, ${darken(b, 0.25)})`);
  },

  // ========================================================================
  // Sidebar (mobile hamburger + collapse/expand)
  // ========================================================================

  initSidebar() {
    const hamburger = document.querySelector('.sidebar-hamburger');
    const sidebar = document.querySelector('.admin-sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    const drawer = document.getElementById('sidebarDrawer');
    const drawerTitle = document.getElementById('drawerTitle');
    const drawerList = document.getElementById('drawerList');

    if (!sidebar) return;

    // Parse drawer data from embedded JSON
    var drawerData = {};
    var dataEl = document.getElementById('sidebar-drawer-data');
    if (dataEl) {
      try { drawerData = JSON.parse(dataEl.textContent); } catch (e) { /* ignore */ }
    }

    var activeDrawer = null;
    var closeTimer = null;

    // Populate drawer content without touching visibility
    function populateDrawer(key, triggerBtn) {
      var section = drawerData[key];
      if (!section) return;

      drawerTitle.textContent = section.title;

      drawerList.innerHTML = '';
      var currentPath = window.location.pathname;
      section.items.forEach(function(item) {
        var li = document.createElement('li');
        var a = document.createElement('a');
        a.href = item.href;
        a.textContent = item.label;
        if (currentPath === item.href || currentPath.indexOf(item.href + '/') === 0) {
          a.classList.add('active');
        }
        // Click a drawer link → collapse drawer, then navigate
        a.addEventListener('click', function() {
          closeDrawer();
        });
        li.appendChild(a);
        drawerList.appendChild(li);
      });

      // Update aria on all trigger buttons
      sidebar.querySelectorAll('[data-drawer]').forEach(function(btn) {
        btn.setAttribute('aria-expanded', btn === triggerBtn ? 'true' : 'false');
      });

      activeDrawer = key;
    }

    // Show the drawer panel (only if not already visible)
    function showDrawer() {
      if (!drawer.classList.contains('open')) {
        drawer.classList.add('open');
        drawer.setAttribute('aria-hidden', 'false');
      }
    }

    // Close the drawer panel
    function closeDrawer() {
      clearCloseTimer();
      drawer.classList.remove('open');
      drawer.setAttribute('aria-hidden', 'true');

      sidebar.querySelectorAll('[data-drawer]').forEach(function(btn) {
        btn.setAttribute('aria-expanded', 'false');
      });

      activeDrawer = null;
    }

    function scheduleClose() {
      clearCloseTimer();
      closeTimer = setTimeout(closeDrawer, 400);
    }

    function clearCloseTimer() {
      if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    }

    // Hover on sidebar trigger buttons → open/switch drawer
    sidebar.querySelectorAll('[data-drawer]').forEach(function(btn) {
      btn.addEventListener('mouseenter', function() {
        clearCloseTimer();
        var key = btn.getAttribute('data-drawer');
        if (activeDrawer !== key) {
          populateDrawer(key, btn);
        }
        showDrawer();
      });
    });

    // The sidebar's layout box is narrow (220px), but the drawer overflows it
    // via position:absolute. So we track mouse presence on both independently.
    // The drawer only closes when the mouse is outside BOTH.
    var mouseInSidebar = false;
    var mouseInDrawer = false;

    function checkClose() {
      if (!mouseInSidebar && !mouseInDrawer) {
        scheduleClose();
      }
    }

    sidebar.addEventListener('mouseenter', function() {
      mouseInSidebar = true;
      clearCloseTimer();
    });
    sidebar.addEventListener('mouseleave', function() {
      mouseInSidebar = false;
      checkClose();
    });

    drawer.addEventListener('mouseenter', function() {
      mouseInDrawer = true;
      clearCloseTimer();
    });
    drawer.addEventListener('mouseleave', function() {
      mouseInDrawer = false;
      checkClose();
    });

    // Mobile hamburger
    if (hamburger) {
      hamburger.addEventListener('click', function() {
        var isOpen = sidebar.classList.contains('sidebar-open');
        sidebar.classList.toggle('sidebar-open');
        hamburger.setAttribute('aria-expanded', !isOpen);
        if (overlay) overlay.classList.toggle('visible');
        // Close drawer when toggling mobile sidebar
        if (isOpen) closeDrawer();
      });
    }

    // Close sidebar on overlay click (mobile)
    if (overlay) {
      overlay.addEventListener('click', function() {
        sidebar.classList.remove('sidebar-open');
        if (hamburger) hamburger.setAttribute('aria-expanded', 'false');
        overlay.classList.remove('visible');
        closeDrawer();
      });
    }

    // Escape key → close drawer, then mobile sidebar
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        if (activeDrawer) {
          closeDrawer();
        } else if (sidebar.classList.contains('sidebar-open')) {
          sidebar.classList.remove('sidebar-open');
          if (hamburger) hamburger.setAttribute('aria-expanded', 'false');
          if (overlay) overlay.classList.remove('visible');
        }
      }
    });

  },

  // ========================================================================
  // Toast Notifications
  // ========================================================================

  toast(message, type, duration) {
    if (!message) return;
    type = type || 'info';
    duration = duration || 5000;

    var container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      container.id = 'toastContainer';
      document.body.appendChild(container);
    }

    var toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.setAttribute('role', 'alert');

    var icons = { success: '\u2713', error: '\u2717', warning: '\u26A0', info: '\u2139' };
    toast.innerHTML =
      '<span>' + (icons[type] || '') + '</span>' +
      '<span style="flex:1">' + this._escapeHtml(message) + '</span>' +
      '<button class="toast-close" aria-label="Close">&times;</button>';

    container.appendChild(toast);

    // Close button
    toast.querySelector('.toast-close').addEventListener('click', function() {
      toast.classList.add('toast-out');
      setTimeout(function() { toast.remove(); }, 300);
    });

    // Auto-dismiss
    setTimeout(function() {
      if (toast.parentNode) {
        toast.classList.add('toast-out');
        setTimeout(function() { toast.remove(); }, 300);
      }
    }, duration);

    return toast;
  },

  _escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  // ========================================================================
  // Collapsible sections
  // ========================================================================

  initCollapsibles() {
    document.querySelectorAll('.collapsible-header').forEach(header => {
      header.addEventListener('click', () => {
        const content = header.nextElementSibling;
        if (!content) return;
        content.classList.toggle('open');
        header.classList.toggle('expanded');
      });
    });
  },

  // ========================================================================
  // Tab switching
  // ========================================================================

  initTabs() {
    document.querySelectorAll('.tabs').forEach(tabContainer => {
      tabContainer.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
          const target = tab.dataset.tab;
          if (!target) return;

          tabContainer.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');

          document.querySelectorAll('.tab-content').forEach(content => {
            content.style.display = content.id === target ? 'block' : 'none';
          });
        });
      });
    });
  },

  // ========================================================================
  // Confirm dialogs
  // ========================================================================

  initConfirm() {
    document.querySelectorAll('[data-confirm]').forEach(el => {
      el.addEventListener('click', (e) => {
        const message = el.dataset.confirm;
        if (!message || !confirm(message)) {
          e.preventDefault();
        }
      });
    });
  },

  // ========================================================================
  // Drag and drop sorting
  // ========================================================================

  initDragSort() {
    document.querySelectorAll('.sortable').forEach(list => {
      let dragged = null;

      list.querySelectorAll('.sortable-item').forEach(item => {
        item.draggable = true;

        item.addEventListener('dragstart', () => {
          dragged = item;
          item.classList.add('dragging');
        });

        item.addEventListener('dragend', () => {
          item.classList.remove('dragging');
          this.updateWeights(list);
        });

        item.addEventListener('dragover', (e) => {
          e.preventDefault();
          if (!dragged || dragged === item) return;

          const rect = item.getBoundingClientRect();
          const mid = rect.top + rect.height / 2;

          if (e.clientY < mid) {
            item.parentNode.insertBefore(dragged, item);
          } else {
            item.parentNode.insertBefore(dragged, item.nextSibling);
          }
        });
      });
    });
  },

  updateWeights(list) {
    const items = list.querySelectorAll('.sortable-item');
    const weights = {};

    items.forEach((item, i) => {
      const id = item.dataset.id;
      if (!id) return;

      const weight = i * 10;
      weights[id] = weight;

      const input = item.querySelector('input[name$="[weight]"]');
      if (input) input.value = weight;
    });

    list.dispatchEvent(new CustomEvent('sort-changed', { detail: weights }));
  },

  // ========================================================================
  // Contextual links
  // ========================================================================

  initContextual() {
    document.querySelectorAll('.contextual-trigger').forEach(trigger => {
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const menu = trigger.nextElementSibling;
        if (!menu) return;

        document.querySelectorAll('.contextual-menu.open').forEach(m => {
          if (m !== menu) m.classList.remove('open');
        });
        menu.classList.toggle('open');
      });
    });

    document.addEventListener('click', () => {
      document.querySelectorAll('.contextual-menu.open').forEach(m => {
        m.classList.remove('open');
      });
    });
  },

  // ========================================================================
  // Password visibility toggle (Drupal parity: view_password)
  // ========================================================================

  initPasswordToggle() {
    document.querySelectorAll('input[type="password"]').forEach(function(input) {
      // Skip if already has a toggle
      if (input.parentElement.querySelector('.password-toggle')) return;

      var wrapper = input.parentElement;
      if (wrapper.style.position !== 'relative' && wrapper.style.position !== 'absolute') {
        wrapper.style.position = 'relative';
      }

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'password-toggle';
      btn.setAttribute('aria-label', 'Toggle password visibility');
      btn.style.cssText = 'position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--text-muted,#666);font-size:0.8rem;padding:2px 4px;';
      btn.textContent = 'Show';

      btn.addEventListener('click', function() {
        if (input.type === 'password') {
          input.type = 'text';
          btn.textContent = 'Hide';
        } else {
          input.type = 'password';
          btn.textContent = 'Show';
        }
      });

      wrapper.appendChild(btn);
    });
  },

  // ========================================================================
  // Auto-save drafts
  // ========================================================================

  initAutoSave() {
    const form = document.querySelector('form[data-autosave]');
    if (!form) return;

    const key = 'autosave_' + window.location.pathname;

    // Restore saved data
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const data = JSON.parse(saved);
        if (confirm('Restore unsaved changes?')) {
          Object.entries(data).forEach(([name, value]) => {
            const input = form.querySelector(`[name="${name}"]`);
            if (input) input.value = value;
          });
        }
      }
    } catch (err) {
      console.error('Auto-save restore failed:', err);
    }

    // Save on change — localStorage + server-side draft (Drupal parity: autosave_form)
    let timeout;
    let serverSaveTimeout;
    form.addEventListener('input', () => {
      clearTimeout(timeout);
      clearTimeout(serverSaveTimeout);
      timeout = setTimeout(() => {
        try {
          const data = {};
          new FormData(form).forEach((value, key) => {
            data[key] = value;
          });
          localStorage.setItem(key, JSON.stringify(data));
        } catch (err) {
          console.error('Auto-save failed:', err);
        }
      }, 1000);
      // Server-side draft save (debounced at 5s to reduce requests)
      serverSaveTimeout = setTimeout(() => {
        try {
          const data = {};
          new FormData(form).forEach((value, key) => {
            data[key] = value;
          });
          fetch('/admin/autosave', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: window.location.pathname, data }),
          }).catch(function() { /* server save is best-effort */ });
        } catch (err) { /* best-effort */ }
      }, 5000);
    });

    // Clear on submit
    form.addEventListener('submit', () => {
      try {
        localStorage.removeItem(key);
      } catch (err) {
        console.error('Auto-save cleanup failed:', err);
      }
    });
  },

  // ========================================================================
  // AJAX form submission
  // ========================================================================

  async submitForm(form, options = {}) {
    if (!form || !form.action) {
      throw new Error('Invalid form');
    }

    const formData = new FormData(form);
    if (this.csrfToken) {
      formData.append('_csrf', this.csrfToken);
    }

    try {
      const response = await fetch(form.action, {
        method: form.method || 'POST',
        body: formData
      });

      const data = await response.json();

      if (response.ok) {
        if (options.onSuccess) options.onSuccess(data);
      } else {
        if (options.onError) options.onError(data);
      }

      return data;
    } catch (err) {
      const error = { error: err.message };
      if (options.onError) options.onError(error);
      throw err;
    }
  },

  // ========================================================================
  // Flash messages (legacy compat — now uses toast for new code)
  // ========================================================================

  flash(message, type) {
    if (!message) return;
    type = type || 'info';

    const container = document.querySelector('.flash-messages') || document.body;
    const el = document.createElement('div');
    el.className = 'flash flash-' + type;
    el.textContent = message;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'flash-close';
    closeBtn.textContent = '\u00d7';
    closeBtn.onclick = () => el.remove();
    el.appendChild(closeBtn);

    container.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  },

  // ========================================================================
  // Batch progress polling
  // ========================================================================

  pollBatch(batchId, onProgress, onComplete) {
    if (!batchId) {
      throw new Error('Batch ID required');
    }

    const poll = async () => {
      try {
        const response = await fetch('/admin/batch/' + batchId + '/status');
        if (!response.ok) {
          throw new Error('HTTP ' + response.status);
        }

        const data = await response.json();

        if (onProgress) onProgress(data);

        if (data.status === 'completed' || data.status === 'cancelled') {
          if (onComplete) onComplete(data);
        } else {
          setTimeout(poll, 1000);
        }
      } catch (err) {
        console.error('Batch poll failed:', err);
        if (onComplete) onComplete({ status: 'error', error: err.message });
      }
    };

    poll();
  },

  // ========================================================================
  // Accessibility Checker (Editoria11y-inspired inline a11y overlay)
  // ========================================================================

  initA11yChecker() {
    // Only show on content editing pages
    if (!document.querySelector('.content-form, .admin-content-area')) return;

    const btn = document.createElement('button');
    btn.className = 'a11y-checker-toggle';
    btn.setAttribute('aria-label', 'Toggle accessibility checker');
    btn.title = 'Accessibility Checker';
    btn.textContent = 'A11y';
    btn.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;padding:8px 14px;background:var(--gin-primary);color:#fff;border:none;border-radius:var(--gin-radius-full);cursor:pointer;font-weight:600;font-size:12px;box-shadow:var(--gin-shadow-lg);transition:all var(--gin-transition)';
    document.body.appendChild(btn);

    let active = false;
    const MARKER_CLASS = 'a11y-issue-marker';

    btn.addEventListener('click', () => {
      active = !active;
      btn.style.background = active ? 'var(--gin-danger)' : 'var(--gin-primary)';

      // Clear previous markers
      document.querySelectorAll('.' + MARKER_CLASS).forEach(m => m.remove());
      document.querySelectorAll('[data-a11y-issue]').forEach(el => {
        el.style.outline = '';
        el.removeAttribute('data-a11y-issue');
      });

      if (!active) return;

      const issues = [];
      const mainContent = document.querySelector('.admin-content-area, main') || document.body;

      // Check 1: Images without alt text
      mainContent.querySelectorAll('img').forEach(img => {
        if (!img.getAttribute('alt') && !img.getAttribute('role')) {
          issues.push({ el: img, msg: 'Image missing alt text', severity: 'error' });
        } else if (img.getAttribute('alt') === '') {
          issues.push({ el: img, msg: 'Image has empty alt (decorative?)', severity: 'warning' });
        }
      });

      // Check 2: Empty headings
      mainContent.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h => {
        if (!h.textContent.trim()) {
          issues.push({ el: h, msg: 'Empty heading', severity: 'error' });
        }
      });

      // Check 3: Skipped heading levels
      const headings = Array.from(mainContent.querySelectorAll('h1,h2,h3,h4,h5,h6'));
      for (let i = 1; i < headings.length; i++) {
        const prev = parseInt(headings[i - 1].tagName[1]);
        const curr = parseInt(headings[i].tagName[1]);
        if (curr > prev + 1) {
          issues.push({ el: headings[i], msg: `Skipped heading level (h${prev} → h${curr})`, severity: 'warning' });
        }
      }

      // Check 4: Links with generic text
      mainContent.querySelectorAll('a').forEach(a => {
        const text = a.textContent.trim().toLowerCase();
        if (['click here', 'here', 'read more', 'more', 'link'].includes(text)) {
          issues.push({ el: a, msg: `Link has generic text: "${text}"`, severity: 'warning' });
        }
      });

      // Check 5: Form inputs without labels
      mainContent.querySelectorAll('input,select,textarea').forEach(input => {
        if (input.type === 'hidden' || input.type === 'submit' || input.type === 'button') return;
        const id = input.id;
        const hasLabel = id && mainContent.querySelector(`label[for="${id}"]`);
        const hasAriaLabel = input.getAttribute('aria-label') || input.getAttribute('aria-labelledby');
        if (!hasLabel && !hasAriaLabel && !input.closest('label')) {
          issues.push({ el: input, msg: 'Form field missing label', severity: 'error' });
        }
      });

      // Check 6: Buttons without accessible name
      mainContent.querySelectorAll('button').forEach(button => {
        if (!button.textContent.trim() && !button.getAttribute('aria-label') && !button.querySelector('img[alt]')) {
          issues.push({ el: button, msg: 'Button has no accessible name', severity: 'error' });
        }
      });

      // Render issue markers
      issues.forEach((issue, i) => {
        const color = issue.severity === 'error' ? 'var(--gin-danger)' : 'var(--gin-warning)';
        issue.el.style.outline = `2px solid ${color}`;
        issue.el.setAttribute('data-a11y-issue', issue.msg);

        const marker = document.createElement('span');
        marker.className = MARKER_CLASS;
        marker.title = issue.msg;
        marker.style.cssText = `position:absolute;background:${color};color:#fff;font-size:10px;padding:2px 6px;border-radius:3px;z-index:9998;pointer-events:auto;cursor:help;font-weight:600`;
        marker.textContent = issue.severity === 'error' ? '✕' : '⚠';

        // Position relative to the element
        const rect = issue.el.getBoundingClientRect();
        marker.style.position = 'fixed';
        marker.style.top = (rect.top - 4) + 'px';
        marker.style.left = (rect.left - 4) + 'px';
        document.body.appendChild(marker);
      });

      // Show summary
      btn.textContent = active ? `A11y (${issues.length})` : 'A11y';
    });
  },

  // ========================================================================
  // AI Editor Assistant — toolbar buttons for text fields
  // ========================================================================

  // ========================================================================
  // Infinite Scroll — progressive loading for paginated content lists
  // ========================================================================

  initInfiniteScroll() {
    const pagination = document.querySelector('.pagination');
    const nextLink = pagination?.querySelector('a[href*="page="]');
    const table = document.querySelector('.admin-table tbody');
    if (!pagination || !nextLink || !table) return;

    // Extract next page URL from the "Next" link
    const nextBtn = Array.from(pagination.querySelectorAll('a')).find(a => a.textContent.includes('Next'));
    if (!nextBtn) return;

    let loading = false;
    let nextUrl = nextBtn.href;

    const observer = new IntersectionObserver(async (entries) => {
      if (!entries[0].isIntersecting || loading || !nextUrl) return;
      loading = true;

      const indicator = document.createElement('div');
      indicator.className = 'infinite-scroll-loading';
      indicator.style.cssText = 'text-align:center;padding:var(--gin-space-4);color:var(--gin-text-muted);font-size:var(--gin-font-size-sm)';
      indicator.textContent = 'Loading more...';
      pagination.parentNode.insertBefore(indicator, pagination);

      try {
        const resp = await fetch(nextUrl);
        const html = await resp.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Append new rows
        const newRows = doc.querySelectorAll('.admin-table tbody tr');
        newRows.forEach(row => table.appendChild(row));

        // Find next page link
        const newNextBtn = Array.from(doc.querySelectorAll('.pagination a')).find(a => a.textContent.includes('Next'));
        nextUrl = newNextBtn ? newNextBtn.href : null;

        // Update pagination info
        const newInfo = doc.querySelector('.pagination-info');
        const currInfo = pagination.querySelector('.pagination-info');
        if (newInfo && currInfo) currInfo.textContent = newInfo.textContent;

        if (!nextUrl) {
          observer.disconnect();
          pagination.style.display = 'none';
        }
      } catch (err) {
        console.error('[infinite-scroll]', err);
        nextUrl = null;
      } finally {
        indicator.remove();
        loading = false;
      }
    }, { rootMargin: '200px' });

    observer.observe(pagination);
  },

  // ========================================================================
  // AI Editor Assistant — toolbar buttons for text fields
  // ========================================================================

  initAIEditorAssist() {
    // Attach to all textareas on content forms
    const textareas = document.querySelectorAll('.content-form textarea, .admin-form textarea');
    if (!textareas.length) return;

    const actions = [
      { key: 'rewrite', label: 'Rewrite', icon: '✎' },
      { key: 'summarize', label: 'Summarize', icon: '⊟' },
      { key: 'expand', label: 'Expand', icon: '⊞' },
      { key: 'tone-formal', label: 'Formal', icon: 'F' },
      { key: 'tone-casual', label: 'Casual', icon: 'C' },
      { key: 'fix-grammar', label: 'Fix Grammar', icon: '✓' },
    ];

    textareas.forEach(textarea => {
      // Skip tiny fields (like search, filters)
      if (textarea.rows < 3 && !textarea.classList.contains('editor-field')) return;

      const toolbar = document.createElement('div');
      toolbar.className = 'ai-editor-toolbar';
      toolbar.style.cssText = 'display:flex;gap:4px;margin-bottom:4px;flex-wrap:wrap';

      const label = document.createElement('span');
      label.textContent = 'AI:';
      label.style.cssText = 'font-size:11px;color:var(--gin-text-muted);padding:3px 0;font-weight:600';
      toolbar.appendChild(label);

      actions.forEach(action => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = action.icon + ' ' + action.label;
        btn.title = action.label;
        btn.style.cssText = 'font-size:11px;padding:2px 8px;background:var(--gin-surface-alt);border:1px solid var(--gin-border);border-radius:4px;cursor:pointer;color:var(--gin-text-light);transition:all 150ms';
        btn.addEventListener('mouseenter', () => { btn.style.background = 'var(--gin-primary-light)'; btn.style.color = 'var(--gin-primary)'; });
        btn.addEventListener('mouseleave', () => { btn.style.background = 'var(--gin-surface-alt)'; btn.style.color = 'var(--gin-text-light)'; });

        btn.addEventListener('click', async () => {
          const text = textarea.value.trim();
          if (!text) return;

          btn.disabled = true;
          const origText = btn.textContent;
          btn.textContent = '...';

          try {
            const resp = await fetch('/api/ai/editor-assist', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(CMS.csrfToken ? { 'X-CSRF-Token': CMS.csrfToken } : {}),
              },
              body: JSON.stringify({ text, action: action.key }),
            });

            const data = await resp.json();
            if (data.result) {
              textarea.value = data.result;
              textarea.dispatchEvent(new Event('input', { bubbles: true }));
            } else if (data.error) {
              console.warn('[ai-assist]', data.error);
            }
          } catch (err) {
            console.error('[ai-assist]', err);
          } finally {
            btn.disabled = false;
            btn.textContent = origText;
          }
        });

        toolbar.appendChild(btn);
      });

      textarea.parentNode.insertBefore(toolbar, textarea);
    });
  }
};

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => CMS.init());
} else {
  CMS.init();
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CMS;
}
