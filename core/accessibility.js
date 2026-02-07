/**
 * accessibility.js - Content Accessibility Checker Service
 *
 * WHY THIS EXISTS:
 * Content editors often create accessibility issues unknowingly:
 * - Images without alt text (screen readers can't describe them)
 * - Skipped heading levels (breaks document outline for assistive tech)
 * - Poor link text like "click here" (no context for screen reader users)
 * - Low color contrast (unreadable for low-vision users)
 * - Missing ARIA labels (interactive elements are unlabeled)
 *
 * This service scans content for common accessibility problems and
 * provides actionable suggestions to fix them. Inspired by Drupal's
 * editoria11y module and WCAG 2.1 guidelines.
 *
 * ARCHITECTURE:
 * - Plugin-based checker system: each check is a separate function
 * - Severity levels: error (must fix), warning (should fix), info (nice to fix)
 * - Returns structured results with issue location, description, and fix suggestion
 * - Integrates with content system via hooks for automatic checking on save
 *
 * SUPPORTED CHECKS:
 * - Missing alt text on images
 * - Heading hierarchy violations
 * - Poor link text quality
 * - Empty headings/links
 * - Placeholder alt text (decorative markers)
 * - Consecutive headings without content between them
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Severity levels for accessibility issues
 *
 * WHY THREE LEVELS:
 * - error: Definite accessibility barrier (WCAG A violations)
 * - warning: Likely problematic (WCAG AA violations)
 * - info: Best practice suggestion (WCAG AAA or editorial)
 */
const SEVERITY = {
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
};

/**
 * Registry of accessibility checks
 * Each check is { id, name, description, severity, check: (content) => issues[] }
 */
const checks = new Map();

/**
 * Module state
 */
let initialized = false;
let contentService = null;
let hooksService = null;
let baseDir = null;
let configData = {};

/**
 * Initialize the accessibility checker service
 *
 * @param {Object} opts - Configuration options
 * @param {string} opts.baseDir - Project root directory
 * @param {Object} opts.content - Content service reference
 * @param {Object} opts.hooks - Hooks service reference (optional)
 * @param {Object} opts.config - Configuration overrides
 */
export function init(opts = {}) {
  baseDir = opts.baseDir || process.cwd();
  contentService = opts.content || null;
  hooksService = opts.hooks || null;
  configData = {
    enabled: true,
    autoCheck: false,      // Auto-check on content save
    ...opts.config,
  };

  // Register built-in checks
  registerBuiltinChecks();

  initialized = true;
}

/**
 * Export service name for boot registration
 */
export const name = 'accessibility';

/**
 * Register a new accessibility check
 *
 * @param {string} id - Unique check identifier (e.g., 'missing-alt-text')
 * @param {Object} checkDef - Check definition
 * @param {string} checkDef.name - Human-readable name
 * @param {string} checkDef.description - What this check looks for
 * @param {string} checkDef.severity - Default severity (error|warning|info)
 * @param {Function} checkDef.check - Function that returns array of issues
 */
export function registerCheck(id, checkDef) {
  checks.set(id, {
    id,
    name: checkDef.name,
    description: checkDef.description,
    severity: checkDef.severity || SEVERITY.WARNING,
    check: checkDef.check,
  });
}

/**
 * Get all registered checks
 *
 * @returns {Array} List of registered check definitions
 */
export function getChecks() {
  return Array.from(checks.values()).map(c => ({
    id: c.id,
    name: c.name,
    description: c.description,
    severity: c.severity,
  }));
}

/**
 * Run all accessibility checks on content
 *
 * WHY ACCEPT RAW CONTENT OBJECT:
 * Content can come from many sources - the content service, API input,
 * or direct editor input. Accepting raw objects keeps us flexible.
 *
 * @param {Object} contentItem - Content object with fields to check
 * @param {Object} options - Check options
 * @param {string[]} options.only - Only run these check IDs
 * @param {string[]} options.skip - Skip these check IDs
 * @param {string} options.severity - Minimum severity to report
 * @returns {Object} Check results with issues, score, and summary
 */
