/**
 * help.js - Integrated Help System
 *
 * WHY THIS EXISTS:
 * Users need contextual help throughout the admin interface.
 * Rather than relying on external documentation, help content
 * is integrated directly into the system with:
 * - Route-based automatic help
 * - Module-specific help topics
 * - Full-text search across help content
 * - Related topics and navigation
 * - CLI command help
 *
 * HELP STRUCTURE:
 * /config/help/
 *   content-management.md
 *   content-types.md
 *   workflow.md
 *   ...
 *
 * Each help file contains frontmatter with metadata plus markdown content.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

/**
 * Configuration
 */
let config = {
  enabled: true,
  helpDir: 'config/help',
  maxSearchResults: 20,
};

/**
 * Base directory and service references
 */
let baseDir = null;
let hooksService = null;

/**
 * In-memory help registry
 * Structure: { topicId: { id, title, module, route, content, related, keywords, ... } }
 */
const topics = {};

/**
 * Route to topic mapping
 * Structure: { route: topicId }
 */
const routeMap = {};

/**
 * Module to topics mapping
 * Structure: { module: [topicId, ...] }
 */
const moduleMap = {};

/**
 * CLI command help registry
 * Structure: { command: helpText }
 */
const cliHelp = {};

/**
 * Initialize help system
 *
 * @param {string} dir - Base directory
 * @param {Object} helpConfig - Help configuration
 * @param {Object} hooks - Hooks service reference
 */
export function init(dir, helpConfig = {}, hooks = null) {
  baseDir = dir;
  hooksService = hooks;

  // Merge config
  config = { ...config, ...helpConfig };

  // Ensure help directory exists
  const helpPath = join(baseDir, config.helpDir);
  if (!existsSync(helpPath)) {
    mkdirSync(helpPath, { recursive: true });
  }

  // Load help topics from disk
  loadHelpTopics();
}

/**
 * Load all help topic files from config/help
 * @private
 */
function loadHelpTopics() {
  const helpPath = join(baseDir, config.helpDir);
  if (!existsSync(helpPath)) return;

  const files = readdirSync(helpPath).filter(f => f.endsWith('.md'));

  for (const file of files) {
    const filePath = join(helpPath, file);
    const topicId = basename(file, '.md');

    try {
      const content = readFileSync(filePath, 'utf-8');
      const topic = parseHelpFile(topicId, content);
      registerTopic(topicId, topic);
    } catch (error) {
      console.warn(`[help] Failed to load topic ${topicId}: ${error.message}`);
    }
  }
}

/**
 * Parse help file with frontmatter
 *
 * Format:
 * ---
 * title: Content Management
 * module: admin
 * route: /admin/content
 * related: content-types, workflow
 * keywords: content, create, edit
 * ---
 * ## Content
 *
 * @param {string} id - Topic ID
 * @param {string} content - File content
 * @returns {Object} - Parsed topic
 * @private
 */
function parseHelpFile(id, content) {
  const topic = {
    id,
    title: id.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    module: null,
    route: null,
    content: content,
    related: [],
    keywords: [],
  };

  // Check for frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (frontmatterMatch) {
    const [, frontmatter, body] = frontmatterMatch;
    topic.content = body.trim();

    // Parse frontmatter
    const lines = frontmatter.split('\n');
    for (const line of lines) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (!match) continue;

      const [, key, value] = match;
      switch (key) {
        case 'title':
          topic.title = value;
          break;
        case 'module':
          topic.module = value;
          break;
        case 'route':
          topic.route = value;
          break;
        case 'related':
          topic.related = value.split(',').map(s => s.trim());
          break;
        case 'keywords':
          topic.keywords = value.split(',').map(s => s.trim());
          break;
      }
    }
  }

  return topic;
}

/**
 * Register a help topic
 *
 * @param {string} id - Unique topic ID
 * @param {Object} topicConfig - Topic configuration
 * @param {string} topicConfig.title - Topic title
 * @param {string} topicConfig.module - Module name
 * @param {string} topicConfig.route - Associated route
 * @param {string} topicConfig.content - Markdown content
 * @param {string[]} topicConfig.related - Related topic IDs
 * @param {string[]} topicConfig.keywords - Search keywords
 */
export function registerTopic(id, topicConfig) {
  const topic = {
    id,
    title: topicConfig.title || id,
    module: topicConfig.module || null,
    route: topicConfig.route || null,
    content: topicConfig.content || '',
    related: topicConfig.related || [],
    keywords: topicConfig.keywords || [],
  };

  topics[id] = topic;

  // Build route mapping
  if (topic.route) {
    routeMap[topic.route] = id;
  }

  // Build module mapping
  if (topic.module) {
    if (!moduleMap[topic.module]) {
      moduleMap[topic.module] = [];
    }
    if (!moduleMap[topic.module].includes(id)) {
      moduleMap[topic.module].push(id);
    }
  }
}

/**
 * Get a help topic by ID
 *
 * @param {string} id - Topic ID
 * @returns {Object|null} - Topic data or null if not found
 */
export function getTopic(id) {
  return topics[id] || null;
}

/**
 * Get help topic for a specific route
 *
 * @param {string} route - Route path
 * @returns {Object|null} - Topic data or null if not found
 */
export function getTopicForRoute(route) {
  const topicId = routeMap[route];
  return topicId ? topics[topicId] : null;
}

/**
 * Search help topics
 *
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @param {string} options.module - Filter by module
 * @param {number} options.limit - Max results
 * @returns {Array} - Matching topics with relevance scores
 */
