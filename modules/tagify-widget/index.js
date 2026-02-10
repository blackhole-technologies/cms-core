/**
 * Tagify Widget Module
 *
 * WHY THIS EXISTS:
 * Entity reference fields (taxonomy terms, content references) need a better UX
 * than plain text inputs. This module provides a Tagify-based tag input widget
 * that displays selections as removable chips with autocomplete suggestions.
 *
 * FEATURES:
 * - Visual chip/badge display for selected items
 * - Autocomplete suggestions as user types
 * - Create tags on-the-fly (for new taxonomy terms)
 * - Drag-and-drop reordering of tags
 * - Validation rules (max/min tags, cardinality)
 * - Custom tag templates
 *
 * ARCHITECTURE:
 * - Registers custom widget renderers for 'reference' and 'references' field types
 * - Provides API endpoint for autocomplete suggestions
 * - Client-side JavaScript initializes Tagify on designated inputs
 * - Integrates with existing field system via registerFieldType()
 *
 * USAGE:
 * In a content type schema, specify widget: 'tagify':
 * {
 *   tags: {
 *     type: 'references',
 *     target: 'taxonomy_term',
 *     vocabulary: 'tags',
 *     widget: 'tagify',
 *     widgetSettings: {
 *       maxTags: 10,
 *       draggable: true,
 *       createOnEnter: true
 *     }
 *   }
 * }
 */

import { registerFieldType, getFieldType } from '../../core/fields.js';

// Module state
let initialized = false;
let services = null;

/**
 * Boot hook — registers the Tagify widget with the field system
 */
export async function hook_boot(context) {
  services = context.services;

  // Register Tagify as a custom widget for reference fields
  const existingReferenceType = getFieldType('reference');
  const existingReferencesType = getFieldType('references');

  if (existingReferenceType) {
    registerFieldType('reference', {
      ...existingReferenceType,
      render: renderTagifyWidget
    });
  }

  if (existingReferencesType) {
    registerFieldType('references', {
      ...existingReferencesType,
      render: renderTagifyWidget
    });
  }

  console.log('[tagify-widget] Registered Tagify widget for reference fields');
}

/**
 * Ready hook — registers API routes for autocomplete
 */
export async function hook_ready(context) {
  const router = context.services?.get('router');

  if (router && typeof router.get === 'function') {
    // Autocomplete endpoint
    router.get('/api/tagify/autocomplete', handleAutocomplete);
    console.log('[tagify-widget] Registered autocomplete API route');
  }

  initialized = true;
}

/**
 * Routes hook — provides API endpoints for Tagify
 */
export function hook_routes() {
  return [
    {
      method: 'GET',
      path: '/api/tagify/autocomplete',
      handler: handleAutocomplete
    }
  ];
}

/**
 * Content hook — provides HTML pages for testing
 */
export function hook_content(req) {
  const { pathname } = new URL(req.url, 'http://localhost');

  if (pathname === '/tagify/demo') {
    return {
      content: renderDemoPage(),
      contentType: 'text/html'
    };
  }

  return null;
}

/**
 * Render Tagify widget for reference fields
 *
 * @param {Object} field - Field definition
 * @param {*} value - Current value (ID or array of IDs)
 * @param {Object} options - Render options
 * @returns {string} HTML string
 */