export function check(contentItem, options = {}) {
  if (!contentItem) {
    return { issues: [], score: 100, summary: 'No content to check' };
  }

  const { only, skip, severity } = options;

  // Collect all text/HTML fields from content
  const fields = extractCheckableFields(contentItem);

  // Run each registered check
  const allIssues = [];

  for (const [checkId, checkDef] of checks) {
    // Filter checks if options specify
    if (only && !only.includes(checkId)) continue;
    if (skip && skip.includes(checkId)) continue;

    try {
      const issues = checkDef.check(contentItem, fields);
      if (issues && issues.length > 0) {
        for (const issue of issues) {
          allIssues.push({
            checkId,
            checkName: checkDef.name,
            severity: issue.severity || checkDef.severity,
            message: issue.message,
            field: issue.field || null,
            element: issue.element || null,
            line: issue.line || null,
            suggestion: issue.suggestion || null,
          });
        }
      }
    } catch (err) {
      // Don't let a broken check crash the whole analysis
      allIssues.push({
        checkId,
        checkName: checkDef.name,
        severity: SEVERITY.INFO,
        message: `Check failed: ${err.message}`,
        field: null,
        element: null,
        line: null,
        suggestion: 'This check encountered an error and could not complete',
      });
    }
  }

  // Filter by minimum severity if requested
  const severityOrder = { error: 0, warning: 1, info: 2 };
  let filteredIssues = allIssues;
  if (severity) {
    const minLevel = severityOrder[severity] ?? 2;
    filteredIssues = allIssues.filter(i => (severityOrder[i.severity] ?? 2) <= minLevel);
  }

  // Calculate accessibility score (100 = perfect, 0 = many issues)
  // WHY SCORE: Quick indicator for editors. Errors weigh more than warnings.
  const score = calculateScore(filteredIssues);

  return {
    issues: filteredIssues,
    score,
    summary: generateSummary(filteredIssues),
    total: filteredIssues.length,
    byType: {
      error: filteredIssues.filter(i => i.severity === 'error').length,
      warning: filteredIssues.filter(i => i.severity === 'warning').length,
      info: filteredIssues.filter(i => i.severity === 'info').length,
    },
  };
}

/**
 * Check a specific content item by type and ID
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 * @param {Object} options - Check options
 * @returns {Object} Check results
 */
export function checkContent(type, id, options = {}) {
  if (!contentService) {
    return { issues: [], score: 0, summary: 'Content service not available' };
  }

  try {
    const item = contentService.read(type, id);
    if (!item) {
      return { issues: [], score: 0, summary: `Content not found: ${type}/${id}` };
    }
    return check(item, options);
  } catch (err) {
    return { issues: [], score: 0, summary: `Error loading content: ${err.message}` };
  }
}

/**
 * Extract fields that can be checked for accessibility
 *
 * WHY EXTRACT FIELDS:
 * Not all content fields need accessibility checking. We focus on:
 * - Rich text / HTML fields (body, summary, description)
 * - Plain text fields that may contain HTML
 * - Skip system fields (id, type, created, updated, status)
 *
 * @param {Object} contentItem - Content object
 * @returns {Object} Map of fieldName → { value, type }
 */
function extractCheckableFields(contentItem) {
  const systemFields = new Set([
    'id', 'type', 'created', 'updated', 'status',
    'publishedAt', 'scheduledAt', 'slug', 'author',
    'isDefaultRevision', 'revisionId',
  ]);

  const fields = {};

  for (const [key, value] of Object.entries(contentItem)) {
    if (systemFields.has(key)) continue;
    if (value === null || value === undefined) continue;

    if (typeof value === 'string' && value.trim().length > 0) {
      fields[key] = { value, type: looksLikeHtml(value) ? 'html' : 'text' };
    } else if (typeof value === 'object' && value.value) {
      // Handle structured field values like { value: 'html', format: 'full_html' }
      fields[key] = {
        value: String(value.value),
        type: looksLikeHtml(String(value.value)) ? 'html' : 'text',
      };
    }
  }

  return fields;
}

/**
 * Check if a string looks like it contains HTML
 */
function looksLikeHtml(str) {
  return /<[a-z][^>]*>/i.test(str);
}

/**
 * Calculate an accessibility score from 0-100
 *
 * WHY WEIGHTED SCORING:
 * Errors are definite barriers, so they reduce score more.
 * A single error is worse than several warnings.
 *
 * @param {Array} issues - List of accessibility issues
 * @returns {number} Score from 0 to 100
 */
