/**
 * Icon Widget - Enhanced Icon Selection for Admin Forms
 *
 * Provides a complete icon selection experience with:
 * - Text input with autocomplete
 * - Live icon preview
 * - Browse button to open modal
 * - Clear button
 * - Metadata tooltip
 */

import { IconBrowser } from './icon-browser.js';

export class IconWidget {
  constructor(input, options = {}) {
    this.input = input;
    this.options = {
      showPreview: options.showPreview !== false,
      showBrowse: options.showBrowse !== false,
      showClear: options.showClear !== false,
      packFilter: options.packFilter || null,
      size: options.size || 32,
      ...options
    };

    this.container = null;
    this.previewContainer = null;
    this.browseButton = null;
    this.clearButton = null;
    this.dropdown = null;
    this.browser = null;
    this.debounceTimer = null;
    this.selectedIndex = -1;
    this.results = [];

    this.init();
  }

  /**
   * Initialize the widget
   */
  init() {
    this.wrapInput();
    this.createControls();
    this.attachEvents();

    // Load initial preview if value exists
    if (this.input.value) {
      this.updatePreview(this.input.value);
    }
  }

  /**
   * Wrap input in container
   */
  wrapInput() {
    const wrapper = document.createElement('div');
    wrapper.className = 'icon-widget';
    wrapper.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      position: relative;
    `;

    this.input.parentNode.insertBefore(wrapper, this.input);
    wrapper.appendChild(this.input);

    // Style input
    this.input.style.cssText = `
      flex: 1;
      padding: 10px 12px;
      font-size: 14px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      outline: none;
    `;

    this.container = wrapper;
  }

  /**
   * Create preview, browse, and clear controls
   */
  createControls() {
    // Preview container
    if (this.options.showPreview) {
      const preview = document.createElement('div');
      preview.className = 'icon-widget-preview';
      preview.style.cssText = `
        width: ${this.options.size}px;
        height: ${this.options.size}px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px solid #e5e7eb;
        border-radius: 6px;
        background: #f9fafb;
        flex-shrink: 0;
        position: relative;
        cursor: help;
      `;
      this.container.appendChild(preview);
      this.previewContainer = preview;

      // Tooltip on hover
      preview.addEventListener('mouseenter', (e) => this.showPreviewTooltip(e));
      preview.addEventListener('mouseleave', () => this.hidePreviewTooltip());
    }

    // Browse button
    if (this.options.showBrowse) {
      const browse = document.createElement('button');
      browse.type = 'button';
      browse.className = 'icon-widget-browse';
      browse.textContent = 'Browse';
      browse.style.cssText = `
        padding: 10px 16px;
        font-size: 14px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        background: white;
        color: #374151;
        cursor: pointer;
        font-weight: 500;
        transition: all 0.2s;
        white-space: nowrap;
      `;
      browse.addEventListener('mouseenter', () => {
        browse.style.background = '#f3f4f6';
        browse.style.borderColor = '#9ca3af';
      });
      browse.addEventListener('mouseleave', () => {
        browse.style.background = 'white';
        browse.style.borderColor = '#d1d5db';
      });
      this.container.appendChild(browse);
      this.browseButton = browse;
    }

    // Clear button
    if (this.options.showClear) {
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'icon-widget-clear';
      clear.innerHTML = '&times;';
      clear.title = 'Clear selection';
      clear.style.cssText = `
        width: 32px;
        height: 32px;
        padding: 0;
        font-size: 24px;
        line-height: 1;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        background: white;
        color: #6b7280;
        cursor: pointer;
        transition: all 0.2s;
        display: ${this.input.value ? 'block' : 'none'};
      `;
      clear.addEventListener('mouseenter', () => {
        clear.style.background = '#fee2e2';
        clear.style.borderColor = '#ef4444';
        clear.style.color = '#dc2626';
      });
      clear.addEventListener('mouseleave', () => {
        clear.style.background = 'white';
        clear.style.borderColor = '#d1d5db';
        clear.style.color = '#6b7280';
      });
      this.container.appendChild(clear);
      this.clearButton = clear;
    }

    // Autocomplete dropdown
    const dropdown = document.createElement('div');
    dropdown.className = 'icon-widget-dropdown';
    dropdown.style.cssText = `
      display: none;
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      margin-top: 4px;
      background: white;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      max-height: 300px;
      overflow-y: auto;
      z-index: 1000;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    `;
    this.container.appendChild(dropdown);
    this.dropdown = dropdown;
  }

  /**
   * Attach event listeners
   */
  attachEvents() {
    // Input events for autocomplete
    this.input.addEventListener('input', (e) => this.handleInput(e));
    this.input.addEventListener('keydown', (e) => this.handleKeyDown(e));
    this.input.addEventListener('focus', () => {
      if (this.results.length > 0) {
        this.showDropdown();
      }
    });

    // Browse button
    if (this.browseButton) {
      this.browseButton.addEventListener('click', () => this.openBrowser());
    }

    // Clear button
    if (this.clearButton) {
      this.clearButton.addEventListener('click', () => this.clearSelection());
    }

    // Click outside to close dropdown
    document.addEventListener('click', (e) => {
      if (!this.container.contains(e.target)) {
        this.hideDropdown();
      }
    });
  }

  /**
   * Handle input changes (autocomplete)
   */
  handleInput(e) {
    clearTimeout(this.debounceTimer);

    const query = e.target.value.trim();

    // Update clear button visibility
    if (this.clearButton) {
      this.clearButton.style.display = query ? 'block' : 'none';
    }

    if (query.length < 2) {
      this.hideDropdown();
      if (this.previewContainer) {
        this.previewContainer.innerHTML = '';
      }
      return;
    }

    this.dropdown.innerHTML = '<div style="padding: 12px; text-align: center; color: #6b7280;">Searching...</div>';
    this.showDropdown();

    this.debounceTimer = setTimeout(() => {
      this.performSearch(query);
    }, 300);
  }

  /**
   * Perform icon search
   */
  async performSearch(query) {
    try {
      let url = `/api/icons/search?q=${encodeURIComponent(query)}&limit=10`;
      if (this.options.packFilter) {
        url += `&pack=${encodeURIComponent(this.options.packFilter)}`;
      }

      const response = await fetch(url);
      if (!response.ok) throw new Error('Search failed');

      const data = await response.json();
      this.results = data.results || [];
      this.selectedIndex = -1;

      this.renderDropdown();
    } catch (error) {
      console.error('Icon search error:', error);
      this.dropdown.innerHTML = '<div style="padding: 12px; text-align: center; color: #ef4444;">Search failed</div>';
    }
  }

  /**
   * Render autocomplete dropdown
   */
  renderDropdown() {
    if (this.results.length === 0) {
      this.dropdown.innerHTML = '<div style="padding: 12px; text-align: center; color: #6b7280;">No icons found</div>';
      return;
    }

    this.dropdown.innerHTML = '';

    this.results.forEach((icon, index) => {
      const item = document.createElement('div');
      item.className = 'dropdown-item';
      item.dataset.index = index;
      item.style.cssText = `
        padding: 10px 12px;
        cursor: pointer;
        border-bottom: 1px solid #f3f4f6;
        display: flex;
        align-items: center;
        gap: 10px;
        transition: background 0.15s;
      `;

      const iconPreview = document.createElement('div');
      iconPreview.style.cssText = `
        width: 24px;
        height: 24px;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      `;
      iconPreview.innerHTML = '<div style="width: 24px; height: 24px; background: #e5e7eb; border-radius: 3px;"></div>';

      const info = document.createElement('div');
      info.style.flex = '1';
      info.innerHTML = `
        <div style="font-weight: 500; font-size: 13px; color: #111827;">${this.escapeHtml(icon.name)}</div>
        <div style="font-size: 11px; color: #6b7280;">${this.escapeHtml(icon.packName || icon.packId)}</div>
      `;

      item.appendChild(iconPreview);
      item.appendChild(info);
      this.dropdown.appendChild(item);

      // Load icon preview
      this.loadIconSvg(icon.id, iconPreview, 24);

      // Events
      item.addEventListener('mouseenter', () => {
        this.selectedIndex = index;
        this.updateDropdownHighlight();
      });

      item.addEventListener('click', () => {
        this.selectIcon(icon);
      });
    });

    this.showDropdown();
  }

  /**
   * Handle keyboard navigation
   */
  handleKeyDown(e) {
    if (!this.dropdown || this.dropdown.style.display === 'none') {
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.selectedIndex = Math.min(this.selectedIndex + 1, this.results.length - 1);
        this.updateDropdownHighlight();
        this.scrollToSelected();
        break;

      case 'ArrowUp':
        e.preventDefault();
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
        this.updateDropdownHighlight();
        this.scrollToSelected();
        break;

      case 'Enter':
        e.preventDefault();
        if (this.selectedIndex >= 0 && this.results[this.selectedIndex]) {
          this.selectIcon(this.results[this.selectedIndex]);
        }
        break;

      case 'Escape':
        e.preventDefault();
        this.hideDropdown();
        break;
    }
  }

  /**
   * Update dropdown highlight
   */
  updateDropdownHighlight() {
    const items = this.dropdown.querySelectorAll('.dropdown-item');
    items.forEach((item, index) => {
      if (index === this.selectedIndex) {
        item.style.background = '#eff6ff';
      } else {
        item.style.background = 'white';
      }
    });
  }

  /**
   * Scroll to selected item
   */
  scrollToSelected() {
    const items = this.dropdown.querySelectorAll('.dropdown-item');
    if (items[this.selectedIndex]) {
      items[this.selectedIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  /**
   * Select an icon
   */
  selectIcon(icon) {
    this.input.value = icon.id;
    this.hideDropdown();
    this.updatePreview(icon.id);

    if (this.clearButton) {
      this.clearButton.style.display = 'block';
    }

    // Trigger change event
    this.input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /**
   * Clear selection
   */
  clearSelection() {
    this.input.value = '';
    if (this.previewContainer) {
      this.previewContainer.innerHTML = '';
    }
    if (this.clearButton) {
      this.clearButton.style.display = 'none';
    }
    this.hideDropdown();
    this.input.focus();

    // Trigger change event
    this.input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /**
   * Update icon preview
   */
  async updatePreview(iconId) {
    if (!this.previewContainer || !iconId) return;

    try {
      const response = await fetch('/api/icons/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: iconId, options: { size: this.options.size } })
      });

      if (response.ok) {
        const data = await response.json();
        this.previewContainer.innerHTML = data.svg;
        this.previewContainer.dataset.iconId = iconId;
      }
    } catch (error) {
      console.error('Failed to load icon preview:', error);
    }
  }

  /**
   * Load icon SVG
   */
  async loadIconSvg(iconId, container, size) {
    try {
      const response = await fetch('/api/icons/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: iconId, options: { size } })
      });

      if (response.ok) {
        const data = await response.json();
        container.innerHTML = data.svg;
      }
    } catch (error) {
      console.error('Failed to load icon:', iconId, error);
    }
  }

  /**
   * Show preview tooltip
   */
  async showPreviewTooltip(e) {
    const iconId = this.previewContainer.dataset.iconId;
    if (!iconId) return;

    try {
      // Fetch icon metadata
      const searchResponse = await fetch(`/api/icons/search?q=${encodeURIComponent(iconId)}&limit=1`);
      if (!searchResponse.ok) return;

      const searchData = await searchResponse.json();
      const icon = searchData.results && searchData.results[0];
      if (!icon) return;

      // Create tooltip
      const tooltip = document.createElement('div');
      tooltip.className = 'icon-widget-tooltip';
      tooltip.style.cssText = `
        position: fixed;
        background: #1f2937;
        color: white;
        padding: 10px 12px;
        border-radius: 6px;
        font-size: 12px;
        z-index: 10001;
        pointer-events: none;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        max-width: 200px;
      `;

      let content = `<div style="font-weight: 600; margin-bottom: 4px;">${this.escapeHtml(icon.name)}</div>`;
      content += `<div style="color: #9ca3af; font-size: 11px;">Pack: ${this.escapeHtml(icon.packName || icon.packId)}</div>`;

      if (icon.variant) {
        content += `<div style="color: #9ca3af; font-size: 11px;">Variant: ${this.escapeHtml(icon.variant)}</div>`;
      }

      tooltip.innerHTML = content;
      document.body.appendChild(tooltip);

      // Position tooltip
      const rect = this.previewContainer.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();

      tooltip.style.top = `${rect.bottom + 8}px`;
      tooltip.style.left = `${rect.left + (rect.width / 2) - (tooltipRect.width / 2)}px`;

      this.currentTooltip = tooltip;
    } catch (error) {
      console.error('Failed to show tooltip:', error);
    }
  }

  /**
   * Hide preview tooltip
   */
  hidePreviewTooltip() {
    if (this.currentTooltip) {
      this.currentTooltip.remove();
      this.currentTooltip = null;
    }
  }

  /**
   * Open icon browser modal
   */
  openBrowser() {
    if (!this.browser) {
      this.browser = new IconBrowser({
        packFilter: this.options.packFilter,
        selectedIcon: this.input.value,
        onSelect: (icon) => {
          this.selectIcon(icon);
        }
      });
    }

    this.browser.options.selectedIcon = this.input.value;
    this.browser.show();
  }

  /**
   * Show dropdown
   */
  showDropdown() {
    this.dropdown.style.display = 'block';
  }

  /**
   * Hide dropdown
   */
  hideDropdown() {
    this.dropdown.style.display = 'none';
  }

  /**
   * Escape HTML
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Auto-initialize all icon widgets on page load
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('input[data-icon-widget]').forEach(input => {
      new IconWidget(input, {
        showPreview: input.dataset.showPreview !== 'false',
        showBrowse: input.dataset.showBrowse !== 'false',
        showClear: input.dataset.showClear !== 'false',
        packFilter: input.dataset.packFilter || null,
        size: parseInt(input.dataset.size) || 32
      });
    });
  });
}

// Export for manual initialization
if (typeof window !== 'undefined') {
  window.IconWidget = IconWidget;
}
