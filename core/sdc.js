/**
 * sdc.js - Single Directory Components
 *
 * WHY THIS EXISTS:
 * Drupal's SDC system lets themes package reusable UI components as
 * self-contained directories with template, styles, and metadata.
 * This is CMS Core's equivalent.
 *
 * HOW IT WORKS:
 * Components live in themes/<theme>/components/<name>/:
 *   component.json  — metadata + props schema (JSON, not YAML — zero deps)
 *   <name>.html     — template (uses the same {{var}} syntax as core/template.js)
 *   <name>.css      — optional styles (auto-injected into page <head>)
 *
 * Usage in templates:
 *   {{component "card" title="Hello" body="World"}}
 *
 * The component tag is processed before variable substitution, so component
 * output can contain {{variables}} that resolve against the page data.
 *
 * Drupal parity: equivalent to Single Directory Components (SDC) in Drupal core.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Component registry: { name: { meta, template, cssPath, dir } }
const registry = new Map();

// CSS files used during current render pass (reset per page render)
let usedCssFiles = new Set();

let themePath = '';

/**
 * Initialize SDC by discovering components in the active theme.
 * @param {string} activeThemePath - Absolute path to the active theme directory
 */
export function init(activeThemePath) {
  themePath = activeThemePath;
  const componentsDir = join(activeThemePath, 'components');

  if (!existsSync(componentsDir)) {
    console.log('[sdc] No components directory found — SDC disabled');
    return;
  }

  const entries = readdirSync(componentsDir);

  for (const entry of entries) {
    const componentDir = join(componentsDir, entry);
    if (!statSync(componentDir).isDirectory()) continue;

    const metaPath = join(componentDir, 'component.json');
    const templatePath = join(componentDir, `${entry}.html`);

    if (!existsSync(metaPath) || !existsSync(templatePath)) {
      console.warn(`[sdc] Skipping ${entry}: missing component.json or ${entry}.html`);
      continue;
    }

    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      const template = readFileSync(templatePath, 'utf-8');
      const cssPath = join(componentDir, `${entry}.css`);
      const hasCss = existsSync(cssPath);

      registry.set(meta.name || entry, {
        meta,
        template,
        cssPath: hasCss ? cssPath : null,
        cssContent: hasCss ? readFileSync(cssPath, 'utf-8') : null,
        dir: componentDir
      });

      console.log(`[sdc] Registered component: ${meta.name || entry}${hasCss ? ' (with CSS)' : ''}`);
    } catch (err) {
      console.error(`[sdc] Error loading component ${entry}: ${err.message}`);
    }
  }

  console.log(`[sdc] Initialized with ${registry.size} component(s)`);
}

/**
 * Process {{component "name" prop="value"}} tags in a template string.
 * Called by core/template.js during the render pipeline.
 *
 * @param {string} template - Template string with component tags
 * @param {Object} data - Page-level data context (for fallback resolution)
 * @param {Function} renderFn - The template engine's renderString function (to render component templates)
 * @returns {string} - Template with component tags replaced by rendered HTML
 */
export function processComponents(template, data, renderFn) {
  // Match {{component "name" key="value" key2="value2"}}
  const componentRegex = /\{\{component\s+"([^"]+)"((?:\s+\w+="[^"]*")*)\s*\}\}/g;

  return template.replace(componentRegex, (match, name, propsStr) => {
    const component = registry.get(name);
    if (!component) {
      console.warn(`[sdc] Unknown component: ${name}`);
      return `<!-- SDC: unknown component "${name}" -->`;
    }

    // Parse props from key="value" pairs
    const props = {};
    const propRegex = /(\w+)="([^"]*)"/g;
    let propMatch;
    while ((propMatch = propRegex.exec(propsStr)) !== null) {
      props[propMatch[1]] = propMatch[2];
    }

    // Validate required props
    if (component.meta.props) {
      for (const [propName, propDef] of Object.entries(component.meta.props)) {
        if (propDef.required && !(propName in props)) {
          console.warn(`[sdc] Component "${name}" missing required prop: ${propName}`);
        }
      }
    }

    // Track CSS usage for this render pass
    if (component.cssPath) {
      usedCssFiles.add(name);
    }

    // Render the component template with props as data
    // Merge page data as fallback so components can access site-level vars
    const componentData = { ...data, ...props };
    return renderFn(component.template, componentData);
  });
}

/**
 * Get CSS <style> blocks for all components used in the current page.
 * Call this after rendering and inject into <head>.
 * @returns {string} - Combined <style> tags
 */
export function getUsedCss() {
  if (usedCssFiles.size === 0) return '';

  let css = '';
  for (const name of usedCssFiles) {
    const component = registry.get(name);
    if (component?.cssContent) {
      css += `/* SDC: ${name} */\n${component.cssContent}\n`;
    }
  }

  return css ? `<style data-sdc>\n${css}</style>` : '';
}

/**
 * Reset CSS tracking for a new page render.
 */
export function resetCssTracking() {
  usedCssFiles = new Set();
}

/**
 * Get a component by name.
 * @param {string} name
 * @returns {Object|undefined}
 */
export function getComponent(name) {
  return registry.get(name);
}

/**
 * List all registered components.
 * @returns {Array<{ name: string, description: string, props: Object }>}
 */
export function listComponents() {
  return Array.from(registry.entries()).map(([name, comp]) => ({
    name,
    description: comp.meta.description || '',
    props: comp.meta.props || {}
  }));
}

/**
 * Check if any components are registered.
 */
export function hasComponents() {
  return registry.size > 0;
}