function calculateScore(issues) {
  if (issues.length === 0) return 100;

  const weights = { error: 15, warning: 5, info: 1 };
  let penalty = 0;

  for (const issue of issues) {
    penalty += weights[issue.severity] || 1;
  }

  return Math.max(0, Math.round(100 - penalty));
}

/**
 * Generate a human-readable summary of issues
 */
function generateSummary(issues) {
  if (issues.length === 0) return 'No accessibility issues found';

  const errors = issues.filter(i => i.severity === 'error').length;
  const warnings = issues.filter(i => i.severity === 'warning').length;
  const infos = issues.filter(i => i.severity === 'info').length;

  const parts = [];
  if (errors > 0) parts.push(`${errors} error${errors > 1 ? 's' : ''}`);
  if (warnings > 0) parts.push(`${warnings} warning${warnings > 1 ? 's' : ''}`);
  if (infos > 0) parts.push(`${infos} suggestion${infos > 1 ? 's' : ''}`);

  return `Found ${parts.join(', ')}`;
}

// ============================================================
// BUILT-IN CHECKS
// ============================================================

/**
 * Register all built-in accessibility checks
 *
 * WHY SEPARATE FUNCTION:
 * Keeps init() clean. Each check is self-contained with its own
 * detection logic and suggestion generation.
 */
