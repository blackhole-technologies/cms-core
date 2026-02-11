/**
 * Icon Browser Modal Component
 *
 * Provides a visual icon selection interface with:
 * - Grid view of all available icons
 * - Live search and filtering
 * - Pack filtering
 * - Icon preview with metadata
 * - Click to select
 */

export class IconBrowser {
  constructor(options = {}) {
    this.options = {
      onSelect: options.onSelect || (() => {}),
      packFilter: options.packFilter || null,
      selectedIcon: options.selectedIcon || null,
      ...options
    };

    this.modal = null;
    this.searchInput = null;
    this.gridContainer = null;
    this.packSelect = null;
    this.allIcons = [];
    this.filteredIcons = [];
    this.packs = [];
    this.searchDebounce = null;
  }

  /**
   * Show the icon browser modal
   */
  async show() {
    await this.createModal();
    await this.loadPacks();
    await this.loadIcons();
    this.modal.style.display = 'flex';
    this.searchInput.focus();
  }

  /**
   * Hide the icon browser modal
   */
  hide() {
    if (this.modal) {
      this.modal.style.display = 'none';
    }
  }

  /**
   * Destroy the modal and clean up
   */
  destroy() {
    if (this.modal && this.modal.parentNode) {
      this.modal.parentNode.removeChild(this.modal);
    }
    this.modal = null;
  }

