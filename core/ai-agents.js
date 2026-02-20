/**
 * ai-agents.js - AI Agents Framework
 *
 * WHY THIS EXISTS:
 * Drupal's ai_agents module provides autonomous AI entities that use tools
 * to accomplish tasks (auto-fill fields, generate SEO, moderate content).
 * This is CMS Core's equivalent.
 *
 * HOW IT WORKS:
 * Agents are registered with a system prompt, tools, and configuration.
 * When executed, the agent:
 * 1. Receives user input + context
 * 2. Sends a chat message to the AI provider with its system prompt + tools
 * 3. AI responds with tool calls or direct output
 * 4. Agent executes tool calls and feeds results back
 * 5. Loop until AI produces a final response (max iterations to prevent runaway)
 *
 * TOOL SYSTEM:
 * Tools are functions the AI can call: { name, description, parameters, execute }
 * Built-in tools provide CMS operations (read/list/create/update content).
 * Modules can register additional tools.
 *
 * Drupal parity: equivalent to drupal/ai_agents with AiAgent plugins.
 */

// Agent registry
const agents = new Map();

// Tool registry
const tools = new Map();

// Service references
let contentService = null;
let aiProviderManager = null;
let seoService = null;

const MAX_TOOL_ITERATIONS = 5;

/**
 * Initialize the AI Agents framework.
 * @param {Object} ctx - Boot context with services
 */
export function init(ctx) {
  contentService = ctx?.services?.get?.('content');
  aiProviderManager = ctx?.services?.get?.('ai-provider-manager');
  seoService = ctx?.services?.get?.('seo');

  registerBuiltinTools();
  registerBuiltinAgents();

  console.log(`[ai-agents] Initialized (${agents.size} agents, ${tools.size} tools)`);
}

// ========================================
// Tool Registration
// ========================================

function registerBuiltinTools() {
  registerTool({
    name: 'readContent',
    description: 'Read a single content item by type and ID',
    parameters: {
      type: { type: 'string', description: 'Content type (e.g., "article", "page")', required: true },
      id: { type: 'string', description: 'Content item ID', required: true }
    },
    execute: (params) => {
      if (!contentService) return { error: 'Content service not available' };
      const item = contentService.get(params.type, params.id);
      return item || { error: `Not found: ${params.type}/${params.id}` };
    }
  });

  registerTool({
    name: 'listContent',
    description: 'List content items of a given type with optional filters',
    parameters: {
      type: { type: 'string', description: 'Content type', required: true },
      limit: { type: 'number', description: 'Max items to return (default 10)' },
      status: { type: 'string', description: 'Filter by status (e.g., "published")' }
    },
    execute: (params) => {
      if (!contentService) return { error: 'Content service not available' };
      const result = contentService.list(params.type);
      let items = result.items || [];
      if (params.status) {
        items = items.filter(i => i.status === params.status);
      }
      const limit = params.limit || 10;
      return { items: items.slice(0, limit), total: items.length };
    }
  });

  registerTool({
    name: 'createContent',
    description: 'Create a new content item',
    parameters: {
      type: { type: 'string', description: 'Content type', required: true },
      data: { type: 'object', description: 'Content data object', required: true }
    },
    execute: async (params) => {
      if (!contentService) return { error: 'Content service not available' };
      const item = await contentService.create(params.type, params.data);
      return { id: item.id, created: true };
    }
  });

  registerTool({
    name: 'updateContent',
    description: 'Update an existing content item',
    parameters: {
      type: { type: 'string', description: 'Content type', required: true },
      id: { type: 'string', description: 'Content item ID', required: true },
      data: { type: 'object', description: 'Fields to update', required: true }
    },
    execute: async (params) => {
      if (!contentService) return { error: 'Content service not available' };
      await contentService.update(params.type, params.id, params.data);
      return { id: params.id, updated: true };
    }
  });

  registerTool({
    name: 'getContentTypeSchema',
    description: 'Get the field schema for a content type',
    parameters: {
      type: { type: 'string', description: 'Content type name', required: true }
    },
    execute: (params) => {
      if (!contentService) return { error: 'Content service not available' };
      const types = contentService.getContentTypes?.() || {};
      const schema = types[params.type];
      return schema || { error: `Unknown content type: ${params.type}` };
    }
  });

  registerTool({
    name: 'analyzeSeo',
    description: 'Run SEO analysis on content text',
    parameters: {
      title: { type: 'string', description: 'Content title', required: true },
      body: { type: 'string', description: 'Content body HTML', required: true },
      keyword: { type: 'string', description: 'Focus keyword' }
    },
    execute: (params) => {
      if (!seoService?.analyze) return { error: 'SEO service not available' };
      return seoService.analyze(params);
    }
  });
}