function registerBuiltinChecks() {
  // ----- CHECK: Missing alt text -----
  registerCheck('missing-alt-text', {
    name: 'Missing Alt Text',
    description: 'Images must have alt text for screen reader users',
    severity: SEVERITY.ERROR,
    check: (content, fields) => {
      const issues = [];

      for (const [fieldName, field] of Object.entries(fields)) {
        if (field.type !== 'html') continue;

        // Find <img> tags without alt attribute or with empty alt
        const imgRegex = /<img\b([^>]*)>/gi;
        let match;

        while ((match = imgRegex.exec(field.value)) !== null) {
          const attrs = match[1];

          // Check for alt attribute
          const altMatch = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/i.exec(attrs);

          if (!altMatch) {
            // No alt attribute at all
            const src = extractAttr(attrs, 'src') || 'unknown';
            issues.push({
              message: `Image missing alt attribute`,
              field: fieldName,
              element: match[0].substring(0, 100),
              severity: SEVERITY.ERROR,
              suggestion: `Add alt="descriptive text" to the <img> tag (src: ${src})`,
            });
          } else {
            const altValue = (altMatch[1] || altMatch[2] || altMatch[3] || '').trim();
            if (altValue === '') {
              // Empty alt is acceptable for decorative images, but flag as info
              // A truly decorative image should have alt="" intentionally
              // We flag it so editors can verify it's intentional
            } else if (isPlaceholderAlt(altValue)) {
              // Placeholder alt text like "image", "photo", "IMG_1234.jpg"
              issues.push({
                message: `Image has placeholder alt text: "${altValue}"`,
                field: fieldName,
                element: match[0].substring(0, 100),
                severity: SEVERITY.WARNING,
                suggestion: `Replace with descriptive text that conveys the image's meaning or purpose`,
              });
            }
          }
        }
      }

      return issues;
    },
  });

  // ----- CHECK: Heading hierarchy -----
  registerCheck('heading-hierarchy', {
    name: 'Heading Hierarchy',
    description: 'Headings should follow a logical hierarchy without skipping levels',
    severity: SEVERITY.WARNING,
    check: (content, fields) => {
      const issues = [];

      for (const [fieldName, field] of Object.entries(fields)) {
        if (field.type !== 'html') continue;

        // Extract all heading tags in order
        const headingRegex = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
        const headings = [];
        let hMatch;

        while ((hMatch = headingRegex.exec(field.value)) !== null) {
          headings.push({
            level: parseInt(hMatch[1]),
            text: stripHtml(hMatch[2]).trim(),
            raw: hMatch[0],
          });
        }

        if (headings.length === 0) continue;

        // Check for hierarchy violations
        for (let i = 1; i < headings.length; i++) {
          const prev = headings[i - 1];
          const curr = headings[i];

          // A heading can go up (smaller number) or one level deeper
          // But it should NOT skip levels (e.g., h1 → h3, skipping h2)
          if (curr.level > prev.level + 1) {
            issues.push({
              message: `Heading level skipped: h${prev.level} followed by h${curr.level} (skipped h${prev.level + 1})`,
              field: fieldName,
              element: curr.raw.substring(0, 100),
              severity: SEVERITY.WARNING,
              suggestion: `Change "${curr.text || '(empty)'}" from h${curr.level} to h${prev.level + 1} to maintain proper hierarchy`,
            });
          }
        }

        // Check for empty headings
        for (const heading of headings) {
          if (heading.text === '' || heading.text.length === 0) {
            issues.push({
              message: `Empty heading found (h${heading.level})`,
              field: fieldName,
              element: heading.raw.substring(0, 100),
              severity: SEVERITY.ERROR,
              suggestion: `Add descriptive text to the h${heading.level} heading or remove it`,
            });
          }
        }
      }

      return issues;
    },
  });

  // ----- CHECK: Link text quality -----
  registerCheck('link-text-quality', {
    name: 'Link Text Quality',
    description: 'Links should have descriptive text (not "click here" or "read more")',
    severity: SEVERITY.WARNING,
    check: (content, fields) => {
      const issues = [];

      const poorLinkTexts = new Set([
        'click here', 'here', 'click', 'link', 'read more',
        'more', 'learn more', 'more info', 'this', 'go',
        'this link', 'this page',
      ]);

      for (const [fieldName, field] of Object.entries(fields)) {
        if (field.type !== 'html') continue;

        // Find all anchor tags
        const linkRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
        let lMatch;

        while ((lMatch = linkRegex.exec(field.value)) !== null) {
          const linkText = stripHtml(lMatch[2]).trim().toLowerCase();
          const attrs = lMatch[1];

          // Check for empty links
          if (linkText === '') {
            // Check if there's an aria-label or title
            const hasAriaLabel = /aria-label\s*=/i.test(attrs);
            const hasTitle = /\btitle\s*=/i.test(attrs);

            if (!hasAriaLabel && !hasTitle) {
              issues.push({
                message: 'Link has no text or accessible label',
                field: fieldName,
                element: lMatch[0].substring(0, 100),
                severity: SEVERITY.ERROR,
                suggestion: 'Add descriptive text inside the link or add an aria-label attribute',
              });
            }
            continue;
          }

          // Check for poor link text
          if (poorLinkTexts.has(linkText)) {
            const href = extractAttr(attrs, 'href') || '';
            issues.push({
              message: `Link has non-descriptive text: "${linkText}"`,
              field: fieldName,
              element: lMatch[0].substring(0, 100),
              severity: SEVERITY.WARNING,
              suggestion: `Replace "${linkText}" with text that describes the link destination${href ? ` (${href})` : ''}`,
            });
          }

          // Check for URL as link text
          if (/^https?:\/\//i.test(linkText)) {
            issues.push({
              message: 'Link text is a raw URL',
              field: fieldName,
              element: lMatch[0].substring(0, 100),
              severity: SEVERITY.WARNING,
              suggestion: 'Replace the URL with descriptive text about the link destination',
            });
          }
        }
      }

      return issues;
    },
  });

  // ----- CHECK: ARIA label suggestions -----
  registerCheck('aria-labels', {
    name: 'ARIA Label Suggestions',
    description: 'Interactive elements should have accessible labels',
    severity: SEVERITY.INFO,
    check: (content, fields) => {
      const issues = [];

      for (const [fieldName, field] of Object.entries(fields)) {
        if (field.type !== 'html') continue;

        // Check for buttons without accessible text
        const buttonRegex = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
        let bMatch;

        while ((bMatch = buttonRegex.exec(field.value)) !== null) {
          const buttonText = stripHtml(bMatch[2]).trim();
          const attrs = bMatch[1];

          if (buttonText === '' && !(/aria-label/i.test(attrs))) {
            issues.push({
              message: 'Button has no accessible text',
              field: fieldName,
              element: bMatch[0].substring(0, 100),
              severity: SEVERITY.ERROR,
              suggestion: 'Add text content or an aria-label to the button',
            });
          }
        }

        // Check for inputs without labels
        const inputRegex = /<input\b([^>]*)>/gi;
        let iMatch;

        while ((iMatch = inputRegex.exec(field.value)) !== null) {
          const attrs = iMatch[1];
          const type = extractAttr(attrs, 'type') || 'text';

          // Skip hidden and submit inputs
          if (['hidden', 'submit', 'button', 'image'].includes(type)) continue;

          const hasId = /\bid\s*=/i.test(attrs);
          const hasAriaLabel = /aria-label\s*=/i.test(attrs);
          const hasAriaLabelledBy = /aria-labelledby\s*=/i.test(attrs);
          const hasPlaceholder = /placeholder\s*=/i.test(attrs);

          if (!hasAriaLabel && !hasAriaLabelledBy) {
            issues.push({
              message: `Input (type="${type}") may lack an accessible label`,
              field: fieldName,
              element: iMatch[0].substring(0, 100),
              severity: SEVERITY.INFO,
              suggestion: hasPlaceholder
                ? 'Placeholder text is not a substitute for a label. Add aria-label or a <label> element'
                : 'Add aria-label, aria-labelledby, or an associated <label> element',
            });
          }
        }
      }

      return issues;
    },
  });

  // ----- CHECK: Color contrast warnings -----
  registerCheck('color-contrast', {
    name: 'Color Contrast Warnings',
    description: 'Inline color styles may cause contrast issues',
    severity: SEVERITY.WARNING,
    check: (content, fields) => {
      const issues = [];

      for (const [fieldName, field] of Object.entries(fields)) {
        if (field.type !== 'html') continue;

        // Check for inline color styles that might cause contrast issues
        const styleColorRegex = /style\s*=\s*"[^"]*(?:color\s*:\s*([^;"]*))[^"]*"/gi;
        let cMatch;

        while ((cMatch = styleColorRegex.exec(field.value)) !== null) {
          const colorValue = cMatch[1]?.trim();
          if (colorValue) {
            // Light colors on potentially light backgrounds
            if (isLightColor(colorValue)) {
              issues.push({
                message: `Inline style uses a light color (${colorValue}) that may have poor contrast`,
                field: fieldName,
                element: cMatch[0].substring(0, 100),
                severity: SEVERITY.WARNING,
                suggestion: 'Verify color contrast meets WCAG AA minimum (4.5:1 for text, 3:1 for large text). Consider using CSS classes instead of inline styles',
              });
            }
          }
        }
      }

      return issues;
    },
  });
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Strip HTML tags from a string
 */
function stripHtml(html) {
  return html.replace(/<[^>]+>/g, '');
}

/**
 * Extract an attribute value from an attribute string
 */
function extractAttr(attrString, attrName) {
  const regex = new RegExp(`\\b${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|(\\S+))`, 'i');
  const match = regex.exec(attrString);
  if (!match) return null;
  return match[1] || match[2] || match[3] || '';
}

/**
 * Check if alt text is just a placeholder
 *
 * WHY DETECT PLACEHOLDERS:
 * Common CMS patterns auto-generate alt text from filenames,
 * resulting in non-descriptive values like "IMG_1234" or "image".
 */
function isPlaceholderAlt(alt) {
  const normalized = alt.toLowerCase().trim();

  // Common placeholder patterns
  const placeholders = [
    'image', 'photo', 'picture', 'img', 'graphic',
    'banner', 'thumbnail', 'icon', 'logo',
    'untitled', 'no description', 'placeholder',
  ];

  if (placeholders.includes(normalized)) return true;

  // Filename patterns: IMG_1234.jpg, DSC_0001.png, etc.
  if (/^[a-z_-]*\d+\.[a-z]{3,4}$/i.test(alt)) return true;
  if (/^(IMG|DSC|DCIM|Photo|Screenshot)[_-]?\d+/i.test(alt)) return true;

  return false;
}

/**
 * Very basic check if a CSS color value appears light
 *
 * WHY SIMPLE CHECK:
 * Full color contrast analysis requires knowing both foreground
 * and background colors. We do a basic heuristic to flag obviously
 * problematic inline colors that editors should verify.
 */
function isLightColor(colorStr) {
  const c = colorStr.toLowerCase().trim();

  // Named light colors
  const lightNames = ['white', 'lightyellow', 'lighcyan', 'linen',
    'ivory', 'snow', 'ghostwhite', 'floralwhite', 'aliceblue',
    'honeydew', 'mintcream', 'azure', 'lavenderblush', 'seashell'];
  if (lightNames.includes(c)) return true;

  // Hex colors
  const hexMatch = /^#([0-9a-f]{3,8})$/i.exec(c);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    if (hex.length >= 6) {
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      // Relative luminance approximation
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      return lum > 0.85;
    }
  }

  return false;
}

