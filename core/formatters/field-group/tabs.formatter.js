/**
 * Tabs Formatter for Field Groups
 *
 * WHY THIS EXISTS:
 * Renders field groups as tabbed panels with horizontal or vertical orientation.
 * Common pattern for organizing complex forms with many fields.
 *
 * ACCESSIBILITY:
 * Implements ARIA tab pattern:
 * - role="tablist" for tab navigation
 * - role="tab" for individual tabs
 * - role="tabpanel" for content panels
 * - aria-controls and aria-labelledby for relationships
 * - aria-selected for active state
 *
 * FEATURES:
 * - Horizontal or vertical tab orientation
 * - Keyboard navigation (arrows, Home, End)
 * - Default active tab configuration
 * - Nested groups (tabs can contain other formatters)
 * - Custom CSS classes and attributes
 */

/**
 * Render tabs group
 *
 * @param {object} group - Field group configuration
 * @param {array} fields - Array of rendered field HTML or nested groups
 * @param {object} entity - The entity being rendered (for context)
 * @returns {string} HTML string
 *
 * WHY GROUPS IN FIELDS:
 * fields array can contain both field HTML and nested group objects.
 * Nested groups are rendered recursively with their own formatters.
 * This enables "tabs containing fieldsets" and other hierarchies.
 */
export function render(group, fields, entity = null) {
  const settings = group.format_settings || {};
  const orientation = settings.orientation || 'horizontal';
  const defaultTab = settings.default_tab || 0;

  // Build container attributes
  const containerClasses = [
    'field-group',
    'field-group-tabs',
    `field-group-tabs-${orientation}`,
    `field-group-${group.group_name}`,
    ...(settings.classes || [])
  ];

  const containerAttrs = {
    class: containerClasses.join(' '),
    id: `fieldgroup-${group.group_name}`,
    'data-orientation': orientation,
    ...(settings.attributes || {})
  };

  const containerAttrString = buildAttrString(containerAttrs);

  // Build HTML structure
  let html = `<div ${containerAttrString}>\n`;

  // Render tab list (navigation)
  html += renderTabList(group, fields, orientation, defaultTab);

  // Render tab panels (content)
  html += renderTabPanels(group, fields, defaultTab);

  html += `</div>\n`;

  // Add JavaScript for tab functionality
  html += generateTabScript(group.group_name, orientation);

  return html;
}

/**
 * Render tab navigation list
 *
 * WHY BUTTON ELEMENTS:
 * Buttons are semantically correct for interactive elements.
 * They're keyboard-accessible by default and work with screen readers.
 */
function renderTabList(group, fields, orientation, defaultTab) {
  const tablistClasses = orientation === 'vertical'
    ? 'field-group-tabs-list field-group-tabs-list-vertical'
    : 'field-group-tabs-list field-group-tabs-list-horizontal';

  let html = `  <ul class="${tablistClasses}" role="tablist" aria-orientation="${orientation}">\n`;

  // Generate tabs based on children
  // WHY USE CHILDREN:
  // group.children defines which fields/groups to show and their order
  const children = group.children || [];

  for (let i = 0; i < children.length; i++) {
    const childName = children[i];
    const isActive = i === defaultTab;

    // Find child in fields array to get label
    const field = fields.find(f => f.name === childName || f.group_name === childName);
    const label = field?.label || field?.group?.label || childName;

    const tabId = `tab-${group.group_name}-${i}`;
    const panelId = `tabpanel-${group.group_name}-${i}`;

    html += `    <li role="presentation">\n`;
    html += `      <button\n`;
    html += `        role="tab"\n`;
    html += `        id="${tabId}"\n`;
    html += `        aria-controls="${panelId}"\n`;
    html += `        aria-selected="${isActive}"\n`;
    html += `        tabindex="${isActive ? '0' : '-1'}"\n`;
    html += `        class="field-group-tab${isActive ? ' field-group-tab-active' : ''}"\n`;
    html += `        data-index="${i}"\n`;
    html += `      >\n`;
    html += `        ${escapeHtml(label)}\n`;
    html += `      </button>\n`;
    html += `    </li>\n`;
  }

  html += `  </ul>\n`;
  return html;
}

/**
 * Render tab panels (content areas)
 *
 * WHY HIDDEN PANELS:
 * Only the active panel is visible. Others are hidden with
 * 'hidden' attribute for accessibility (not just CSS).
 */