// ========================================
// Agent Registration
// ========================================

function registerBuiltinAgents() {
  // Field Agent — auto-fills content fields based on title and content type
  registerAgent('field-agent', {
    name: 'Field Agent',
    description: 'Auto-fills content fields based on title and content type context',
    systemPrompt: `You are a content field assistant for a CMS. Given a content type schema and a title, generate appropriate values for each field. Return a JSON object with field names as keys and generated values as values. Be concise and relevant. For body fields, write 2-3 paragraphs of relevant content. For summary fields, write 1-2 sentences.`,
    tools: ['getContentTypeSchema', 'listContent']
  });

  // SEO Agent — generates meta descriptions and suggests improvements
  registerAgent('seo-agent', {
    name: 'SEO Agent',
    description: 'Analyzes content and provides SEO recommendations',
    systemPrompt: `You are an SEO specialist for a CMS. Analyze the provided content and return JSON with: { "metaDescription": "...", "suggestions": ["..."], "score": 0-100, "keywords": ["..."] }. Focus on: title optimization, keyword usage, readability, meta description quality, heading structure.`,
    tools: ['readContent', 'analyzeSeo', 'listContent']
  });

  // Content Moderator — reviews content for policy compliance
  registerAgent('content-moderator', {
    name: 'Content Moderator',
    description: 'Reviews content for policy compliance, profanity, and quality issues',
    systemPrompt: `You are a content moderator for a CMS. Review the provided content and return JSON with: { "approved": true/false, "issues": [{ "type": "profanity|spam|quality|policy", "severity": "low|medium|high", "description": "..." }], "score": 0-100, "recommendation": "approve|review|reject" }. Flag profanity, spam patterns, very low quality content, and potential policy violations. Be reasonable — not every minor issue should block publication.`,
    tools: ['readContent', 'listContent']
  });

  // Taxonomy Tagger — auto-suggests tags and categories
  registerAgent('taxonomy-tagger', {
    name: 'Taxonomy Tagger',
    description: 'Automatically suggests tags and categories based on content analysis',
    systemPrompt: `You are a taxonomy specialist for a CMS. Analyze the provided content and suggest relevant tags and categories. Return JSON with: { "suggestedTags": ["tag1", "tag2"], "suggestedCategories": ["cat1"], "confidence": 0-100, "reasoning": "..." }. Use existing tags when possible. Suggest 3-7 tags that accurately describe the content topic, audience, and format.`,
    tools: ['readContent', 'listContent', 'getContentTypeSchema']
  });

  // Translation Agent — provides content translation suggestions
  registerAgent('translation-agent', {
    name: 'Translation Agent',
    description: 'Translates content fields to a target language',
    systemPrompt: `You are a professional translator for a CMS. Translate the provided content into the requested target language. Return JSON with: { "translations": { "fieldName": "translated value", ... }, "sourceLanguage": "detected language", "targetLanguage": "requested language", "confidence": 0-100 }. Preserve HTML tags. Maintain tone and style. Adapt cultural references where appropriate.`,
    tools: ['readContent', 'getContentTypeSchema']
  });

  // Accessibility Checker — audits content for a11y issues
  registerAgent('accessibility-checker', {
    name: 'Accessibility Checker',
    description: 'Audits content for accessibility issues and WCAG compliance',
    systemPrompt: `You are an accessibility specialist auditing CMS content for WCAG 2.1 compliance. Analyze the provided content and return JSON with: { "score": 0-100, "level": "A|AA|AAA", "issues": [{ "type": "alt-text|heading-order|color-contrast|link-text|language", "severity": "error|warning|notice", "field": "...", "description": "...", "suggestion": "..." }], "passed": ["check1", "check2"] }. Check: images without alt text, heading hierarchy, link text quality, reading level, semantic HTML usage.`,
    tools: ['readContent', 'listContent']
  });

  // Content Summarizer — generates summaries and abstracts
  registerAgent('content-summarizer', {
    name: 'Content Summarizer',
    description: 'Generates summaries, excerpts, and social media descriptions',
    systemPrompt: `You are a content editor for a CMS. Generate various summaries of the provided content. Return JSON with: { "summary": "2-3 sentence summary", "excerpt": "1 sentence excerpt", "socialMedia": { "twitter": "280 char max", "facebook": "longer social description", "linkedin": "professional summary" }, "keywords": ["key", "terms"] }. Maintain the original tone. Highlight key points. Make social descriptions engaging.`,
    tools: ['readContent', 'getContentTypeSchema']
  });
}

