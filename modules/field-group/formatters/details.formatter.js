/**
 * Details/Collapsible Formatter for Field Groups
 *
 * WHY THIS EXISTS:
 * Renders field groups using native HTML <details>/<summary> elements.
 * This provides browser-native collapsible sections with zero JavaScript.
 * Simpler and more accessible than custom accordion implementations.
 *
 * ADVANTAGES:
 * - Native browser behavior (works without JS)
 * - Built-in accessibility (screen readers understand details/summary)
 * - No custom JavaScript required
 * - Works even if CSS fails to load
 * - Respects user's reduced motion preferences automatically
 *
 * FEATURES:
 * - Open/closed default state via 'open' attribute
 * - Nested details support (details can contain other formatters)
 * - Custom CSS classes for styling hooks
 * - Optional description text after summary
 * - Custom attributes support
 */

/**
 * Render details/summary group
 *
 * @param {object} group - Field group configuration
 * @param {array} fields - Array of rendered field HTML or nested groups
 * @param {object} entity - The entity being rendered (for context)
 * @returns {string} HTML string
 *
 * WHY NATIVE ELEMENTS:
 * <details> and <summary> are semantic HTML5 elements designed for
 * disclosure widgets. Browser handles all expand/collapse behavior,
 * keyboard navigation, and accessibility automatically.
 *
 * STRUCTURE:
 * <details [open]>
 *   <summary>Label</summary>
 *   [optional description]
 *   <div class="fields">
 *     ...field content...
 *   </div>
 * </details>
 */
export function render(group, fields, entity = null) {
  const settings = group.format_settings || {};
  const isOpen = settings.open !== undefined ? settings.open : false;

  // Build details element attributes
  const detailsClasses = [
    'field-group',
    'field-group-details',
    `field-group-${group.group_name}`,
    ...(settings.classes || [])
  ];

  const detailsAttrs = {
    class: detailsClasses.join(' '),
    id: `fieldgroup-${group.group_name}`,
    ...(settings.attributes || {})
  };

  // Add 'open' attribute if configured
  // WHY CONDITIONAL:
  // The 'open' attribute is a boolean HTML attribute.
  // Its presence (not value) determines if details is expanded.
  // Omit it entirely when closed, rather than setting to false.
  const openAttr = isOpen ? ' open' : '';

  const detailsAttrString = buildAttrString(detailsAttrs);

  // Build HTML structure
  let html = `<details ${detailsAttrString}${openAttr}>\n`;

  // Render summary (header)
  const summaryClasses = [
    'field-group-summary',
    ...(settings.summary_classes || [])
  ].join(' ');

  html += `  <summary class="${summaryClasses}">${escapeHtml(group.label)}</summary>\n`;

  // Add optional description
  // WHY DESCRIPTION:
  // Helps users understand the purpose of the group.
  // Displayed after summary but before fields, inside the details element.
  if (settings.description) {
    html += `  <div class="field-group-description">${escapeHtml(settings.description)}</div>\n`;
  }

  // Add field wrapper
  html += `  <div class="field-group-fields">\n`;

  // Add fields in order specified by group.children
  // WHY REORDER:
  // Fields need to appear in the order defined in the group config,
  // not in their default entity order. Same pattern as fieldset formatter.
  const orderedFields = reorderFields(fields, group.children);
  for (const field of orderedFields) {
    html += `    ${field}\n`;
  }

  html += `  </div>\n`;
  html += `</details>\n`;

  // Add optional CSS for enhanced styling
  // WHY OPTIONAL STYLES:
  // Native <details> works fine without CSS, but custom styles
  // improve visual consistency with other formatters.
  if (settings.enhanced_styles !== false) {
    html += generateDetailsStyles();
  }

  return html;
}

