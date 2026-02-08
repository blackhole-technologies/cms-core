/**
 * Accordion Formatter for Field Groups
 *
 * WHY THIS EXISTS:
 * Renders field groups as collapsible accordion sections where expanding
 * one section can optionally collapse others (single mode).
 * Common pattern for FAQs, long forms, and progressive disclosure.
 *
 * ACCESSIBILITY:
 * Implements ARIA accordion pattern:
 * - <button aria-expanded> for headers with expand/collapse state
 * - <div> panels with unique IDs for aria-controls relationships
 * - Keyboard navigation: Space/Enter to toggle, Up/Down to navigate
 *
 * FEATURES:
 * - Single mode: only one section open at a time (like traditional accordion)
 * - Multiple mode: sections expand/collapse independently
 * - Smooth CSS animations for expand/collapse
 * - Default open sections configuration
 * - Nested groups (accordions can contain other formatters)
 * - Custom CSS classes and attributes
 */

/**
 * Render accordion group
 *
 * @param {object} group - Field group configuration
 * @param {array} fields - Array of rendered field HTML or nested groups
 * @param {object} entity - The entity being rendered (for context)
 * @returns {string} HTML string
 *
 * WHY PARAMS:
 * - group: Contains label, settings, children array
 * - fields: Pre-rendered field HTML for each accordion section
 * - entity: Allows conditional rendering based on entity data
 *
 * ALGORITHM:
 * 1. Build container with accordion wrapper classes
 * 2. For each child in group.children:
 *    - Render accordion section (header button + content panel)
 *    - Set aria-expanded based on default_open setting
 * 3. Add JavaScript for expand/collapse behavior
 */
export function render(group, fields, entity = null) {
  const settings = group.format_settings || {};
  const collapseMode = settings.collapse_mode || 'single'; // 'single' or 'multiple'
  const defaultOpen = settings.default_open || []; // Array of indices to show open

  // Build container attributes
  const containerClasses = [
    'field-group',
    'field-group-accordion',
    `field-group-accordion-${collapseMode}`,
    `field-group-${group.group_name}`,
    ...(settings.classes || [])
  ];

  const containerAttrs = {
    class: containerClasses.join(' '),
    id: `fieldgroup-${group.group_name}`,
    'data-collapse-mode': collapseMode,
    ...(settings.attributes || {})
  };

  const containerAttrString = buildAttrString(containerAttrs);

  // Build HTML structure
  let html = `<div ${containerAttrString}>\n`;

  // Render accordion sections
  const children = group.children || [];

  for (let i = 0; i < children.length; i++) {
    const childName = children[i];
    const isOpen = defaultOpen.includes(i);

    // Find child in fields array to get content and label
    const field = fields.find(f => f.name === childName || f.group_name === childName);
    const label = field?.label || field?.group?.label || childName;
    const content = field?.html || field || '';

    const sectionId = `accordion-${group.group_name}-section-${i}`;
    const headerId = `accordion-${group.group_name}-header-${i}`;
    const panelId = `accordion-${group.group_name}-panel-${i}`;

    html += `  <div class="field-group-accordion-section" id="${sectionId}" data-index="${i}">\n`;

    // Accordion header (button)
    html += `    <button\n`;
    html += `      type="button"\n`;
    html += `      id="${headerId}"\n`;
    html += `      class="field-group-accordion-header${isOpen ? ' field-group-accordion-header-open' : ''}"\n`;
    html += `      aria-expanded="${isOpen}"\n`;
    html += `      aria-controls="${panelId}"\n`;
    html += `    >\n`;
    html += `      <span class="field-group-accordion-label">${escapeHtml(label)}</span>\n`;
    html += `      <span class="field-group-accordion-icon" aria-hidden="true">${isOpen ? '−' : '+'}</span>\n`;
    html += `    </button>\n`;

    // Accordion panel (content)
    // WHY MAX-HEIGHT:
    // CSS transition requires animatable property. max-height with large value
    // allows smooth animation regardless of content size. Alternative is grid-rows
    // but that requires more complex CSS.
    html += `    <div\n`;
    html += `      id="${panelId}"\n`;
    html += `      class="field-group-accordion-panel${isOpen ? ' field-group-accordion-panel-open' : ''}"\n`;
    html += `      aria-labelledby="${headerId}"\n`;
    html += `      ${!isOpen ? 'hidden' : ''}\n`;
    html += `      style="max-height: ${isOpen ? '10000px' : '0'}"\n`;
    html += `    >\n`;
    html += `      <div class="field-group-accordion-content">\n`;
    html += `        ${content}\n`;
    html += `      </div>\n`;
    html += `    </div>\n`;

    html += `  </div>\n`;
  }

  html += `</div>\n`;

  // Add CSS for animations
  // WHY INLINE STYLES:
  // Ensures accordion works even if external CSS fails to load.
  // Progressive enhancement approach.
  html += generateAccordionStyles();

  // Add JavaScript for accordion behavior
  html += generateAccordionScript(group.group_name, collapseMode);

  return html;
}

/**
 * Generate CSS for accordion animations
 *
 * WHY SEPARATE FUNCTION:
 * Styles are complex enough to warrant isolation.
 * Could be extracted to external stylesheet in production.
 *
 * ANIMATION STRATEGY:
 * - max-height transition for smooth expand/collapse
 * - transform for icon rotation
 * - opacity for fade effect
 */