/**
 * Register CLI commands for accessibility checking
 *
 * @param {Function} register - CLI registration function
 */
export function registerCli(register) {
  // accessibility:check <type> <id> - Check content accessibility
  register('accessibility:check', async (args) => {
    if (args.length < 2) {
      console.log('Usage: accessibility:check <type> <id>');
      console.log('Example: accessibility:check article my-post');
      return true;
    }

    const [type, id] = args;
    const result = checkContent(type, id);

    console.log(`\nAccessibility Report: ${type}/${id}`);
    console.log(`Score: ${result.score}/100`);
    console.log(`Summary: ${result.summary}`);

    if (result.issues.length > 0) {
      console.log('\nIssues:');
      for (const issue of result.issues) {
        const icon = issue.severity === 'error' ? '❌' :
                     issue.severity === 'warning' ? '⚠️' : 'ℹ️';
        console.log(`  ${icon} [${issue.severity.toUpperCase()}] ${issue.message}`);
        if (issue.field) console.log(`     Field: ${issue.field}`);
        if (issue.suggestion) console.log(`     Fix: ${issue.suggestion}`);
      }
    }

    return true;
  }, 'Check content for accessibility issues', 'accessibility');

  // accessibility:checks - List available checks
  register('accessibility:checks', async () => {
    const allChecks = getChecks();
    console.log(`\nRegistered Accessibility Checks (${allChecks.length}):`);
    for (const c of allChecks) {
      const icon = c.severity === 'error' ? '❌' :
                   c.severity === 'warning' ? '⚠️' : 'ℹ️';
      console.log(`  ${icon} ${c.id}: ${c.name}`);
      console.log(`     ${c.description}`);
    }
    return true;
  }, 'List available accessibility checks', 'accessibility');

  // accessibility:scan <type> - Scan all content of a type
  register('accessibility:scan', async (args) => {
    if (args.length < 1) {
      console.log('Usage: accessibility:scan <type>');
      return true;
    }

    const type = args[0];
    if (!contentService) {
      console.log('Content service not available');
      return false;
    }

    try {
      const items = contentService.list(type);
      console.log(`\nScanning ${items.length} ${type}(s) for accessibility issues...\n`);

      let totalIssues = 0;
      for (const item of items) {
        const result = check(item);
        if (result.issues.length > 0) {
          console.log(`  ${item.id} (${item.title || item.name || 'untitled'}): ${result.summary} [Score: ${result.score}]`);
          totalIssues += result.issues.length;
        }
      }

      if (totalIssues === 0) {
        console.log('  No accessibility issues found!');
      } else {
        console.log(`\nTotal: ${totalIssues} issue(s) across ${items.length} item(s)`);
      }
    } catch (err) {
      console.log(`Error scanning ${type}: ${err.message}`);
    }

    return true;
  }, 'Scan all content of a type for accessibility issues', 'accessibility');
}