  /**
   * Create the modal DOM structure
   */
  async createModal() {
    if (this.modal) {
      return; // Already created
    }

    const modal = document.createElement('div');
    modal.className = 'icon-browser-modal';
    modal.style.cssText = `
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.6);
      z-index: 10000;
      align-items: center;
      justify-content: center;
      padding: 20px;
    `;

    const content = document.createElement('div');
    content.className = 'icon-browser-content';
    content.style.cssText = `
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      max-width: 900px;
      width: 100%;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    `;

    // Header
    const header = document.createElement('div');
    header.className = 'icon-browser-header';
    header.style.cssText = `
      padding: 24px;
      border-bottom: 1px solid #e5e7eb;
      display: flex;
      align-items: center;
      justify-content: space-between;
    `;
    header.innerHTML = `
      <h2 style="margin: 0; font-size: 24px; font-weight: 600; color: #111827;">
        Icon Browser
      </h2>
      <button class="icon-browser-close" style="
        background: none;
        border: none;
        font-size: 24px;
        cursor: pointer;
        padding: 4px 8px;
        color: #6b7280;
        line-height: 1;
      ">&times;</button>
    `;

    // Search and filter toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'icon-browser-toolbar';
    toolbar.style.cssText = `
      padding: 16px 24px;
      background: #f9fafb;
      border-bottom: 1px solid #e5e7eb;
      display: flex;
      gap: 12px;
      align-items: center;
    `;

    toolbar.innerHTML = `
      <div style="flex: 1;">
        <input
          type="text"
          class="icon-browser-search"
          placeholder="Search icons..."
          style="
            width: 100%;
            padding: 10px 16px;
            font-size: 14px;
            border: 1px solid #d1d5db;
            border-radius: 8px;
            outline: none;
          "
        >
      </div>
      <div style="min-width: 200px;">
        <select
          class="icon-browser-pack-filter"
          style="
            width: 100%;
            padding: 10px 16px;
            font-size: 14px;
            border: 1px solid #d1d5db;
            border-radius: 8px;
            outline: none;
            background: white;
          "
        >
          <option value="">All Packs</option>
        </select>
      </div>
    `;

    // Stats bar
    const stats = document.createElement('div');
    stats.className = 'icon-browser-stats';
    stats.style.cssText = `
      padding: 12px 24px;
      background: #eff6ff;
      color: #1e40af;
      font-size: 14px;
      border-bottom: 1px solid #e5e7eb;
    `;
    stats.innerHTML = `
      <span class="icon-count">0 icons</span>
    `;

    // Grid container
    const gridWrapper = document.createElement('div');
    gridWrapper.className = 'icon-browser-grid-wrapper';
    gridWrapper.style.cssText = `
      flex: 1;
      overflow-y: auto;
      padding: 24px;
    `;

    const grid = document.createElement('div');
    grid.className = 'icon-browser-grid';
    grid.style.cssText = `
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
      gap: 12px;
    `;

    gridWrapper.appendChild(grid);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'icon-browser-footer';
    footer.style.cssText = `
      padding: 16px 24px;
      border-top: 1px solid #e5e7eb;
      display: flex;
      justify-content: flex-end;
      gap: 12px;
    `;
    footer.innerHTML = `
      <button class="icon-browser-cancel" style="
        padding: 10px 20px;
        font-size: 14px;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        background: white;
        color: #374151;
        cursor: pointer;
        font-weight: 500;
      ">Cancel</button>
    `;

    // Assemble modal
    content.appendChild(header);
    content.appendChild(toolbar);
    content.appendChild(stats);
    content.appendChild(gridWrapper);
    content.appendChild(footer);
    modal.appendChild(content);
    document.body.appendChild(modal);

    // Store references
    this.modal = modal;
    this.searchInput = toolbar.querySelector('.icon-browser-search');
    this.gridContainer = grid;
    this.packSelect = toolbar.querySelector('.icon-browser-pack-filter');
    this.statsBar = stats;

    // Event listeners
    header.querySelector('.icon-browser-close').addEventListener('click', () => this.hide());
    footer.querySelector('.icon-browser-cancel').addEventListener('click', () => this.hide());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        this.hide();
      }
    });

    this.searchInput.addEventListener('input', (e) => {
      clearTimeout(this.searchDebounce);
      this.searchDebounce = setTimeout(() => {
        this.filterIcons(e.target.value, this.packSelect.value);
      }, 300);
    });

    this.packSelect.addEventListener('change', (e) => {
      this.filterIcons(this.searchInput.value, e.target.value);
    });
  }

  /**
   * Load available icon packs
   */
  async loadPacks() {
    try {
      const response = await fetch('/api/icons/packs');
      if (!response.ok) throw new Error('Failed to load packs');

      const data = await response.json();
      this.packs = data.packs || [];

      // Populate pack filter
      this.packs.forEach(pack => {
        const option = document.createElement('option');
        option.value = pack.id;
        option.textContent = pack.name;
        this.packSelect.appendChild(option);
      });

      // Apply default pack filter if provided
      if (this.options.packFilter) {
        this.packSelect.value = this.options.packFilter;
      }
    } catch (error) {
      console.error('Failed to load icon packs:', error);
    }
  }

  /**
   * Load all icons
   */
  async loadIcons() {
    try {
      const response = await fetch('/api/icons/list');
      if (!response.ok) throw new Error('Failed to load icons');

      const data = await response.json();
      this.allIcons = data.icons || [];
      this.filterIcons(this.searchInput.value, this.packSelect.value);
    } catch (error) {
      console.error('Failed to load icons:', error);
      this.gridContainer.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: #6b7280;">
          Failed to load icons
        </div>
      `;
    }
  }

  /**
   * Filter icons based on search and pack
   */
  filterIcons(searchQuery = '', packId = '') {
    let filtered = this.allIcons;

    // Filter by pack
    if (packId) {
      filtered = filtered.filter(icon => icon.packId === packId);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(icon => {
        return icon.name.toLowerCase().includes(query) ||
               icon.id.toLowerCase().includes(query) ||
               (icon.tags && icon.tags.some(tag => tag.toLowerCase().includes(query))) ||
               (icon.aliases && icon.aliases.some(alias => alias.toLowerCase().includes(query)));
      });
    }

    this.filteredIcons = filtered;
    this.renderGrid();
    this.updateStats();
  }

  /**
   * Render the icon grid
   */
  renderGrid() {
    if (this.filteredIcons.length === 0) {
      this.gridContainer.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: #6b7280;">
          No icons found
        </div>
      `;
      return;
    }

    this.gridContainer.innerHTML = '';

    // Limit to first 100 for performance
    const iconsToShow = this.filteredIcons.slice(0, 100);

    iconsToShow.forEach(icon => {
      const item = this.createIconItem(icon);
      this.gridContainer.appendChild(item);
    });

    // Show "load more" message if there are more icons
    if (this.filteredIcons.length > 100) {
      const loadMore = document.createElement('div');
      loadMore.style.cssText = `
        grid-column: 1 / -1;
        text-align: center;
        padding: 20px;
        color: #6b7280;
        font-size: 14px;
      `;
      loadMore.textContent = `Showing 100 of ${this.filteredIcons.length} icons. Refine your search to see more.`;
      this.gridContainer.appendChild(loadMore);
    }
  }

  /**
   * Create a single icon grid item
   */
  createIconItem(icon) {
    const item = document.createElement('div');
    item.className = 'icon-browser-item';
    item.dataset.iconId = icon.id;

    const isSelected = this.options.selectedIcon === icon.id;

    item.style.cssText = `
      aspect-ratio: 1;
      border: 2px solid ${isSelected ? '#3b82f6' : '#e5e7eb'};
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.2s;
      padding: 12px;
      background: ${isSelected ? '#eff6ff' : 'white'};
      position: relative;
    `;

    // Icon preview container
    const iconPreview = document.createElement('div');
    iconPreview.className = 'icon-preview';
    iconPreview.style.cssText = `
      width: 48px;
      height: 48px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 8px;
      color: #374151;
    `;
    iconPreview.innerHTML = `<div style="width: 48px; height: 48px; background: #e5e7eb; border-radius: 4px;"></div>`;

    // Icon name
    const name = document.createElement('div');
    name.style.cssText = `
      font-size: 11px;
      color: #6b7280;
      text-align: center;
      word-break: break-word;
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      line-height: 1.3;
    `;
    name.textContent = icon.name;

    item.appendChild(iconPreview);
    item.appendChild(name);

    // Load icon SVG asynchronously
    this.loadIconSvg(icon.id, iconPreview);

    // Hover effects
    item.addEventListener('mouseenter', () => {
      if (!isSelected) {
        item.style.borderColor = '#93c5fd';
        item.style.background = '#f3f4f6';
      }
      this.showTooltip(item, icon);
    });

    item.addEventListener('mouseleave', () => {
      if (!isSelected) {
        item.style.borderColor = '#e5e7eb';
        item.style.background = 'white';
      }
      this.hideTooltip();
    });

    // Click to select
    item.addEventListener('click', () => {
      this.selectIcon(icon);
    });

    return item;
  }

  /**
   * Load icon SVG and display it
   */
  async loadIconSvg(iconId, container) {
    try {
      const response = await fetch('/api/icons/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: iconId, options: { size: 48 } })
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
   * Show tooltip with icon metadata
   */
  showTooltip(element, icon) {
    this.hideTooltip(); // Remove any existing tooltip

    const tooltip = document.createElement('div');
    tooltip.className = 'icon-browser-tooltip';
    tooltip.style.cssText = `
      position: absolute;
      background: #1f2937;
      color: white;
      padding: 12px;
      border-radius: 6px;
      font-size: 12px;
      z-index: 10001;
      pointer-events: none;
      max-width: 250px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    `;

    const pack = this.packs.find(p => p.id === icon.packId);
    const packName = pack ? pack.name : icon.packId;

    let content = `<div style="font-weight: 600; margin-bottom: 6px;">${this.escapeHtml(icon.name)}</div>`;
    content += `<div style="color: #9ca3af;">ID: ${this.escapeHtml(icon.id)}</div>`;
    content += `<div style="color: #9ca3af;">Pack: ${this.escapeHtml(packName)}</div>`;

    if (icon.variant) {
      content += `<div style="color: #9ca3af;">Variant: ${this.escapeHtml(icon.variant)}</div>`;
    }

    if (icon.tags && icon.tags.length > 0) {
      content += `<div style="color: #9ca3af; margin-top: 6px;">Tags: ${icon.tags.map(t => this.escapeHtml(t)).join(', ')}</div>`;
    }

    if (icon.aliases && icon.aliases.length > 0) {
      content += `<div style="color: #9ca3af;">Aliases: ${icon.aliases.map(a => this.escapeHtml(a)).join(', ')}</div>`;
    }

    tooltip.innerHTML = content;
    document.body.appendChild(tooltip);

    // Position tooltip
    const rect = element.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    let top = rect.bottom + 10;
    let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);

    // Keep tooltip on screen
    if (left < 10) left = 10;
    if (left + tooltipRect.width > window.innerWidth - 10) {
      left = window.innerWidth - tooltipRect.width - 10;
    }

    if (top + tooltipRect.height > window.innerHeight - 10) {
      top = rect.top - tooltipRect.height - 10;
    }

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;

    this.currentTooltip = tooltip;
  }

  /**
   * Hide tooltip
   */
  hideTooltip() {
    if (this.currentTooltip) {
      this.currentTooltip.remove();
      this.currentTooltip = null;
    }
  }

  /**
   * Update stats display
   */
  updateStats() {
    const count = this.filteredIcons.length;
    const total = this.allIcons.length;

    let text = `${count} icon${count !== 1 ? 's' : ''}`;
    if (count < total) {
      text += ` of ${total}`;
    }

    this.statsBar.querySelector('.icon-count').textContent = text;
  }

  /**
   * Select an icon
   */
  selectIcon(icon) {
    this.options.onSelect(icon);
    this.hide();
  }

  /**
   * Escape HTML for safe display
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Export as global for easy use in forms
if (typeof window !== 'undefined') {
  window.IconBrowser = IconBrowser;
}