function renderTabPanels(group, fields, defaultTab) {
  let html = `  <div class="field-group-tabs-panels">\n`;

  const children = group.children || [];

  for (let i = 0; i < children.length; i++) {
    const childName = children[i];
    const isActive = i === defaultTab;

    const tabId = `tab-${group.group_name}-${i}`;
    const panelId = `tabpanel-${group.group_name}-${i}`;

    // Find field content
    const field = fields.find(f => f.name === childName || f.group_name === childName);
    const content = field?.html || field || '';

    html += `    <div\n`;
    html += `      role="tabpanel"\n`;
    html += `      id="${panelId}"\n`;
    html += `      aria-labelledby="${tabId}"\n`;
    html += `      class="field-group-tabpanel${isActive ? ' field-group-tabpanel-active' : ''}"\n`;
    html += `      ${!isActive ? 'hidden' : ''}\n`;
    html += `    >\n`;
    html += `      ${content}\n`;
    html += `    </div>\n`;
  }

  html += `  </div>\n`;
  return html;
}

/**
 * Generate JavaScript for tab switching and keyboard navigation
 *
 * WHY INLINE SCRIPT:
 * Tab functionality is essential for usability. Inline ensures
 * it works even if external JS fails to load. Progressive enhancement.
 *
 * KEYBOARD SUPPORT:
 * - Arrow keys: move between tabs
 * - Home: first tab
 * - End: last tab
 * - Enter/Space: activate tab (redundant but explicit)
 */
function generateTabScript(groupName, orientation) {
  const escapedName = groupName.replace(/'/g, "\\'");

  return `
<script>
(function() {
  const container = document.getElementById('fieldgroup-${escapedName}');
  if (!container) return;

  const tablist = container.querySelector('[role="tablist"]');
  const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
  const panels = Array.from(container.querySelectorAll('[role="tabpanel"]'));

  // Switch to a specific tab
  function switchTab(index) {
    tabs.forEach((tab, i) => {
      const isActive = i === index;
      tab.setAttribute('aria-selected', isActive);
      tab.setAttribute('tabindex', isActive ? '0' : '-1');
      tab.classList.toggle('field-group-tab-active', isActive);

      if (panels[i]) {
        panels[i].hidden = !isActive;
        panels[i].classList.toggle('field-group-tabpanel-active', isActive);
      }
    });

    tabs[index]?.focus();
  }

  // Click handler
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      switchTab(index);
    });
  });

  // Keyboard navigation
  tablist.addEventListener('keydown', (e) => {
    const currentIndex = tabs.findIndex(tab => tab === document.activeElement);
    if (currentIndex === -1) return;

    let newIndex = currentIndex;

    // Arrow keys
    const isVertical = '${orientation}' === 'vertical';
    const nextKey = isVertical ? 'ArrowDown' : 'ArrowRight';
    const prevKey = isVertical ? 'ArrowUp' : 'ArrowLeft';

    if (e.key === nextKey) {
      e.preventDefault();
      newIndex = (currentIndex + 1) % tabs.length;
    } else if (e.key === prevKey) {
      e.preventDefault();
      newIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (e.key === 'Home') {
      e.preventDefault();
      newIndex = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      newIndex = tabs.length - 1;
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      switchTab(currentIndex);
      return;
    } else {
      return; // Not a tab navigation key
    }

    switchTab(newIndex);
  });
})();
</script>
`;
}

/**
 * Build HTML attribute string from object
 */
function buildAttrString(attrs) {
  return Object.entries(attrs)
    .map(([key, value]) => {
      const escaped = String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `${key}="${escaped}"`;
    })
    .join(' ');
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Formatter metadata
 */
export const metadata = {
  id: 'tabs',
  label: 'Tabs',
  description: 'Display fields in tabbed panels with horizontal or vertical orientation',
  settings: {
    orientation: {
      type: 'select',
      label: 'Orientation',
      description: 'Tab layout orientation',
      options: [
        { value: 'horizontal', label: 'Horizontal' },
        { value: 'vertical', label: 'Vertical' }
      ],
      default: 'horizontal',
    },
    default_tab: {
      type: 'number',
      label: 'Default Tab',
      description: 'Index of the tab to show by default (0-based)',
      default: 0,
    },
    classes: {
      type: 'text',
      label: 'CSS Classes',
      description: 'Space-separated CSS classes to add to the container',
    },
  },
};
