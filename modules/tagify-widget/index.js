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

import { registerFieldType, getFieldType } from '../../core/fields.ts';

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
 * Ready hook — registers API routes for autocomplete and tag creation
 */
export async function hook_ready(context) {
  const router = context.services?.get('router');

  if (router && typeof router.get === 'function') {
    // Autocomplete endpoint
    router.get('/api/tagify/autocomplete', handleAutocomplete);
    console.log('[tagify-widget] Registered autocomplete API route');

    // Create tag endpoint
    if (typeof router.post === 'function') {
      router.post('/api/tagify/create-tag', handleCreateTag);
      console.log('[tagify-widget] Registered create-tag API route');
    }
  }

  initialized = true;
}

/**
 * Routes hook — provides API endpoints and demo page for Tagify
 */
export async function hook_routes(register, context) {
  const server = context.services?.get('server');
  const { readFile } = await import('fs/promises');
  const { join, dirname } = await import('path');
  const { fileURLToPath } = await import('url');

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const assetsPath = join(__dirname, 'assets');

  // Serve static CSS
  register('GET', '/modules/tagify-widget/assets/tagify.min.css', async (req, res) => {
    try {
      const content = await readFile(join(assetsPath, 'tagify.min.css'), 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/css' });
      res.end(content);
    } catch (err) {
      res.writeHead(404);
      res.end('Not Found');
    }
  }, 'Tagify CSS');

  // Serve static JS
  register('GET', '/modules/tagify-widget/assets/tagify.min.js', async (req, res) => {
    try {
      const content = await readFile(join(assetsPath, 'tagify.min.js'), 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(content);
    } catch (err) {
      res.writeHead(404);
      res.end('Not Found');
    }
  }, 'Tagify JS');

  // API endpoint for autocomplete
  register('GET', '/api/tagify/autocomplete', async (req, res) => {
    await handleAutocomplete(req, res);
  }, 'Tagify autocomplete API');

  // API endpoint for creating tags
  register('POST', '/api/tagify/create-tag', async (req, res) => {
    await handleCreateTag(req, res);
  }, 'Create new tag');

  // Demo/test page
  register('GET', '/tagify/demo', async (req, res) => {
    if (server && typeof server.html === 'function') {
      server.html(res, renderDemoPage());
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(renderDemoPage());
    }
  }, 'Tagify widget demo page');
}

/**
 * Render Tagify widget for reference fields
 *
 * @param {Object} field - Field definition
 * @param {*} value - Current value (ID or array of IDs)
 * @param {Object} options - Render options
 * @returns {Promise<string>} HTML string
 */
async function renderTagifyWidget(field, value, options = {}) {
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

  // Convert IDs to tag objects with entity data
  const tags = await loadTagData(values, target, vocabulary, widgetSettings);

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
    // Custom template support (Feature #6)
    tagTemplate: widgetSettings.tagTemplate || null,
    tagColorField: widgetSettings.tagColorField || null,
    tagIconField: widgetSettings.tagIconField || null,
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
  try {
    // Get server helper for JSON responses
    const server = services?.get('server');

    // Parse URL query parameters
    const url = new URL(req.url, 'http://localhost');
    const params = url.searchParams;

    const query = params.get('query') || params.get('q') || '';
    const target = params.get('target') || 'taxonomy_term';
    const vocabulary = params.get('vocabulary') || params.get('vocab') || '';
    const limit = parseInt(params.get('limit') || '15', 10);

    // Validate query length
    if (!query || query.trim().length < 1) {
      if (server && server.json) {
        return server.json(res, []);
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('[]');
      }
    }

    // Validate limit (prevent abuse)
    const safeLimit = Math.min(Math.max(1, limit), 20);

    // Search entities
    const startTime = Date.now();
    const results = await searchEntities(query, target, vocabulary, safeLimit);
    const duration = Date.now() - startTime;

    // Log performance warning if slow
    if (duration > 10) {
      console.warn(`[tagify-widget] Slow autocomplete: ${duration}ms for query "${query}"`);
    }

    // Return results
    if (server && server.json) {
      server.json(res, results);
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(results));
    }
  } catch (error) {
    console.error('[tagify-widget] Autocomplete error:', error);
    const server = services?.get('server');
    if (server && server.json) {
      server.json(res, { error: 'Autocomplete failed' }, 500);
    } else {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Autocomplete failed' }));
    }
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
  // Validate inputs
  if (!query || typeof query !== 'string') {
    return [];
  }

  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0) {
    return [];
  }

  // Handle different entity types
  if (target === 'taxonomy_term' || target === 'term') {
    return await searchTaxonomyTerms(trimmedQuery, vocabulary, limit);
  } else if (target === 'node' || target === 'content') {
    return await searchNodes(trimmedQuery, limit);
  }

  // Unsupported target type
  console.warn(`[tagify-widget] Unsupported target type: ${target}`);
  return [];
}

/**
 * Search taxonomy terms
 *
 * @param {string} query - Search term
 * @param {string} vocabulary - Vocabulary ID
 * @param {number} limit - Maximum results
 * @returns {Promise<Array>} Matching terms
 */
async function searchTaxonomyTerms(query, vocabulary, limit) {
  try {
    // Get taxonomy service
    const taxonomy = services?.get('taxonomy');
    if (!taxonomy) {
      console.error('[tagify-widget] Taxonomy service not available');
      return [];
    }

    // If no vocabulary specified, search all vocabularies
    let results = [];

    if (vocabulary) {
      // Search specific vocabulary
      results = taxonomy.searchTerms(vocabulary, query);
    } else {
      // Search all vocabularies
      const vocabularies = taxonomy.listVocabularies();
      for (const vocab of vocabularies) {
        const terms = taxonomy.searchTerms(vocab.id, query);
        results = results.concat(terms);
      }
    }

    // Sort by relevance (exact match first, then starts-with, then contains)
    const queryLower = query.toLowerCase();
    results.sort((a, b) => {
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();

      // Exact match
      if (aName === queryLower) return -1;
      if (bName === queryLower) return 1;

      // Starts with
      if (aName.startsWith(queryLower) && !bName.startsWith(queryLower)) return -1;
      if (!aName.startsWith(queryLower) && bName.startsWith(queryLower)) return 1;

      // Alphabetical
      return aName.localeCompare(bName);
    });

    // Limit results and format for Tagify
    return results.slice(0, limit).map(term => {
      const tagData = {
        value: term.id,
        label: term.name,
        vocabularyId: term.vocabularyId,
        slug: term.slug
      };

      // Include color and icon if present
      if (term.color) tagData.color = term.color;
      if (term.icon) tagData.icon = term.icon;

      return tagData;
    });
  } catch (error) {
    console.error('[tagify-widget] Error searching taxonomy terms:', error);
    return [];
  }
}

/**
 * Search content nodes
 *
 * @param {string} query - Search term
 * @param {number} limit - Maximum results
 * @returns {Promise<Array>} Matching nodes
 */
async function searchNodes(query, limit) {
  try {
    // Get content service
    const content = services?.get('content');
    if (!content) {
      console.error('[tagify-widget] Content service not available');
      return [];
    }

    // Search nodes by title (case-insensitive)
    const queryLower = query.toLowerCase();

    // Get all content types - try different methods
    let types = [];
    if (content.listTypes && typeof content.listTypes === 'function') {
      types = content.listTypes();
    } else if (services?.get('contentTypes')) {
      const contentTypes = services.get('contentTypes');
      if (contentTypes.list && typeof contentTypes.list === 'function') {
        types = contentTypes.list().map(t => ({ type: t.type || t }));
      }
    }

    // Fallback to common content types if listTypes not available
    if (!types || types.length === 0) {
      types = [
        { type: 'article' },
        { type: 'page' },
        { type: 'media-entity' }
      ];
    }

    let allNodes = [];

    // Search across all content types
    for (const typeInfo of types) {
      try {
        const typeName = typeInfo.type || typeInfo;
        const result = content.list(typeName, { limit: 1000 });
        if (result && result.items) {
          allNodes = allNodes.concat(result.items);
        }
      } catch (err) {
        // Skip types that can't be listed
        continue;
      }
    }

    const filtered = allNodes.filter(node => {
      const title = (node.title || '').toLowerCase();
      return title.includes(queryLower);
    });

    // Sort by relevance
    filtered.sort((a, b) => {
      const aTitle = (a.title || '').toLowerCase();
      const bTitle = (b.title || '').toLowerCase();

      if (aTitle.startsWith(queryLower) && !bTitle.startsWith(queryLower)) return -1;
      if (!aTitle.startsWith(queryLower) && bTitle.startsWith(queryLower)) return 1;

      return aTitle.localeCompare(bTitle);
    });

    // Limit and format
    return filtered.slice(0, limit).map(node => ({
      value: node.id,
      label: node.title || `Node ${node.id}`,
      type: node.type
    }));
  } catch (error) {
    console.error('[tagify-widget] Error searching nodes:', error);
    return [];
  }
}

/**
 * Load tag data with labels, colors, and icons from entities
 *
 * @param {Array} values - Array of entity IDs
 * @param {string} target - Entity type (taxonomy_term, node, etc.)
 * @param {string} vocabulary - Vocabulary ID (for taxonomy terms)
 * @param {Object} widgetSettings - Widget configuration
 * @returns {Promise<Array>} Array of tag objects with full data
 */
async function loadTagData(values, target, vocabulary, widgetSettings = {}) {
  if (!values || values.length === 0) {
    return [];
  }

  const tags = [];
  const colorField = widgetSettings.tagColorField;
  const iconField = widgetSettings.tagIconField;

  for (const id of values) {
    const tagData = {
      value: String(id),
      label: String(id), // Default fallback
    };

    try {
      // Load entity data
      if (target === 'taxonomy_term' || target === 'term') {
        const term = await loadTaxonomyTerm(id, vocabulary);
        if (term) {
          tagData.label = term.name;
          tagData.vocabularyId = term.vocabularyId;
          tagData.slug = term.slug;

          // Load color if specified
          if (colorField && term[colorField]) {
            tagData.color = term[colorField];
          }

          // Load icon if specified
          if (iconField && term[iconField]) {
            tagData.icon = term[iconField];
          }
        }
      } else if (target === 'node' || target === 'content') {
        const node = await loadNode(id);
        if (node) {
          tagData.label = node.title || `Node ${id}`;
          tagData.type = node.type;

          // Load color if specified
          if (colorField && node[colorField]) {
            tagData.color = node[colorField];
          }

          // Load icon if specified
          if (iconField && node[iconField]) {
            tagData.icon = node[iconField];
          }
        }
      }
    } catch (error) {
      console.error(`[tagify-widget] Error loading tag data for ${id}:`, error);
    }

    tags.push(tagData);
  }

  return tags;
}

/**
 * Load a taxonomy term by ID
 */
async function loadTaxonomyTerm(id, vocabularyId) {
  try {
    const taxonomy = services?.get('taxonomy');
    if (!taxonomy) return null;

    if (vocabularyId) {
      return taxonomy.getTerm(vocabularyId, id);
    }

    // Search all vocabularies
    const vocabularies = taxonomy.listVocabularies();
    for (const vocab of vocabularies) {
      const term = taxonomy.getTerm(vocab.id, id);
      if (term) return term;
    }

    return null;
  } catch (error) {
    console.error('[tagify-widget] Error loading term:', error);
    return null;
  }
}

/**
 * Load a content node by ID
 */
async function loadNode(id) {
  try {
    const content = services?.get('content');
    if (!content) return null;

    return content.load('node', id);
  } catch (error) {
    console.error('[tagify-widget] Error loading node:', error);
    return null;
  }
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

  <div class="demo-section">
    <h2>Feature #6: Custom Tag Display Templates</h2>

    <h3 style="font-size: 1.1em; margin-top: 20px; margin-bottom: 10px;">Color-Coded Tags</h3>
    <p style="color: #6b7280; margin-bottom: 15px;">
      Tags with custom background colors based on priority or category.
    </p>
    <form id="demo-form-4">
      <div class="form-group">
        <label>Task Priorities (Color-Coded)</label>
        <div class="tagify-widget" data-field-name="priorities-colored">
          <input
            type="text"
            id="field-priorities-colored"
            name="priorities_colored_tagify"
            class="tagify-input"
            data-tagify="true"
            data-target="content"
            data-vocabulary=""
            data-settings='{"maxTags":10,"draggable":true,"createOnEnter":true}'
            value='[{"value":"1","label":"Urgent","color":"#ef4444"},{"value":"2","label":"High","color":"#f59e0b"},{"value":"3","label":"Medium","color":"#3b82f6"},{"value":"4","label":"Low","color":"#6b7280"}]'
            placeholder="Type to search or add tags..."
          />
          <input type="hidden" name="priorities_colored" id="field-priorities-colored_value" value='["1","2","3","4"]' />
        </div>
      </div>
      <button type="submit">Submit Form</button>
    </form>
    <div class="output" id="output-4"></div>

    <h3 style="font-size: 1.1em; margin-top: 30px; margin-bottom: 10px;">Tags with Icons</h3>
    <p style="color: #6b7280; margin-bottom: 15px;">
      Tags can display small icons alongside labels.
    </p>
    <form id="demo-form-5">
      <div class="form-group">
        <label>Technologies (With Icons)</label>
        <div class="tagify-widget" data-field-name="technologies">
          <input
            type="text"
            id="field-technologies"
            name="technologies_tagify"
            class="tagify-input"
            data-tagify="true"
            data-target="content"
            data-vocabulary=""
            data-settings='{"maxTags":10,"draggable":true,"createOnEnter":true}'
            value='[{"value":"1","label":"JavaScript","icon":"🟨"},{"value":"2","label":"Python","icon":"🐍"},{"value":"3","label":"Ruby","icon":"💎"},{"value":"4","label":"Go","icon":"🔵"}]'
            placeholder="Type to search or add tags..."
          />
          <input type="hidden" name="technologies" id="field-technologies_value" value='["1","2","3","4"]' />
        </div>
      </div>
      <button type="submit">Submit Form</button>
    </form>
    <div class="output" id="output-5"></div>

    <h3 style="font-size: 1.1em; margin-top: 30px; margin-bottom: 10px;">Custom HTML Template</h3>
    <p style="color: #6b7280; margin-bottom: 15px;">
      Tags using a custom HTML template with color indicators.
    </p>
    <form id="demo-form-6">
      <div class="form-group">
        <label>Status Tags (Custom Template)</label>
        <div class="tagify-widget" data-field-name="statuses">
          <input
            type="text"
            id="field-statuses"
            name="statuses_tagify"
            class="tagify-input"
            data-tagify="true"
            data-target="content"
            data-vocabulary=""
            data-settings='{"maxTags":10,"draggable":true,"createOnEnter":true,"tagTemplate":"<div><span style=\\"display:inline-block;width:8px;height:8px;border-radius:50%;background:{color};margin-right:6px;\\"></span><x>{label}</x><x class=\\"tagify__tag__removeBtn\\" role=\\"button\\" aria-label=\\"remove tag\\">×</x></div>"}'
            value='[{"value":"1","label":"Active","color":"#10b981"},{"value":"2","label":"Pending","color":"#f59e0b"},{"value":"3","label":"Completed","color":"#3b82f6"},{"value":"4","label":"Archived","color":"#6b7280"}]'
            placeholder="Type to search or add tags..."
          />
          <input type="hidden" name="statuses" id="field-statuses_value" value='["1","2","3","4"]' />
        </div>
      </div>
      <button type="submit">Submit Form</button>
    </form>
    <div class="output" id="output-6"></div>
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

    document.getElementById('demo-form-4').addEventListener('submit', (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const data = {
        priorities_colored: JSON.parse(formData.get('priorities_colored'))
      };
      document.getElementById('output-4').textContent = 'Form Data:\\n' + JSON.stringify(data, null, 2);
    });

    document.getElementById('demo-form-5').addEventListener('submit', (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const data = {
        technologies: JSON.parse(formData.get('technologies'))
      };
      document.getElementById('output-5').textContent = 'Form Data:\\n' + JSON.stringify(data, null, 2);
    });

    document.getElementById('demo-form-6').addEventListener('submit', (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const data = {
        statuses: JSON.parse(formData.get('statuses'))
      };
      document.getElementById('output-6').textContent = 'Form Data:\\n' + JSON.stringify(data, null, 2);
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

/**
 * Create Tag API handler
 * Creates a new taxonomy term on-the-fly
 */
async function handleCreateTag(req, res) {
  try {
    // Get server helper for JSON responses
    const server = services?.get('server');

    // Parse request body
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    const data = JSON.parse(body);
    const { label, vocabulary } = data;

    // Validate inputs
    if (!label || typeof label !== 'string' || label.trim().length === 0) {
      return server ? server.json(res, { error: 'Label is required' }, 400) : res.end(JSON.stringify({ error: 'Label is required' }));
    }

    if (!vocabulary || typeof vocabulary !== 'string') {
      return server ? server.json(res, { error: 'Vocabulary is required' }, 400) : res.end(JSON.stringify({ error: 'Vocabulary is required' }));
    }

    const trimmedLabel = label.trim();

    // Validate label length
    if (trimmedLabel.length > 255) {
      return server ? server.json(res, { error: 'Label is too long (max 255 characters)' }, 400) : res.end(JSON.stringify({ error: 'Label is too long (max 255 characters)' }));
    }

    // Get taxonomy service
    const taxonomy = services?.get('taxonomy');
    if (!taxonomy) {
      console.error('[tagify-widget] Taxonomy service not available');
      return server ? server.json(res, { error: 'Taxonomy service unavailable' }, 500) : res.end(JSON.stringify({ error: 'Taxonomy service unavailable' }));
    }

    // Check if vocabulary exists
    const vocab = taxonomy.getVocabulary(vocabulary);
    if (!vocab) {
      return server ? server.json(res, { error: `Vocabulary "${vocabulary}" not found` }, 404) : res.end(JSON.stringify({ error: `Vocabulary "${vocabulary}" not found` }));
    }

    // Check for duplicates (case-insensitive)
    const existing = taxonomy.searchTerms(vocabulary, trimmedLabel);
    const duplicate = existing.find(
      term => term.name.toLowerCase() === trimmedLabel.toLowerCase()
    );

    if (duplicate) {
      // Return existing term instead of creating duplicate
      const response = {
        value: duplicate.id,
        label: duplicate.name,
        slug: duplicate.slug,
        existing: true
      };
      return server ? server.json(res, response) : res.end(JSON.stringify(response));
    }

    // Create new term
    const newTerm = await taxonomy.createTerm({
      vocabularyId: vocabulary,
      name: trimmedLabel,
      description: `Created via Tagify widget`
    });

    // Log creation
    console.log(`[tagify-widget] Created new term: "${newTerm.name}" (ID: ${newTerm.id}) in vocabulary "${vocabulary}"`);

    // Return new term
    const response = {
      value: newTerm.id,
      label: newTerm.name,
      slug: newTerm.slug,
      existing: false
    };
    server ? server.json(res, response) : res.end(JSON.stringify(response));
  } catch (error) {
    console.error('[tagify-widget] Error creating tag:', error);
    const server = services?.get('server');
    const errorResponse = { error: 'Failed to create tag: ' + error.message };
    server ? server.json(res, errorResponse, 500) : res.end(JSON.stringify(errorResponse));
  }
}

export const name = 'tagify-widget';
