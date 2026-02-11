/**
 * widget-registry.js - Dashboard Widget Registry
 *
 * WHY THIS EXISTS:
 * Provides a pluggable widget system for the AI dashboard.
 * Widgets are self-contained components that display metrics or tools.
 * Each widget can fetch its own data and refresh independently.
 *
 * DESIGN DECISIONS:
 * - Registry pattern for widget discovery
 * - Each widget implements: {id, title, render(data), fetchData(), refreshInterval}
 * - Widgets stored in modules/ai_dashboard/widgets/
 * - Server-side rendering with client-side refresh capability
 *
 * USAGE:
 *   import { registerWidget, getAllWidgets, getWidget } from './widget-registry.js';
 *
 *   registerWidget({
 *     id: 'my-widget',
 *     title: 'My Widget',
 *     fetchData: async (context) => ({ value: 42 }),
 *     render: (data) => `<div>${data.value}</div>`,
 *     refreshInterval: 30000 // 30 seconds
 *   });
 */

/**
 * Widget registry storage
 */
const widgets = new Map();

/**
 * Widget interface definition:
 * {
 *   id: string,              // Unique widget identifier
 *   title: string,           // Display title
 *   fetchData: async (ctx) => Object,  // Fetch widget data
 *   render: (data) => string,          // Render HTML from data
 *   refreshInterval: number   // Auto-refresh interval in ms (0 = no auto-refresh)
 * }
 */

/**
 * Register a widget
 *
 * @param {Object} widget - Widget definition
 */
export function registerWidget(widget) {
  if (!widget.id) {
    throw new Error('Widget must have an id');
  }
  if (!widget.title) {
    throw new Error('Widget must have a title');
  }
  if (typeof widget.fetchData !== 'function') {
    throw new Error('Widget must have a fetchData function');
  }
  if (typeof widget.render !== 'function') {
    throw new Error('Widget must have a render function');
  }

  widgets.set(widget.id, {
    id: widget.id,
    title: widget.title,
    fetchData: widget.fetchData,
    render: widget.render,
    refreshInterval: widget.refreshInterval || 0,
  });

  console.log(`[widget-registry] Registered widget: ${widget.id}`);
}

/**
 * Get all registered widgets
 *
 * @returns {Array} Array of widget definitions
 */
export function getAllWidgets() {
  return Array.from(widgets.values());
}

/**
 * Get a specific widget by ID
 *
 * @param {string} id - Widget ID
 * @returns {Object|null} Widget definition or null
 */
export function getWidget(id) {
  return widgets.get(id) || null;
}

/**
 * Render a widget with data
 *
 * @param {string} widgetId - Widget ID
 * @param {Object} data - Widget data
 * @param {Object} options - Render options (collapsed, position)
 * @returns {string} HTML string
 */
export function renderWidget(widgetId, data, options = {}) {
  const widget = widgets.get(widgetId);
  if (!widget) {
    return `<div class="widget-error">Widget "${widgetId}" not found</div>`;
  }

  const collapsed = options.collapsed || false;
  const refreshInterval = widget.refreshInterval;

  const widgetHtml = widget.render(data);

  return `
    <div class="dashboard-widget" data-widget-id="${widget.id}" data-refresh-interval="${refreshInterval}" draggable="true">
      <div class="widget-header">
        <h3 class="widget-title">${widget.title}</h3>
        <div class="widget-actions">
          <button class="widget-action-btn widget-refresh-btn" title="Refresh" aria-label="Refresh ${widget.title}">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M13.65 2.35A7.5 7.5 0 0 0 2.35 13.65l1.06-1.06a6 6 0 1 1 8.48-8.48l-1.5 1.5h4.11V1.5l-1.85 1.85z"/>
            </svg>
          </button>
          <button class="widget-action-btn widget-collapse-btn" title="${collapsed ? 'Expand' : 'Collapse'}" aria-label="${collapsed ? 'Expand' : 'Collapse'} ${widget.title}">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="${collapsed ? 'M8 4l4 5H4z' : 'M4 6l4 5 4-5z'}"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="widget-body" ${collapsed ? 'style="display: none;"' : ''}>
        ${widgetHtml}
      </div>
    </div>
  `;
}

/**
 * Fetch data for a widget
 *
 * @param {string} widgetId - Widget ID
 * @param {Object} context - Request context (services, session, etc.)
 * @returns {Promise<Object>} Widget data
 */
export async function fetchWidgetData(widgetId, context) {
  const widget = widgets.get(widgetId);
  if (!widget) {
    throw new Error(`Widget "${widgetId}" not found`);
  }

  try {
    const data = await widget.fetchData(context);
    return data;
  } catch (error) {
    console.error(`[widget-registry] Error fetching data for widget "${widgetId}":`, error);
    return { error: error.message };
  }
}
