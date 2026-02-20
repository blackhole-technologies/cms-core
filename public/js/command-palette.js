/**
 * CMS Core — Command Palette (Ctrl+K)
 *
 * Quick navigation overlay with fuzzy search across admin pages,
 * content types, and recent content.
 */

(function() {
  'use strict';

  var overlay = null;
  var input = null;
  var results = null;
  var isOpen = false;
  var selectedIndex = 0;
  var items = [];

  // Static command items — admin pages
  var staticCommands = [
    { label: 'Dashboard', url: '/admin', section: 'Navigation' },
    { label: 'Content', url: '/admin/content', section: 'Navigation' },
    { label: 'Structure > Content types', url: '/admin/structure/types', section: 'Navigation' },
    { label: 'Taxonomy', url: '/admin/taxonomy', section: 'Navigation' },
    { label: 'Menus', url: '/admin/menus', section: 'Navigation' },
    { label: 'Blocks', url: '/admin/blocks', section: 'Navigation' },
    { label: 'Views', url: '/admin/views', section: 'Navigation' },
    { label: 'Blueprints', url: '/admin/blueprints', section: 'Navigation' },
    { label: 'Appearance', url: '/admin/appearance', section: 'Navigation' },
    { label: 'Modules', url: '/admin/modules', section: 'Navigation' },
    { label: 'Text formats', url: '/admin/text-formats', section: 'Configuration' },
    { label: 'Image styles', url: '/admin/image-styles', section: 'Configuration' },
    { label: 'Path aliases', url: '/admin/aliases', section: 'Configuration' },
    { label: 'Tokens', url: '/admin/tokens', section: 'Configuration' },
    { label: 'Regions', url: '/admin/regions', section: 'Configuration' },
    { label: 'Actions', url: '/admin/config/actions', section: 'Configuration' },
    { label: 'Rules', url: '/admin/config/rules', section: 'Configuration' },
    { label: 'User fields', url: '/admin/config/user-fields', section: 'Configuration' },
    { label: 'SEO', url: '/admin/seo', section: 'Configuration' },
    { label: 'Contact forms', url: '/admin/contact-forms', section: 'Configuration' },
    { label: 'Users', url: '/admin/users', section: 'People' },
    { label: 'Roles', url: '/admin/roles', section: 'People' },
    { label: 'Permissions', url: '/admin/permissions', section: 'People' },
    { label: 'Status report', url: '/admin/reports/status', section: 'Reports' },
    { label: 'Analytics', url: '/admin/analytics', section: 'Reports' },
    { label: 'Audit log', url: '/admin/audit', section: 'Reports' },
    { label: 'Cache', url: '/admin/cache', section: 'Reports' },
    { label: 'Queue', url: '/admin/queue', section: 'Reports' },
    { label: 'Favorites', url: '/admin/favorites', section: 'Navigation' },
    { label: 'Media library', url: '/admin/media/library', section: 'Navigation' },
    { label: 'Trash', url: '/admin/trash', section: 'Navigation' },
    { label: 'Comments', url: '/admin/comments', section: 'Navigation' },
  ];

  function createOverlay() {
    overlay = document.createElement('div');
    overlay.className = 'cmd-palette-overlay';
    overlay.innerHTML =
      '<div class="cmd-palette">' +
        '<div class="cmd-palette-header">' +
          '<input type="text" class="cmd-palette-input" placeholder="Type a command or page name..." autocomplete="off" spellcheck="false">' +
        '</div>' +
        '<div class="cmd-palette-results"></div>' +
        '<div class="cmd-palette-footer">' +
          '<span><kbd>&uarr;&darr;</kbd> Navigate</span>' +
          '<span><kbd>Enter</kbd> Go</span>' +
          '<span><kbd>Esc</kbd> Close</span>' +
        '</div>' +
      '</div>';

    input = overlay.querySelector('.cmd-palette-input');
    results = overlay.querySelector('.cmd-palette-results');

    // Close on overlay click
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) close();
    });

    // Input events
    input.addEventListener('input', function() {
      search(input.value);
    });

    input.addEventListener('keydown', function(e) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
        updateSelection();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        updateSelection();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (items[selectedIndex]) {
          window.location.href = items[selectedIndex].url;
        }
      } else if (e.key === 'Escape') {
        close();
      }
    });

    document.body.appendChild(overlay);
  }

  function fuzzyMatch(query, text) {
    query = query.toLowerCase();
    text = text.toLowerCase();

    if (text.includes(query)) return true;

    var qi = 0;
    for (var ti = 0; ti < text.length && qi < query.length; ti++) {
      if (text[ti] === query[qi]) qi++;
    }
    return qi === query.length;
  }

  function search(query) {
    query = query.trim();
    selectedIndex = 0;

    if (!query) {
      items = staticCommands.slice(0, 12);
    } else {
      items = staticCommands.filter(function(cmd) {
        return fuzzyMatch(query, cmd.label) || fuzzyMatch(query, cmd.section);
      });
    }

    renderResults();
  }

  function renderResults() {
    if (items.length === 0) {
      results.innerHTML = '<div class="cmd-palette-empty">No results found</div>';
      return;
    }

    var html = '';
    var currentSection = '';

    items.forEach(function(item, index) {
      if (item.section !== currentSection) {
        currentSection = item.section;
        html += '<div class="cmd-palette-section">' + currentSection + '</div>';
      }

      html +=
        '<a href="' + item.url + '" class="cmd-palette-item' +
        (index === selectedIndex ? ' selected' : '') +
        '" data-index="' + index + '">' +
        '<span class="cmd-palette-item-label">' + item.label + '</span>' +
        '</a>';
    });

    results.innerHTML = html;

    // Click handlers
    results.querySelectorAll('.cmd-palette-item').forEach(function(el) {
      el.addEventListener('mouseenter', function() {
        selectedIndex = parseInt(el.dataset.index, 10);
        updateSelection();
      });
    });
  }

  function updateSelection() {
    results.querySelectorAll('.cmd-palette-item').forEach(function(el, i) {
      el.classList.toggle('selected', parseInt(el.dataset.index, 10) === selectedIndex);
    });

    // Scroll into view
    var selected = results.querySelector('.cmd-palette-item.selected');
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }

  function open() {
    if (isOpen) return;
    if (!overlay) createOverlay();

    overlay.style.display = 'flex';
    isOpen = true;
    input.value = '';
    search('');
    // Focus after a brief delay to ensure overlay is visible
    requestAnimationFrame(function() {
      input.focus();
    });
  }

  function close() {
    if (!isOpen) return;
    overlay.style.display = 'none';
    isOpen = false;
  }

  // Global keyboard shortcut: Ctrl+K / Cmd+K
  document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      if (isOpen) {
        close();
      } else {
        open();
      }
    }
  });

  // Expose globally
  window.CommandPalette = { open: open, close: close };
})();
