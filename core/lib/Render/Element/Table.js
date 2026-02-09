/**
 * @file
 * Table element type handler for rendering HTML tables.
 *
 * Renders structured data as HTML tables with thead/tbody sections.
 * Supports header row, data rows, empty message, and attributes.
 * Each cell can be a string or a render array (rendered recursively).
 *
 * Drupal equivalent: Table element (render element plugin)
 *
 * @see .autoforge/templates/render-element.js for usage examples
 */

import { Attribute } from '../Attribute.js';

/**
 * Table element type handler.
 *
 * WHY: Export object with type and render method. This pattern allows the
 * Renderer to register handlers by type and dispatch to them.
 */
export default {
  /**
   * Element type identifier.
   *
   * WHY: Used by Renderer to map #type values to handlers.
   */
  type: 'table',

  /**
   * Render table element.
   *
   * WHY: Tables are a fundamental UI pattern for displaying structured data.
   * Support for render arrays in cells enables rich content (links, buttons, etc.)
   * in table cells, not just plain text.
   *
   * @param {Object} element - Render array with #header, #rows, #empty, #attributes
   * @param {Object} renderer - Renderer instance for recursive cell rendering
   * @returns {Promise<string>} HTML table string
   */
  async render(element, renderer) {
    const header = element['#header'] || [];
    const rows = element['#rows'] || [];
    const empty = element['#empty'] || '';
    const attributes = element['#attributes'] || {};

    // WHY: If no rows, show the #empty message instead of an empty table.
    // Empty tables are confusing UI — better to show explicit "no data" message.
    if (rows.length === 0) {
      if (empty) {
        return `<p class="empty">${this._escapeHtml(empty)}</p>`;
      }
      return '';
    }

    // WHY: Convert attributes object to HTML attribute string.
    const attrStr = new Attribute(attributes).toString();

    let html = `<table${attrStr}>`;

    // WHY: Render <thead> if header is provided.
    // Header cells use <th> instead of <td> for semantic correctness and styling.
    if (header.length > 0) {
      html += '<thead><tr>';
      for (const cell of header) {
        // WHY: Header cells can be strings or render arrays.
        // This enables complex headers (sortable links, icons, etc.)
        const cellHtml = await this._renderCell(cell, renderer);
        html += `<th>${cellHtml}</th>`;
      }
      html += '</tr></thead>';
    }

    // WHY: Render <tbody> with data rows.
    html += '<tbody>';
    for (const row of rows) {
      html += '<tr>';
      // WHY: Each row is an array of cells.
      for (const cell of row) {
        // WHY: Cells can be strings or render arrays.
        const cellHtml = await this._renderCell(cell, renderer);
        html += `<td>${cellHtml}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody>';

    html += '</table>';
    return html;
  },

  /**
   * Render a table cell (supports string or render array).
   *
   * WHY: Cells can be simple strings or complex render arrays. This helper
   * handles both cases, enabling rich content in tables.
   *
   * @param {string|Object} cell - Cell content (string or render array)
   * @param {Object} renderer - Renderer instance
   * @returns {Promise<string>} Rendered cell HTML
   */
  async _renderCell(cell, renderer) {
    // WHY: If cell is a string, escape it for safe HTML output.
    if (typeof cell === 'string') {
      return this._escapeHtml(cell);
    }

    // WHY: If cell is a render array (object), render it recursively.
    // This enables links, buttons, icons, etc. in table cells.
    if (cell && typeof cell === 'object') {
      return await renderer.render(cell);
    }

    // WHY: Null, undefined, or other types render as empty cell.
    return '';
  },

  /**
   * Escape HTML special characters for safe output.
   *
   * WHY: Prevent XSS by escaping user-provided strings. This is minimal
   * escaping for text content (not attributes).
   *
   * @param {string} str - String to escape
   * @returns {string} Escaped string
   */
  _escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
};