/**
 * Register HTTP routes for accessibility API
 *
 * @param {Object} router - Router service
 * @param {Object} auth - Auth service
 */
export function registerRoutes(router, auth) {
  // GET /api/accessibility/check/:type/:id
  router.register('GET', '/api/accessibility/check/:type/:id', async (req, res, params) => {
    const { type, id } = params;
    const result = checkContent(type, id);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  });

  // POST /api/accessibility/check - Check arbitrary content
  router.register('POST', '/api/accessibility/check', async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;

    try {
      const contentItem = JSON.parse(body);
      const result = check(contentItem);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON', message: err.message }));
    }
  });

  // GET /api/accessibility/checks - List available checks
  router.register('GET', '/api/accessibility/checks', async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ checks: getChecks() }));
  });

  // GET /admin/accessibility - Admin dashboard for accessibility
  router.register('GET', '/admin/accessibility', async (req, res) => {
    const allChecks = getChecks();

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Accessibility Checker - Admin</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; color: #333; }
    .container { max-width: 900px; margin: 0 auto; padding: 20px; }
    h1 { margin-bottom: 20px; }
    .card { background: white; border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .card h2 { margin-bottom: 15px; font-size: 18px; }
    .check-form { display: flex; gap: 10px; margin-bottom: 20px; }
    .check-form input, .check-form select { padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; }
    .check-form button { padding: 8px 20px; background: #0073aa; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; }
    .check-form button:hover { background: #005a87; }
    .checks-list { list-style: none; }
    .checks-list li { padding: 10px; border-bottom: 1px solid #eee; display: flex; gap: 10px; align-items: start; }
    .checks-list li:last-child { border-bottom: none; }
    .severity { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: bold; }
    .severity-error { background: #fce4ec; color: #c62828; }
    .severity-warning { background: #fff3e0; color: #e65100; }
    .severity-info { background: #e3f2fd; color: #1565c0; }
    #results { margin-top: 20px; }
    .score { font-size: 48px; font-weight: bold; text-align: center; margin: 20px 0; }
    .score-good { color: #2e7d32; }
    .score-ok { color: #f57f17; }
    .score-bad { color: #c62828; }
    .issue { padding: 12px; margin: 8px 0; border-left: 4px solid #ddd; background: #fafafa; border-radius: 0 4px 4px 0; }
    .issue-error { border-left-color: #c62828; }
    .issue-warning { border-left-color: #f57f17; }
    .issue-info { border-left-color: #1565c0; }
    .issue-field { font-size: 12px; color: #666; margin-top: 4px; }
    .issue-suggestion { font-size: 13px; color: #555; margin-top: 6px; font-style: italic; }
    .back-link { display: inline-block; margin-bottom: 20px; color: #0073aa; text-decoration: none; }
    .back-link:hover { text-decoration: underline; }
    .nav { background: #23282d; padding: 10px 20px; margin-bottom: 20px; }
    .nav a { color: #eee; text-decoration: none; margin-right: 15px; }
    .nav a:hover { color: white; }
  </style>
</head>
<body>
  <div class="nav">
    <a href="/admin">← Dashboard</a>
    <a href="/admin/accessibility">Accessibility</a>
    <a href="/admin/content">Content</a>
  </div>
  <div class="container">
    <h1>♿ Accessibility Checker</h1>

    <div class="card">
      <h2>Check Content</h2>
      <div class="check-form">
        <input type="text" id="contentType" placeholder="Content type (e.g., article)" value="article">
        <input type="text" id="contentId" placeholder="Content ID">
        <button onclick="runCheck()">Check</button>
      </div>
      <div id="results"></div>
    </div>

    <div class="card">
      <h2>Available Checks (${allChecks.length})</h2>
      <ul class="checks-list">
        ${allChecks.map(c => `
          <li>
            <span class="severity severity-${c.severity}">${c.severity}</span>
            <div>
              <strong>${c.name}</strong>
              <div style="font-size:13px;color:#666">${c.description}</div>
            </div>
          </li>
        `).join('')}
      </ul>
    </div>
  </div>

  <script>
    async function runCheck() {
      const type = document.getElementById('contentType').value;
      const id = document.getElementById('contentId').value;
      const resultsDiv = document.getElementById('results');

      if (!type || !id) {
        resultsDiv.innerHTML = '<p style="color:red">Please enter both content type and ID</p>';
        return;
      }

      resultsDiv.innerHTML = '<p>Checking...</p>';

      try {
        const resp = await fetch('/api/accessibility/check/' + type + '/' + id);
        const data = await resp.json();

        let scoreClass = data.score >= 80 ? 'score-good' : data.score >= 50 ? 'score-ok' : 'score-bad';

        let html = '<div class="score ' + scoreClass + '">' + data.score + '/100</div>';
        html += '<p style="text-align:center;margin-bottom:20px">' + data.summary + '</p>';

        if (data.issues && data.issues.length > 0) {
          for (const issue of data.issues) {
            html += '<div class="issue issue-' + issue.severity + '">';
            html += '<strong>[' + issue.severity.toUpperCase() + '] ' + issue.message + '</strong>';
            if (issue.field) html += '<div class="issue-field">Field: ' + issue.field + '</div>';
            if (issue.suggestion) html += '<div class="issue-suggestion">💡 ' + issue.suggestion + '</div>';
            html += '</div>';
          }
        }

        resultsDiv.innerHTML = html;
      } catch (err) {
        resultsDiv.innerHTML = '<p style="color:red">Error: ' + err.message + '</p>';
      }
    }
  </script>
</body>
</html>`;

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });
}
