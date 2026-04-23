/**
 * help.ts - Integrated Help System
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

// ============================================================================
// Types
// ============================================================================

/** Help system configuration */
interface HelpConfig {
  enabled: boolean;
  helpDir: string;
  maxSearchResults: number;
}

/** A registered help topic */
interface HelpTopic {
  id: string;
  title: string;
  module: string | null;
  route: string | null;
  content: string;
  related: string[];
  keywords: string[];
}

/** A topic enriched with a relevance score for search results */
interface ScoredTopic extends HelpTopic {
  score: number;
}

/** Options for searchTopics */
interface SearchOptions {
  module?: string | null;
  limit?: number;
}

/** Hooks service — only the `trigger` method is used here */
interface HooksService {
  trigger(event: string, context: Record<string, unknown>): void;
}

/** Index for grouped help output */
interface HelpIndex {
  modules: Record<string, { name: string; topics: Array<{ id: string; title: string; route: string | null }> }>;
  ungrouped: Array<{ id: string; title: string; route: string | null }>;
}

// ============================================================================
// Module state
// ============================================================================

/**
 * Configuration
 */
let config: HelpConfig = {
  enabled: true,
  helpDir: 'config/help',
  maxSearchResults: 20,
};

/**
 * Base directory and service references
 */
let baseDir: string | null = null;
let hooksService: HooksService | null = null;

/**
 * In-memory help registry
 * Structure: { topicId: { id, title, module, route, content, related, keywords, ... } }
 */
const topics: Record<string, HelpTopic> = {};

/**
 * Route to topic mapping
 * Structure: { route: topicId }
 */
const routeMap: Record<string, string> = {};

/**
 * Module to topics mapping
 * Structure: { module: [topicId, ...] }
 */
const moduleMap: Record<string, string[]> = {};

/**
 * CLI command help registry
 * Structure: { command: helpText }
 */
const cliHelp: Record<string, string> = {};

/**
 * Initialize help system
 */
export function init(dir: string, helpConfig: Partial<HelpConfig> = {}, hooks: HooksService | null = null): void {
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
 */
function loadHelpTopics(): void {
  if (!baseDir) return;
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
      console.warn(`[help] Failed to load topic ${topicId}: ${(error as Error).message}`);
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
 */
function parseHelpFile(id: string, content: string): HelpTopic {
  const topic: HelpTopic = {
    id,
    title: id.replace(/-/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()),
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
    topic.content = (body ?? '').trim();

    // Parse frontmatter
    const lines = (frontmatter ?? '').split('\n');
    for (const line of lines) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (!match) continue;

      const key = match[1] as string;
      const value = match[2] as string;
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
          topic.related = value.split(',').map((s: string) => s.trim());
          break;
        case 'keywords':
          topic.keywords = value.split(',').map((s: string) => s.trim());
          break;
      }
    }
  }

  return topic;
}

/**
 * Register a help topic
 */
export function registerTopic(id: string, topicConfig: Partial<HelpTopic>): void {
  const topic: HelpTopic = {
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
    const modEntry = moduleMap[topic.module];
    if (!modEntry) {
      moduleMap[topic.module] = [];
    }
    if (!moduleMap[topic.module]!.includes(id)) {
      moduleMap[topic.module]!.push(id);
    }
  }
}

/**
 * Get a help topic by ID
 */
export function getTopic(id: string): HelpTopic | null {
  return topics[id] ?? null;
}

/**
 * Get help topic for a specific route
 */
export function getTopicForRoute(route: string): HelpTopic | null {
  const topicId = routeMap[route];
  return topicId ? (topics[topicId] ?? null) : null;
}

/**
 * Search help topics
 */
export function searchTopics(query: string, options: SearchOptions = {}): ScoredTopic[] {
  const { module = null, limit = config.maxSearchResults } = options;

  if (!query || typeof query !== 'string') {
    return [];
  }

  const queryLower = query.toLowerCase();
  const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 2);

  if (queryTerms.length === 0) {
    return [];
  }

  const results: ScoredTopic[] = [];

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
 */
export function listTopics(): HelpTopic[] {
  return Object.values(topics).sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Get help topics for a specific module
 */
export function getTopicsByModule(module: string): HelpTopic[] {
  const topicIds = moduleMap[module] || [];
  return topicIds.map((id) => topics[id]).filter((t): t is HelpTopic => t !== undefined);
}

/**
 * Get related topics for a topic
 */
export function getRelatedTopics(id: string): HelpTopic[] {
  const topic = topics[id];
  if (!topic) return [];

  return topic.related
    .map((relatedId) => topics[relatedId])
    .filter((t): t is HelpTopic => t !== undefined);
}

/**
 * Render help topic to HTML
 */
export function renderTopic(id: string): string | null {
  const topic = topics[id];
  if (!topic) return null;

  // Simple markdown to HTML conversion
  let html = topic.content;

  // Allow hooks to customize rendering
  if (hooksService) {
    const context: Record<string, unknown> = { topic, html };
    hooksService.trigger('help:render', context);
    html = context['html'] as string;
  } else {
    // Basic markdown rendering
    html = markdownToHtml(html);
  }

  return html;
}

/**
 * Simple markdown to HTML converter
 */
function markdownToHtml(markdown: string): string {
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
 */
export function getHelpIndex(): HelpIndex {
  const index: HelpIndex = {
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
      index.modules[topic.module]!.topics.push({
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
 */
export function registerCLIHelp(command: string, helpText: string): void {
  cliHelp[command] = helpText;
}

/**
 * Get CLI command help
 */
export function getCLIHelp(command: string): string | null {
  return cliHelp[command] ?? null;
}

/**
 * Get all CLI commands with help
 */
export function listCLIHelp(): Record<string, string> {
  return { ...cliHelp };
}

/**
 * Check if help system is enabled
 */
export function isEnabled(): boolean {
  return config.enabled;
}

/**
 * Get help system statistics
 */
export function getStats(): Record<string, number | boolean> {
  return {
    enabled: config.enabled,
    totalTopics: Object.keys(topics).length,
    moduleCount: Object.keys(moduleMap).length,
    routeMappings: Object.keys(routeMap).length,
    cliCommands: Object.keys(cliHelp).length,
  };
}
