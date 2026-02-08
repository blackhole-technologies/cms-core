/**
 * Fieldset Formatter for Field Groups
 *
 * WHY THIS EXISTS:
 * Renders field groups as HTML <fieldset> elements with <legend> titles.
 * This is the most basic and semantic HTML grouping formatter.
 *
 * USAGE:
 * Groups with format_type='fieldset' use this formatter to wrap
 * their fields in a fieldset boundary with a legend label.
 *
 * FEATURES:
 * - Semantic HTML (fieldset/legend)
 * - Optional description below legend
 * - Custom CSS classes
 * - Custom HTML attributes
 * - Collapsible functionality (via JS)
 * - Nested fieldsets (recursive rendering)
 */

/**
 * Render a fieldset group
 *
 * @param {object} group - Field group configuration
 * @param {array} fields - Array of rendered field HTML strings
 * @param {object} entity - The entity being rendered (for context)
 * @returns {string} HTML string
 *
 * WHY PARAMS:
 * - group: Contains label, settings, children order
 * - fields: Pre-rendered field HTML (this formatter just wraps them)
 * - entity: Allows conditional rendering based on entity data
 *
 * WHY RETURN STRING:
 * Server-side rendering needs HTML strings for templates.
 * Alternative (React-style) would be JSX/components, but that
 * requires a build step. Plain strings work everywhere.
 */
export function render(group, fields, entity = null) {
  const settings = group.format_settings || {};

  // Build fieldset attributes
  const classes = [
    'field-group',
    'field-group-fieldset',
    `field-group-${group.group_name}`,
    ...(settings.classes || [])
  ];

  const attributes = {
    class: classes.join(' '),
    id: `fieldgroup-${group.group_name}`,
    ...(settings.attributes || {})
  };

  // WHY COLLAPSIBLE SUPPORT:
  // Long forms benefit from collapsible sections.
  // The 'details' formatter is preferred for native collapsing,
  // but fieldset can also be made collapsible via JS.
  if (settings.collapsible) {
    attributes['data-collapsible'] = 'true';
    if (settings.collapsed) {
      attributes['data-collapsed'] = 'true';
    }
  }

  // Build attribute string
  const attrString = Object.entries(attributes)
    .map(([key, value]) => {
      // WHY ESCAPE:
      // Prevent XSS attacks via malicious attribute values
      const escaped = String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `${key}="${escaped}"`;
    })
    .join(' ');

  // Build fieldset HTML
  let html = `<fieldset ${attrString}>\n`;

  // Add legend
  html += `  <legend>${escapeHtml(group.label)}</legend>\n`;

  // Add optional description
  // WHY DESCRIPTION:
  // Helps users understand the purpose of the group.
  // Displayed below legend but above fields.
  if (settings.description) {
    html += `  <div class="field-group-description">${escapeHtml(settings.description)}</div>\n`;
  }

  // Add field wrapper
  html += `  <div class="field-group-fields">\n`;

  // Add fields in order specified by group.children
  // WHY REORDER:
  // Fields need to appear in the order defined in the group config,
  // not in their default entity order.
  const orderedFields = reorderFields(fields, group.children);
  for (const field of orderedFields) {
    html += `    ${field}\n`;
  }

  html += `  </div>\n`;
  html += `</fieldset>\n`;

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
 * Could be extracted to a shared utility if more formatters need it.
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
  id: 'fieldset',
  label: 'Fieldset',
  description: 'Wrap fields in an HTML fieldset element with a legend',
  settings: {
    description: {
      type: 'textarea',
      label: 'Description',
      description: 'Help text displayed below the legend',
    },
    classes: {
      type: 'text',
      label: 'CSS Classes',
      description: 'Space-separated CSS classes to add to the fieldset',
    },
    collapsible: {
      type: 'boolean',
      label: 'Collapsible',
      description: 'Allow users to collapse/expand this fieldset',
      default: false,
    },
    collapsed: {
      type: 'boolean',
      label: 'Collapsed by default',
      description: 'Start with fieldset collapsed (requires collapsible=true)',
      default: false,
    },
  },
};