/**
 * Reorder fields based on group.children array
 *
 * @param {array} fields - Array of {name, html} objects
 * @param {array} childOrder - Array of field names in desired order
 * @returns {array} Array of HTML strings in correct order
 *
 * WHY SEPARATE FUNCTION:
 * Field ordering logic is shared across formatters.
 * This is identical to the fieldset formatter's implementation.
 *
 * ALGORITHM:
 * 1. Build map of field name → HTML
 * 2. Iterate childOrder array
 * 3. Return HTML in that order
 * 4. Append any fields not in childOrder at end (orphans)
 */
function reorderFields(fields, childOrder) {
  if (!childOrder || childOrder.length === 0) {
    // No order specified - return fields as-is
    return fields.map(f => f.html || f);
  }

  // Build lookup map
  const fieldMap = new Map();
  for (const field of fields) {
    const name = field.name || field.fieldName;
    const html = field.html || field;
    fieldMap.set(name, html);
  }

  // Build ordered array
  const ordered = [];
  for (const childName of childOrder) {
    if (fieldMap.has(childName)) {
      ordered.push(fieldMap.get(childName));
      fieldMap.delete(childName); // Remove to track orphans
    }
  }

  // Append orphans (fields not in childOrder)
  for (const html of fieldMap.values()) {
    ordered.push(html);
  }

  return ordered;
}

/**
 * Generate optional CSS for enhanced details styling
 *
 * WHY SEPARATE FUNCTION:
 * Keeps render() function cleaner and allows easy disabling
 * via enhanced_styles setting.
 *
 * STYLING APPROACH:
 * - Minimal, non-intrusive styles that enhance default browser appearance
 * - Respects browser's native disclosure triangle
 * - Adds padding and borders for visual grouping
 * - Smooth animation for content reveal (if browser supports)
 */
function generateDetailsStyles() {
  return `
<style>
.field-group-details {
  border: 1px solid #ddd;
  border-radius: 4px;
  margin-bottom: 1rem;
  overflow: hidden;
}

.field-group-summary {
  padding: 0.75rem 1rem;
  background: #f5f5f5;
  cursor: pointer;
  font-weight: 500;
  user-select: none;
  transition: background-color 0.2s ease;
}

.field-group-summary:hover {
  background: #e8e8e8;
}

.field-group-summary:focus {
  outline: 2px solid #0066cc;
  outline-offset: -2px;
}

/* Style for the disclosure triangle */
.field-group-summary::marker {
  color: #666;
}

.field-group-description {
  padding: 0.5rem 1rem;
  background: #f9f9f9;
  border-bottom: 1px solid #eee;
  font-size: 0.9rem;
  color: #666;
}

.field-group-fields {
  padding: 1rem;
}

/* Smooth animation for opening (browser support varies) */
@media (prefers-reduced-motion: no-preference) {
  details .field-group-fields {
    animation: slideDown 0.3s ease-out;
  }
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
`;
}

/**
 * Build HTML attribute string from object
 *
 * WHY ESCAPE:
 * Prevent XSS attacks via malicious attribute values.
 * Same implementation as other formatters for consistency.
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
 * Prevent XSS attacks via user-controlled content (labels, descriptions).
 * Always escape user input before inserting into HTML.
 *
 * WHY NOT USE LIBRARY:
 * Zero-dependency philosophy. This is a simple, well-understood operation.
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
  id: 'details',
  label: 'Details (Collapsible)',
  description: 'Native HTML collapsible section using <details> and <summary> elements',
  settings: {
    open: {
      type: 'boolean',
      label: 'Open by Default',
      description: 'Show the details section expanded by default',
      default: false,
    },
    description: {
      type: 'textarea',
      label: 'Description',
      description: 'Help text displayed below the summary when expanded',
    },
    classes: {
      type: 'text',
      label: 'CSS Classes',
      description: 'Space-separated CSS classes to add to the details element',
    },
    summary_classes: {
      type: 'text',
      label: 'Summary CSS Classes',
      description: 'Space-separated CSS classes to add to the summary element',
    },
    enhanced_styles: {
      type: 'boolean',
      label: 'Enhanced Styles',
      description: 'Include enhanced CSS styling (disable for completely native appearance)',
      default: true,
    },
  },
};