function renderTagifyWidget(field, value, options = {}) {
  const { name, id, target, vocabulary, widget, widgetSettings = {} } = field;

  // Only apply Tagify if explicitly requested
  if (widget !== 'tagify') {
    // Fall back to default rendering
    return renderDefaultReference(field, value, options);
  }

  const isMultiple = field.type === 'references' || field.multiple;
  const fieldId = id || `field-${name}`;
  const fieldName = name;

  // Parse value to array
  let values = [];
  if (value !== null && value !== undefined && value !== '') {
    if (Array.isArray(value)) {
      values = value;
    } else {
      values = [value];
    }
  }

  // Convert IDs to tag objects (for now, just use ID as label)
  // In production, would fetch entity labels from database
  const tags = values.map(v => ({
    value: String(v),
    label: String(v) // TODO: Fetch actual entity label
  }));

  // Tagify settings
  const settings = {
    maxTags: widgetSettings.maxTags || (isMultiple ? 100 : 1),
    draggable: widgetSettings.draggable !== false,
    createOnEnter: widgetSettings.createOnEnter !== false,
    dropdown: {
      enabled: 1,
      maxItems: 10,
      closeOnSelect: true
    },
    ...widgetSettings
  };

  // Data attributes for client-side initialization
  const dataAttrs = [
    `data-tagify="true"`,
    `data-target="${escapeHtml(target || 'content')}"`,
    `data-vocabulary="${escapeHtml(vocabulary || '')}"`,
    `data-settings='${JSON.stringify(settings)}'`
  ].join(' ');

  // Hidden input for form submission
  const hiddenValue = JSON.stringify(values);

  return `
    <div class="tagify-widget" data-field-name="${escapeHtml(fieldName)}">
      <input
        type="text"
        id="${escapeHtml(fieldId)}"
        name="${escapeHtml(fieldName)}_tagify"
        class="tagify-input"
        ${dataAttrs}
        value='${escapeHtml(JSON.stringify(tags))}'
        placeholder="Type to search or add tags..."
      />
      <input
        type="hidden"
        name="${escapeHtml(fieldName)}"
        id="${escapeHtml(fieldId)}_value"
        value='${escapeHtml(hiddenValue)}'
      />
    </div>
  `;
}

/**
 * Fallback to default reference rendering
 */
function renderDefaultReference(field, value, options = {}) {
  const { name, id } = field;
  const fieldId = id || `field-${name}`;

  return `
    <input
      type="text"
      id="${escapeHtml(fieldId)}"
      name="${escapeHtml(name)}"
      value="${escapeHtml(value || '')}"
    />
  `;
}

/**
 * Autocomplete API handler
 * Returns matching entities based on search query
 */
async function handleAutocomplete(req, res) {
  const { query, target, vocabulary, limit = 10 } = req.query;

  if (!query || query.length < 1) {
    return res.json([]);
  }

  try {
    const results = await searchEntities(query, target, vocabulary, limit);
    res.json(results);
  } catch (error) {
    console.error('[tagify-widget] Autocomplete error:', error);
    res.status(500).json({ error: 'Autocomplete failed' });
  }
}

/**
 * Search for entities matching query
 *
 * @param {string} query - Search term
 * @param {string} target - Entity type (e.g., 'taxonomy_term', 'node')
 * @param {string} vocabulary - Vocabulary name (for taxonomy terms)
 * @param {number} limit - Maximum results
 * @returns {Promise<Array>} Array of {value, label} objects
 */
