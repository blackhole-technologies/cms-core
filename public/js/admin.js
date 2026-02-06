/**
 * CMS Core - Admin JavaScript Utilities
 * Version: 1.0.0
 * Zero dependencies, vanilla JS
 */

const CMS = {
  // CSRF token for forms
  csrfToken: null,

  init() {
    this.csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
    this.initCollapsibles();
    this.initTabs();
    this.initConfirm();
    this.initDragSort();
    this.initContextual();
    this.initAutoSave();
  },

  // Collapsible sections
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

  // Tab switching
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

  // Confirm dialogs
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

  // Drag and drop sorting
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

    // Trigger change event
    list.dispatchEvent(new CustomEvent('sort-changed', { detail: weights }));
  },

  // Contextual links
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

  // Auto-save drafts
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

    // Save on change
    let timeout;
    form.addEventListener('input', () => {
      clearTimeout(timeout);
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

  // AJAX form submission
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

  // Flash messages
  flash(message, type = 'info') {
    if (!message) return;

    const container = document.querySelector('.flash-messages') || document.body;
    const el = document.createElement('div');
    el.className = `flash flash-${type}`;
    el.textContent = message;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'flash-close';
    closeBtn.textContent = '×';
    closeBtn.onclick = () => el.remove();
    el.appendChild(closeBtn);

    container.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  },

  // Batch progress polling
  pollBatch(batchId, onProgress, onComplete) {
    if (!batchId) {
      throw new Error('Batch ID required');
    }

    const poll = async () => {
      try {
        const response = await fetch(`/admin/batch/${batchId}/status`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
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