function generateAccordionStyles() {
  return `
<style>
.field-group-accordion {
  border: 1px solid #ddd;
  border-radius: 4px;
  overflow: hidden;
}

.field-group-accordion-section {
  border-bottom: 1px solid #ddd;
}

.field-group-accordion-section:last-child {
  border-bottom: none;
}

.field-group-accordion-header {
  width: 100%;
  padding: 1rem;
  background: #f5f5f5;
  border: none;
  text-align: left;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 1rem;
  font-weight: 500;
  transition: background-color 0.2s ease;
}

.field-group-accordion-header:hover {
  background: #e8e8e8;
}

.field-group-accordion-header:focus {
  outline: 2px solid #0066cc;
  outline-offset: -2px;
}

.field-group-accordion-header-open {
  background: #e8e8e8;
}

.field-group-accordion-icon {
  font-size: 1.25rem;
  font-weight: bold;
  color: #666;
  transition: transform 0.3s ease;
}

.field-group-accordion-header-open .field-group-accordion-icon {
  transform: rotate(90deg);
}

.field-group-accordion-panel {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.3s ease-in-out, opacity 0.3s ease-in-out;
  opacity: 0;
}

.field-group-accordion-panel-open {
  max-height: 10000px;
  opacity: 1;
}

.field-group-accordion-content {
  padding: 1rem;
}
</style>
`;
}

/**
 * Generate JavaScript for accordion expand/collapse behavior
 *
 * WHY INLINE SCRIPT:
 * Accordion functionality is essential for usability. Inline ensures
 * it works even if external JS fails to load. Progressive enhancement.
 *
 * KEYBOARD SUPPORT:
 * - Space/Enter: Toggle current section
 * - ArrowDown: Move focus to next header
 * - ArrowUp: Move focus to previous header
 * - Home: Focus first header
 * - End: Focus last header
 *
 * COLLAPSE MODES:
 * - single: Opening one section closes all others (traditional accordion)
 * - multiple: Sections expand/collapse independently
 */
function generateAccordionScript(groupName, collapseMode) {
  const escapedName = groupName.replace(/'/g, "\\'");

  return `
<script>
(function() {
  const container = document.getElementById('fieldgroup-${escapedName}');
  if (!container) return;

  const headers = Array.from(container.querySelectorAll('.field-group-accordion-header'));
  const panels = Array.from(container.querySelectorAll('.field-group-accordion-panel'));
  const mode = '${collapseMode}';

  // Toggle a specific section
  function toggleSection(index, forceOpen = null) {
    const header = headers[index];
    const panel = panels[index];
    const icon = header.querySelector('.field-group-accordion-icon');

    if (!header || !panel) return;

    const isCurrentlyOpen = header.getAttribute('aria-expanded') === 'true';
    const shouldOpen = forceOpen !== null ? forceOpen : !isCurrentlyOpen;

    // In single mode, close all other sections first
    if (mode === 'single' && shouldOpen) {
      headers.forEach((h, i) => {
        if (i !== index) {
          h.setAttribute('aria-expanded', 'false');
          h.classList.remove('field-group-accordion-header-open');
          panels[i].classList.remove('field-group-accordion-panel-open');
          panels[i].hidden = true;
          panels[i].style.maxHeight = '0';
          const otherIcon = h.querySelector('.field-group-accordion-icon');
          if (otherIcon) otherIcon.textContent = '+';
        }
      });
    }

    // Toggle current section
    header.setAttribute('aria-expanded', shouldOpen);
    header.classList.toggle('field-group-accordion-header-open', shouldOpen);
    panel.classList.toggle('field-group-accordion-panel-open', shouldOpen);
    panel.hidden = !shouldOpen;
    panel.style.maxHeight = shouldOpen ? '10000px' : '0';

    if (icon) {
      icon.textContent = shouldOpen ? '−' : '+';
    }
  }

  // Click handlers
  headers.forEach((header, index) => {
    header.addEventListener('click', (e) => {
      e.preventDefault();
      toggleSection(index);
    });
  });

  // Keyboard navigation
  container.addEventListener('keydown', (e) => {
    const currentIndex = headers.findIndex(h => h === document.activeElement);
    if (currentIndex === -1) return;

    let newIndex = currentIndex;
    let handled = false;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      newIndex = (currentIndex + 1) % headers.length;
      handled = true;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      newIndex = (currentIndex - 1 + headers.length) % headers.length;
      handled = true;
    } else if (e.key === 'Home') {
      e.preventDefault();
      newIndex = 0;
      handled = true;
    } else if (e.key === 'End') {
      e.preventDefault();
      newIndex = headers.length - 1;
      handled = true;
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleSection(currentIndex);
      return;
    }

    if (handled && headers[newIndex]) {
      headers[newIndex].focus();
    }
  });
})();
</script>
`;
}

/**
 * Build HTML attribute string from object
 *
 * WHY ESCAPE:
 * Prevent XSS attacks via malicious attribute values
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
 *
 * WHY THIS EXISTS:
 * Prevent XSS attacks via user-controlled content (labels).
 * Always escape user input before inserting into HTML.
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
 *
 * WHY EXPORT METADATA:
 * Formatters can be discovered and listed in UI.
 * Metadata describes what the formatter does and what settings it supports.
 */
export const metadata = {
  id: 'accordion',
  label: 'Accordion',
  description: 'Display fields in collapsible accordion sections',
  settings: {
    collapse_mode: {
      type: 'select',
      label: 'Collapse Mode',
      description: 'How sections behave when expanded',
      options: [
        { value: 'single', label: 'Single - only one section open at a time' },
        { value: 'multiple', label: 'Multiple - sections expand independently' }
      ],
      default: 'single',
    },
    default_open: {
      type: 'array',
      label: 'Default Open Sections',
      description: 'Array of section indices to show open by default (0-based). Example: [0, 2]',
      default: [],
    },
    classes: {
      type: 'text',
      label: 'CSS Classes',
      description: 'Space-separated CSS classes to add to the accordion container',
    },
  },
};