export function searchTopics(query, options = {}) {
  const { module = null, limit = config.maxSearchResults } = options;

  if (!query || typeof query !== 'string') {
    return [];
  }

  const queryLower = query.toLowerCase();
  const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 2);

  if (queryTerms.length === 0) {
    return [];
  }

  const results = [];

  for (const [id, topic] of Object.entries(topics)) {
    // Filter by module if specified
    if (module && topic.module !== module) continue;

    let score = 0;

    // Title match (highest weight)
    const titleLower = topic.title.toLowerCase();
    for (const term of queryTerms) {
      if (titleLower.includes(term)) {
        score += 10;
        if (titleLower.startsWith(term)) {
          score += 5;
        }
      }
    }

    // Keyword match (medium weight)
    for (const keyword of topic.keywords) {
      const keywordLower = keyword.toLowerCase();
      for (const term of queryTerms) {
        if (keywordLower.includes(term)) {
          score += 5;
        }
      }
    }

    // Content match (lower weight)
    const contentLower = topic.content.toLowerCase();
    for (const term of queryTerms) {
      const matches = (contentLower.match(new RegExp(term, 'g')) || []).length;
      score += matches * 0.5;
    }

    if (score > 0) {
      results.push({ ...topic, score });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  // Trigger hook for custom scoring
  if (hooksService) {
    hooksService.trigger('help:search', { query, results, options });
  }

  return results.slice(0, limit);
}

/**
 * List all help topics
 *
 * @returns {Array} - All topics
 */
export function listTopics() {
  return Object.values(topics).sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Get help topics for a specific module
 *
 * @param {string} module - Module name
 * @returns {Array} - Topics for this module
 */
export function getTopicsByModule(module) {
  const topicIds = moduleMap[module] || [];
  return topicIds.map(id => topics[id]).filter(Boolean);
}

/**
 * Get related topics for a topic
 *
 * @param {string} id - Topic ID
 * @returns {Array} - Related topics
 */
export function getRelatedTopics(id) {
  const topic = topics[id];
  if (!topic) return [];

  return topic.related
    .map(relatedId => topics[relatedId])
    .filter(Boolean);
}

/**
 * Render help topic to HTML
 *
 * @param {string} id - Topic ID
 * @returns {string|null} - Rendered HTML or null if not found
 */
export function renderTopic(id) {
  const topic = topics[id];
  if (!topic) return null;

  // Simple markdown to HTML conversion
  let html = topic.content;

  // Allow hooks to customize rendering
  if (hooksService) {
    const context = { topic, html };
    hooksService.trigger('help:render', context);
    html = context.html;
  } else {
    // Basic markdown rendering
    html = markdownToHtml(html);
  }

  return html;
}

/**
 * Simple markdown to HTML converter
 * @private
 */
function markdownToHtml(markdown) {
  let html = markdown;

  // Headers
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

  // Code blocks
  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Lists
  html = html.replace(/^\* (.*$)/gim, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

  // Paragraphs
  html = html.replace(/\n\n/g, '</p><p>');
  html = '<p>' + html + '</p>';

  // Clean up empty paragraphs
  html = html.replace(/<p><\/p>/g, '');
  html = html.replace(/<p>(<h[1-6]>)/g, '$1');
  html = html.replace(/(<\/h[1-6]>)<\/p>/g, '$1');
  html = html.replace(/<p>(<ul>)/g, '$1');
  html = html.replace(/(<\/ul>)<\/p>/g, '$1');
  html = html.replace(/<p>(<pre>)/g, '$1');
  html = html.replace(/(<\/pre>)<\/p>/g, '$1');

  return html;
}

/**
 * Get help index for admin page
 * Organized by module
 *
 * @returns {Object} - Structured help index
 */
export function getHelpIndex() {
  const index = {
    modules: {},
    ungrouped: [],
  };

  for (const topic of Object.values(topics)) {
    if (topic.module) {
      if (!index.modules[topic.module]) {
        index.modules[topic.module] = {
          name: topic.module,
          topics: [],
        };
      }
      index.modules[topic.module].topics.push({
        id: topic.id,
        title: topic.title,
        route: topic.route,
      });
    } else {
      index.ungrouped.push({
        id: topic.id,
        title: topic.title,
        route: topic.route,
      });
    }
  }

  // Sort topics within each module
  for (const module of Object.values(index.modules)) {
    module.topics.sort((a, b) => a.title.localeCompare(b.title));
  }

  index.ungrouped.sort((a, b) => a.title.localeCompare(b.title));

  return index;
}

/**
 * Register CLI command help
 *
 * @param {string} command - Command name
 * @param {string} helpText - Help text for the command
 */
export function registerCLIHelp(command, helpText) {
  cliHelp[command] = helpText;
}

/**
 * Get CLI command help
 *
 * @param {string} command - Command name
 * @returns {string|null} - Help text or null if not found
 */
export function getCLIHelp(command) {
  return cliHelp[command] || null;
}

/**
 * Get all CLI commands with help
 *
 * @returns {Object} - Command to help text mapping
 */
export function listCLIHelp() {
  return { ...cliHelp };
}

/**
 * Check if help system is enabled
 *
 * @returns {boolean}
 */
export function isEnabled() {
  return config.enabled;
}

/**
 * Get help system statistics
 *
 * @returns {Object}
 */
export function getStats() {
  return {
    enabled: config.enabled,
    totalTopics: Object.keys(topics).length,
    moduleCount: Object.keys(moduleMap).length,
    routeMappings: Object.keys(routeMap).length,
    cliCommands: Object.keys(cliHelp).length,
  };
}