async function searchEntities(query, target, vocabulary, limit) {
  // TODO: Implement actual entity search
  // For now, return mock data for demonstration

  const mockData = [
    { value: '1', label: 'JavaScript' },
    { value: '2', label: 'TypeScript' },
    { value: '3', label: 'Node.js' },
    { value: '4', label: 'React' },
    { value: '5', label: 'Vue.js' },
    { value: '6', label: 'Angular' },
    { value: '7', label: 'Python' },
    { value: '8', label: 'Django' },
    { value: '9', label: 'Flask' },
    { value: '10', label: 'Ruby' }
  ];

  const queryLower = query.toLowerCase();
  const filtered = mockData.filter(item =>
    item.label.toLowerCase().includes(queryLower)
  );

  return filtered.slice(0, limit);
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Render demo/test page
 */
function renderDemoPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tagify Widget Demo - CMS-Core</title>
  <link rel="stylesheet" href="/modules/tagify-widget/assets/tagify.min.css">
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      max-width: 800px;
      margin: 40px auto;
      padding: 20px;
      background: #f9fafb;
    }
    h1 {
      color: #1f2937;
      margin-bottom: 30px;
    }
    .demo-section {
      background: white;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 30px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .demo-section h2 {
      color: #374151;
      font-size: 1.2em;
      margin-bottom: 15px;
    }
    .form-group {
      margin-bottom: 20px;
    }
    label {
      display: block;
      margin-bottom: 8px;
      font-weight: 500;
      color: #374151;
    }
    button {
      background: #3b82f6;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 1em;
    }
    button:hover {
      background: #2563eb;
    }
    .output {
      margin-top: 20px;
      padding: 15px;
      background: #f3f4f6;
      border-radius: 6px;
      font-family: monospace;
      font-size: 0.9em;
      white-space: pre-wrap;
    }
  </style>
</head>
<body>
  <h1>🏷️ Tagify Widget Demo</h1>

  <div class="demo-section">
    <h2>Feature #1: Basic Tag Input</h2>
    <form id="demo-form-1">
      <div class="form-group">
        <label>Programming Languages (Multiple Tags)</label>
        <div class="tagify-widget" data-field-name="languages">
          <input
            type="text"
            id="field-languages"
            name="languages_tagify"
            class="tagify-input"
            data-tagify="true"
            data-target="content"
            data-vocabulary=""
            data-settings='{"maxTags":100,"draggable":true,"createOnEnter":true}'
            value='[]'
            placeholder="Type to search or add tags..."
          />
          <input
            type="hidden"
            name="languages"
            id="field-languages_value"
            value='[]'
          />
        </div>
      </div>
      <button type="submit">Submit Form</button>
    </form>
    <div class="output" id="output-1"></div>
  </div>

  <div class="demo-section">
    <h2>Feature #4: Drag-and-Drop Reordering</h2>
    <p style="color: #6b7280; margin-bottom: 15px;">
      Add some tags, then drag and drop them to reorder. The order is preserved in the form data.
    </p>
    <form id="demo-form-2">
      <div class="form-group">
        <label>Priorities (Draggable Tags)</label>
        <div class="tagify-widget" data-field-name="priorities">
          <input
            type="text"
            id="field-priorities"
            name="priorities_tagify"
            class="tagify-input"
            data-tagify="true"
            data-target="content"
            data-vocabulary=""
            data-settings='{"maxTags":10,"draggable":true,"createOnEnter":true}'
            value='[{"value":"1","label":"Security"},{"value":"2","label":"Performance"},{"value":"3","label":"UX"}]'
            placeholder="Type to search or add tags..."
          />
          <input
            type="hidden"
            name="priorities"
            id="field-priorities_value"
            value='["1","2","3"]'
          />
        </div>
      </div>
      <button type="submit">Submit Form</button>
    </form>
    <div class="output" id="output-2"></div>
  </div>

  <div class="demo-section">
    <h2>Feature #5: Validation Rules</h2>
    <p style="color: #6b7280; margin-bottom: 15px;">
      Try to add more than 3 tags - you'll see a validation error.
    </p>
    <form id="demo-form-3">
      <div class="form-group">
        <label>Top 3 Skills (Max 3 Tags)</label>
        <div class="tagify-widget" data-field-name="skills">
          <input
            type="text"
            id="field-skills"
            name="skills_tagify"
            class="tagify-input"
            data-tagify="true"
            data-target="content"
            data-vocabulary=""
            data-settings='{"maxTags":3,"draggable":true,"createOnEnter":true,"duplicates":false}'
            value='[]'
            placeholder="Type to search or add tags..."
          />
          <input
            type="hidden"
            name="skills"
            id="field-skills_value"
            value='[]'
          />
        </div>
        <small style="color: #6b7280;">Maximum 3 tags allowed</small>
      </div>
      <button type="submit">Submit Form</button>
    </form>
    <div class="output" id="output-3"></div>
  </div>

  <script src="/modules/tagify-widget/assets/tagify.min.js"></script>
  <script>
    // Handle form submissions
    document.getElementById('demo-form-1').addEventListener('submit', (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const data = {
        languages: JSON.parse(formData.get('languages'))
      };
      document.getElementById('output-1').textContent = 'Form Data:\\n' + JSON.stringify(data, null, 2);
    });

    document.getElementById('demo-form-2').addEventListener('submit', (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const data = {
        priorities: JSON.parse(formData.get('priorities'))
      };
      document.getElementById('output-2').textContent = 'Form Data (ordered):\\n' + JSON.stringify(data, null, 2);
    });

    document.getElementById('demo-form-3').addEventListener('submit', (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const data = {
        skills: JSON.parse(formData.get('skills'))
      };
      document.getElementById('output-3').textContent = 'Form Data:\\n' + JSON.stringify(data, null, 2);
    });

    // Listen for validation events
    document.querySelectorAll('.tagify').forEach(tagify => {
      tagify.addEventListener('maxTagsExceeded', (e) => {
        alert('⚠️ Maximum tags limit reached (' + e.detail.maxTags + ' tags)');
      });

      tagify.addEventListener('duplicate', (e) => {
        alert('⚠️ Duplicate tag: "' + (e.detail.label || e.detail.value) + '" already exists');
      });
    });
  </script>
</body>
</html>`;
}

export const name = 'tagify-widget';
