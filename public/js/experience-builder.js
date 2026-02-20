/**
 * Experience Builder - Visual Drag-Drop Page Builder
 *
 * Vanilla JS implementation using HTML5 Drag and Drop API.
 * No framework dependencies.
 *
 * Communicates with the server via JSON API endpoints:
 *   GET  /admin/xb/api/layout/:type/:id   → load layout
 *   POST /admin/xb/api/layout/:type/:id   → save layout
 *   GET  /admin/xb/api/components         → list available components
 *   GET  /admin/xb/api/layouts            → list layout definitions
 */
(function() {
  'use strict';

  // ============================================
  // STATE
  // ============================================

  var state = {
    contentType: '',
    contentId: '',
    layout: null,         // { sections: [...] }
    layouts: [],          // available layout definitions
    components: [],       // available components for sidebar
    dirty: false,
    dragData: null,       // current drag payload
  };

  // ============================================
  // INITIALIZATION
  // ============================================

  /**
   * Boot the Experience Builder.
   * Called from the admin template with content type and ID.
   */
  window.XBInit = function(contentType, contentId) {
    state.contentType = contentType;
    state.contentId = contentId;

    // Load all data in parallel, then render
    Promise.all([
      fetchJson('/admin/xb/api/layout/' + contentType + '/' + contentId),
      fetchJson('/admin/xb/api/components'),
      fetchJson('/admin/xb/api/layouts'),
    ]).then(function(results) {
      state.layout = results[0] || { sections: [] };
      state.components = results[1] || [];
      state.layouts = results[2] || [];
      render();
    }).catch(function(err) {
      var canvas = document.getElementById('xb-canvas');
      if (canvas) {
        var msg = document.createElement('div');
        msg.className = 'alert alert-danger';
        msg.textContent = 'Failed to load builder data: ' + err.message;
        canvas.appendChild(msg);
      }
    });
  };

  // ============================================
  // RENDERING
  // ============================================

  function render() {
    renderSidebar();
    renderCanvas();
  }

  /**
   * Render the component browser sidebar.
   */
  function renderSidebar() {
    var list = document.getElementById('xb-component-list');
    if (!list) return;

    // Clear existing items
    while (list.firstChild) list.removeChild(list.firstChild);

    var searchInput = document.getElementById('xb-search');
    var filter = searchInput ? searchInput.value.toLowerCase() : '';

    state.components.forEach(function(comp) {
      if (filter && comp.label.toLowerCase().indexOf(filter) === -1) return;

      var item = document.createElement('div');
      item.className = 'xb-component-item';
      item.draggable = true;
      item.setAttribute('data-component-type', comp.type || 'block');
      item.setAttribute('data-component-id', comp.id);

      var icon = document.createElement('span');
      icon.className = 'xb-component-item__icon';
      icon.textContent = (comp.label || '?').charAt(0).toUpperCase();
      item.appendChild(icon);

      var label = document.createElement('span');
      label.className = 'xb-component-item__label';
      label.textContent = comp.label;
      item.appendChild(label);

      var type = document.createElement('span');
      type.className = 'xb-component-item__type';
      type.textContent = comp.category || comp.type || '';
      item.appendChild(type);

      // Drag start
      item.addEventListener('dragstart', function(e) {
        state.dragData = {
          source: 'sidebar',
          componentType: comp.type || 'block',
          componentId: comp.id,
          label: comp.label,
        };
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', comp.id);
      });

      list.appendChild(item);
    });
  }

  /**
   * Render the layout canvas with all sections and components.
   */
  function renderCanvas() {
    var canvas = document.getElementById('xb-canvas-content');
    if (!canvas) return;

    while (canvas.firstChild) canvas.removeChild(canvas.firstChild);

    if (!state.layout || !state.layout.sections) {
      state.layout = { sections: [] };
    }

    // Sort sections by weight
    var sections = state.layout.sections.slice().sort(function(a, b) {
      return (a.weight || 0) - (b.weight || 0);
    });

    sections.forEach(function(section, idx) {
      canvas.appendChild(renderSection(section, idx));
    });

    // Add section button
    var addBtn = document.createElement('div');
    addBtn.className = 'xb-add-section';
    addBtn.textContent = '+ Add Section';
    addBtn.addEventListener('click', showAddSectionModal);
    canvas.appendChild(addBtn);
  }

  /**
   * Render a single section with its regions.
   */
  function renderSection(section, sectionIdx) {
    var layoutDef = findLayout(section.layoutId);
    var el = document.createElement('div');
    el.className = 'xb-section';
    el.setAttribute('data-section-uuid', section.uuid);

    // Header
    var header = document.createElement('div');
    header.className = 'xb-section__header';
    header.draggable = true;

    var label = document.createElement('span');
    label.className = 'xb-section__label';
    label.textContent = (layoutDef ? layoutDef.label : section.layoutId) + ' Section';
    header.appendChild(label);

    var controls = document.createElement('div');
    controls.className = 'xb-section__controls';

    // Move up
    if (sectionIdx > 0) {
      var upBtn = document.createElement('button');
      upBtn.textContent = '\u2191';
      upBtn.title = 'Move up';
      upBtn.addEventListener('click', function() { moveSectionUp(section.uuid); });
      controls.appendChild(upBtn);
    }

    // Move down
    if (sectionIdx < state.layout.sections.length - 1) {
      var downBtn = document.createElement('button');
      downBtn.textContent = '\u2193';
      downBtn.title = 'Move down';
      downBtn.addEventListener('click', function() { moveSectionDown(section.uuid); });
      controls.appendChild(downBtn);
    }

    // Remove
    var removeBtn = document.createElement('button');
    removeBtn.textContent = '\u00D7';
    removeBtn.title = 'Remove section';
    removeBtn.addEventListener('click', function() {
      if (confirm('Remove this section and all its components?')) {
        removeSection(section.uuid);
      }
    });
    controls.appendChild(removeBtn);

    header.appendChild(controls);

    // Section-level drag for reordering
    header.addEventListener('dragstart', function(e) {
      state.dragData = { source: 'section', sectionUuid: section.uuid };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', section.uuid);
      el.classList.add('xb-dragging');
    });
    header.addEventListener('dragend', function() {
      el.classList.remove('xb-dragging');
      state.dragData = null;
    });

    el.appendChild(header);

    // Regions
    var regionsEl = document.createElement('div');
    regionsEl.className = 'xb-section__regions';

    var regions = layoutDef ? layoutDef.regions : { content: { label: 'Content' } };
    var regionIds = Object.keys(regions);

    // Apply column widths if defined
    var widths = (section.settings && section.settings.columnWidths)
      ? section.settings.columnWidths.split('-')
      : null;

    regionIds.forEach(function(regionId, rIdx) {
      var regionEl = document.createElement('div');
      regionEl.className = 'xb-region';
      regionEl.setAttribute('data-section-uuid', section.uuid);
      regionEl.setAttribute('data-region-id', regionId);

      if (widths && widths[rIdx]) {
        regionEl.style.flex = '0 0 ' + widths[rIdx] + '%';
      }

      var regionLabel = document.createElement('div');
      regionLabel.className = 'xb-region__label';
      regionLabel.textContent = regions[regionId].label || regionId;
      regionEl.appendChild(regionLabel);

      // Render components in this region
      var components = (section.components && section.components[regionId]) || [];
      components.sort(function(a, b) { return (a.weight || 0) - (b.weight || 0); });

      if (components.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'xb-region--empty';
        empty.textContent = 'Drop components here';
        regionEl.appendChild(empty);
      }

      components.forEach(function(comp) {
        regionEl.appendChild(renderComponent(comp, section.uuid, regionId));
      });

      // Drop zone events
      regionEl.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = state.dragData && state.dragData.source === 'sidebar' ? 'copy' : 'move';
        regionEl.classList.add('xb-drag-over');
      });
      regionEl.addEventListener('dragleave', function(e) {
        if (!regionEl.contains(e.relatedTarget)) {
          regionEl.classList.remove('xb-drag-over');
        }
      });
      regionEl.addEventListener('drop', function(e) {
        e.preventDefault();
        regionEl.classList.remove('xb-drag-over');
        handleDrop(section.uuid, regionId, e);
      });

      regionsEl.appendChild(regionEl);
    });

    el.appendChild(regionsEl);
    return el;
  }

  /**
   * Render a placed component within a region.
   */
  function renderComponent(comp, sectionUuid, regionId) {
    var el = document.createElement('div');
    el.className = 'xb-component';
    el.draggable = true;
    el.setAttribute('data-component-uuid', comp.uuid);
    el.setAttribute('data-section-uuid', sectionUuid);
    el.setAttribute('data-region-id', regionId);

    var header = document.createElement('div');
    header.className = 'xb-component__header';

    var name = document.createElement('span');
    name.className = 'xb-component__name';
    name.textContent = comp.configuration?.label || comp.blockId || comp.type || 'Component';
    header.appendChild(name);

    var typeSpan = document.createElement('span');
    typeSpan.className = 'xb-component__type';
    typeSpan.textContent = comp.type;
    header.appendChild(typeSpan);

    var removeBtn = document.createElement('button');
    removeBtn.className = 'xb-component__remove';
    removeBtn.textContent = '\u00D7';
    removeBtn.title = 'Remove';
    removeBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      removeComponent(sectionUuid, regionId, comp.uuid);
    });
    header.appendChild(removeBtn);

    el.appendChild(header);

    // Drag events for reordering
    el.addEventListener('dragstart', function(e) {
      e.stopPropagation();
      state.dragData = {
        source: 'canvas',
        componentUuid: comp.uuid,
        sectionUuid: sectionUuid,
        regionId: regionId,
      };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', comp.uuid);
      el.classList.add('xb-dragging');
    });

    el.addEventListener('dragend', function() {
      el.classList.remove('xb-dragging');
      state.dragData = null;
    });

    return el;
  }

  // ============================================
  // DRAG & DROP HANDLERS
  // ============================================

  function handleDrop(sectionUuid, regionId, e) {
    if (!state.dragData) return;

    if (state.dragData.source === 'sidebar') {
      // New component from sidebar
      addComponent(sectionUuid, regionId, {
        type: state.dragData.componentType,
        blockId: state.dragData.componentId,
        label: state.dragData.label,
      });
    } else if (state.dragData.source === 'canvas') {
      // Move existing component
      moveComponentToRegion(
        state.dragData.sectionUuid,
        state.dragData.regionId,
        state.dragData.componentUuid,
        sectionUuid,
        regionId
      );
    }

    state.dragData = null;
  }

  // ============================================
  // LAYOUT MUTATIONS
  // ============================================

  function generateUuid() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 9);
  }

  function addSection(layoutId) {
    var layoutDef = findLayout(layoutId);
    if (!layoutDef) return;

    var section = {
      uuid: generateUuid(),
      layoutId: layoutId,
      settings: Object.assign({}, layoutDef.defaultSettings || {}),
      components: {},
      weight: state.layout.sections.length * 10,
    };

    // Initialize empty component arrays for each region
    Object.keys(layoutDef.regions || {}).forEach(function(regionId) {
      section.components[regionId] = [];
    });

    state.layout.sections.push(section);
    state.dirty = true;
    renderCanvas();
  }

  function removeSection(uuid) {
    state.layout.sections = state.layout.sections.filter(function(s) { return s.uuid !== uuid; });
    state.dirty = true;
    renderCanvas();
  }

  function moveSectionUp(uuid) {
    var sections = state.layout.sections;
    var idx = sections.findIndex(function(s) { return s.uuid === uuid; });
    if (idx <= 0) return;
    var tmp = sections[idx];
    sections[idx] = sections[idx - 1];
    sections[idx - 1] = tmp;
    // Update weights
    sections.forEach(function(s, i) { s.weight = i * 10; });
    state.dirty = true;
    renderCanvas();
  }

  function moveSectionDown(uuid) {
    var sections = state.layout.sections;
    var idx = sections.findIndex(function(s) { return s.uuid === uuid; });
    if (idx === -1 || idx >= sections.length - 1) return;
    var tmp = sections[idx];
    sections[idx] = sections[idx + 1];
    sections[idx + 1] = tmp;
    sections.forEach(function(s, i) { s.weight = i * 10; });
    state.dirty = true;
    renderCanvas();
  }

  function addComponent(sectionUuid, regionId, compData) {
    var section = findSection(sectionUuid);
    if (!section) return;
    if (!section.components[regionId]) section.components[regionId] = [];

    var comp = {
      uuid: generateUuid(),
      type: compData.type || 'block',
      blockId: compData.blockId || '',
      configuration: { label: compData.label || compData.blockId || 'Component' },
      weight: section.components[regionId].length * 10,
    };

    section.components[regionId].push(comp);
    state.dirty = true;
    renderCanvas();
  }

  function removeComponent(sectionUuid, regionId, compUuid) {
    var section = findSection(sectionUuid);
    if (!section || !section.components[regionId]) return;
    section.components[regionId] = section.components[regionId].filter(function(c) {
      return c.uuid !== compUuid;
    });
    state.dirty = true;
    renderCanvas();
  }

  function moveComponentToRegion(fromSection, fromRegion, compUuid, toSection, toRegion) {
    var srcSection = findSection(fromSection);
    if (!srcSection || !srcSection.components[fromRegion]) return;

    // Find and remove from source
    var compIdx = srcSection.components[fromRegion].findIndex(function(c) { return c.uuid === compUuid; });
    if (compIdx === -1) return;
    var comp = srcSection.components[fromRegion].splice(compIdx, 1)[0];

    // Add to target
    var destSection = findSection(toSection);
    if (!destSection) return;
    if (!destSection.components[toRegion]) destSection.components[toRegion] = [];
    comp.weight = destSection.components[toRegion].length * 10;
    destSection.components[toRegion].push(comp);

    state.dirty = true;
    renderCanvas();
  }

  // ============================================
  // ADD SECTION MODAL
  // ============================================

  function showAddSectionModal() {
    var overlay = document.createElement('div');
    overlay.className = 'xb-modal-overlay';

    var modal = document.createElement('div');
    modal.className = 'xb-modal';

    var title = document.createElement('h3');
    title.textContent = 'Choose a Section Layout';
    modal.appendChild(title);

    var options = document.createElement('div');
    options.className = 'xb-modal__options';

    state.layouts.forEach(function(layout) {
      var opt = document.createElement('div');
      opt.className = 'xb-modal__option';

      var label = document.createElement('div');
      label.textContent = layout.label;
      label.style.fontWeight = '600';
      opt.appendChild(label);

      if (layout.description) {
        var desc = document.createElement('div');
        desc.style.fontSize = '0.75rem';
        desc.style.color = '#666';
        desc.textContent = layout.description;
        opt.appendChild(desc);
      }

      opt.addEventListener('click', function() {
        document.body.removeChild(overlay);
        addSection(layout.id);
      });

      options.appendChild(opt);
    });

    modal.appendChild(options);

    var cancel = document.createElement('div');
    cancel.className = 'xb-modal__cancel';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', function() {
      document.body.removeChild(overlay);
    });
    modal.appendChild(cancel);

    overlay.appendChild(modal);
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) document.body.removeChild(overlay);
    });

    document.body.appendChild(overlay);
  }

  // ============================================
  // SAVE
  // ============================================

  function save() {
    var saveBtn = document.getElementById('xb-save-btn');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
    }

    fetchJson('/admin/xb/api/layout/' + state.contentType + '/' + state.contentId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.layout),
    }).then(function() {
      state.dirty = false;
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Layout';
      }
      showToast('Layout saved successfully');
    }).catch(function(err) {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Layout';
      }
      showToast('Error saving: ' + err.message, 'error');
    });
  }

  // ============================================
  // HELPERS
  // ============================================

  function findSection(uuid) {
    return state.layout.sections.find(function(s) { return s.uuid === uuid; }) || null;
  }

  function findLayout(layoutId) {
    return state.layouts.find(function(l) { return l.id === layoutId; }) || null;
  }

  function fetchJson(url, options) {
    return fetch(url, options || {}).then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  function showToast(message, type) {
    var toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;bottom:1rem;right:1rem;padding:0.75rem 1.5rem;border-radius:4px;color:#fff;font-size:0.875rem;z-index:99999;';
    toast.style.background = type === 'error' ? '#dc3545' : '#28a745';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(function() {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 3000);
  }

  // ============================================
  // EVENT BINDINGS
  // ============================================

  document.addEventListener('DOMContentLoaded', function() {
    // Save button
    var saveBtn = document.getElementById('xb-save-btn');
    if (saveBtn) saveBtn.addEventListener('click', save);

    // Search filter
    var searchInput = document.getElementById('xb-search');
    if (searchInput) {
      searchInput.addEventListener('input', function() {
        renderSidebar();
      });
    }

    // Warn on unsaved changes
    window.addEventListener('beforeunload', function(e) {
      if (state.dirty) {
        e.preventDefault();
        e.returnValue = 'You have unsaved layout changes.';
      }
    });
  });

})();