// ========================================
// Public API
// ========================================

/**
 * Register a new agent.
 * @param {string} id - Unique agent identifier
 * @param {Object} config - Agent configuration
 * @param {string} config.name - Human-readable name
 * @param {string} config.description - What this agent does
 * @param {string} config.systemPrompt - System prompt for the AI
 * @param {string[]} config.tools - Tool names this agent can use
 */
export function registerAgent(id, config) {
  agents.set(id, { id, ...config });
}

/**
 * Register a new tool.
 * @param {Object} tool - Tool definition
 * @param {string} tool.name - Unique tool name
 * @param {string} tool.description - What this tool does
 * @param {Object} tool.parameters - Parameter schema
 * @param {Function} tool.execute - Implementation function
 */
export function registerTool(tool) {
  tools.set(tool.name, tool);
}

/**
 * Get an agent by ID.
 */
export function getAgent(id) {
  return agents.get(id);
}

/**
 * List all registered agents.
 */
export function listAgents() {
  return Array.from(agents.values()).map(a => ({
    id: a.id,
    name: a.name,
    description: a.description,
    tools: a.tools || []
  }));
}

/**
 * List all registered tools.
 */
export function listTools() {
  return Array.from(tools.values()).map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters
  }));
}

/**
 * Execute an agent with the given input.
 * @param {string} agentId - Agent to execute
 * @param {string} input - User input/prompt
 * @param {Object} context - Additional context (content type, content ID, etc.)
 * @returns {Promise<{ result: string, toolCalls: Array }>}
 */
export async function executeAgent(agentId, input, context = {}) {
  const agent = agents.get(agentId);
  if (!agent) {
    throw new Error(`Unknown agent: ${agentId}`);
  }

  if (!aiProviderManager) {
    throw new Error('AI provider manager not available');
  }

  // Build tool definitions for the AI provider
  const agentTools = (agent.tools || [])
    .map(name => tools.get(name))
    .filter(Boolean)
    .map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }));

  // Build messages
  const messages = [
    { role: 'system', content: agent.systemPrompt },
    { role: 'user', content: buildUserMessage(input, context) }
  ];

  const toolCallLog = [];

  // Agent loop: send to AI, handle tool calls, repeat
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    let response;
    try {
      response = await aiProviderManager.routeToProvider(
        'chat',
        [messages, { tools: agentTools.length > 0 ? agentTools : undefined }],
        context.model || null
      );
    } catch (err) {
      return { result: `AI provider error: ${err.message}`, toolCalls: toolCallLog, error: true };
    }

    // If the response contains tool calls, execute them
    if (response?.toolCalls && response.toolCalls.length > 0) {
      for (const call of response.toolCalls) {
        const tool = tools.get(call.name);
        if (!tool) {
          messages.push({ role: 'tool', name: call.name, content: JSON.stringify({ error: `Unknown tool: ${call.name}` }) });
          continue;
        }

        try {
          const result = await tool.execute(call.arguments || {});
          toolCallLog.push({ tool: call.name, args: call.arguments, result });
          messages.push({ role: 'tool', name: call.name, content: JSON.stringify(result) });
        } catch (err) {
          const errorResult = { error: err.message };
          toolCallLog.push({ tool: call.name, args: call.arguments, result: errorResult });
          messages.push({ role: 'tool', name: call.name, content: JSON.stringify(errorResult) });
        }
      }
      continue; // Let AI process tool results
    }

    // No tool calls — this is the final response
    const text = response?.content || response?.message || response?.text || JSON.stringify(response);
    return { result: text, toolCalls: toolCallLog };
  }

  return { result: 'Agent reached maximum iterations without completing.', toolCalls: toolCallLog, error: true };
}

/**
 * Build the user message with context.
 */
function buildUserMessage(input, context) {
  let msg = input;
  if (context.contentType) {
    msg += `\n\nContent type: ${context.contentType}`;
  }
  if (context.contentId) {
    msg += `\nContent ID: ${context.contentId}`;
  }
  if (context.additionalContext) {
    msg += `\n\n${context.additionalContext}`;
  }
  return msg;
}
