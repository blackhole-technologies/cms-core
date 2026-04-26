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

// ============================================================================
// Types
// ============================================================================

/** Tool parameter schema */
interface ToolParameter {
  type: string;
  description: string;
  required?: boolean;
}

/** Tool definition */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  execute: (params: Record<string, unknown>) => unknown | Promise<unknown>;
}

/** Tool summary (without execute function) */
interface ToolSummary {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
}

/** Agent configuration */
export interface AgentConfig {
  name: string;
  description: string;
  systemPrompt: string;
  tools?: string[];
}

/** Registered agent entry (config with ID) */
interface AgentEntry extends AgentConfig {
  id: string;
}

/** Agent summary for listing */
interface AgentSummary {
  id: string;
  name: string;
  description: string;
  tools: string[];
}

/** Tool call from AI provider response */
interface ToolCall {
  name: string;
  arguments?: Record<string, unknown>;
}

/** Tool call log entry */
interface ToolCallLogEntry {
  tool: string;
  args: Record<string, unknown> | undefined;
  result: unknown;
}

/** Agent execution result */
interface AgentResult {
  result: string;
  toolCalls: ToolCallLogEntry[];
  error?: boolean;
}

/** AI provider response */
interface AIProviderResponse {
  toolCalls?: ToolCall[];
  content?: string;
  message?: string;
  text?: string;
  [key: string]: unknown;
}

/** Execution context */
interface ExecutionContext {
  model?: string | null;
  contentType?: string;
  contentId?: string;
  additionalContext?: string;
  [key: string]: unknown;
}

/** Chat message */
interface ChatMessage {
  role: string;
  content: string;
  name?: string;
  timestamp?: string;
}

/** Thread storage entry */
interface ThreadEntry {
  messages: ChatMessage[];
  systemPrompt: string;
  agentId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Thread creation options */
interface ThreadOptions {
  systemPrompt?: string;
  agentId?: string;
}

/** Thread creation result */
interface ThreadCreateResult {
  threadId: string;
  createdAt: string;
}

/** Thread info */
interface ThreadInfo {
  threadId: string;
  messages: ChatMessage[];
  agentId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Thread listing entry */
interface ThreadListEntry {
  threadId: string;
  messageCount: number;
  agentId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Send message result */
interface SendMessageResult {
  response: string;
  threadId: string;
  messageCount: number;
}

/** Content service interface */
interface ContentService {
  get: (type: string, id: string) => Record<string, unknown> | null;
  list: (type: string) => { items: Record<string, unknown>[] };
  create: (type: string, data: Record<string, unknown>) => Promise<{ id: string }>;
  update: (type: string, id: string, data: Record<string, unknown>) => Promise<void>;
  getContentTypes?: () => Record<string, unknown>;
}

/** SEO service interface */
interface SeoService {
  analyze?: (params: Record<string, unknown>) => unknown;
}

/** AI provider manager interface */
interface AIProviderManagerRef {
  routeToProvider: (
    operation: string,
    args: unknown[],
    model: unknown
  ) => Promise<AIProviderResponse>;
}

/** Boot context */
interface BootContext {
  services?: {
    get?: (name: string) => unknown;
  };
}

// ============================================================================
// State
// ============================================================================

// Agent registry
const agents: Map<string, AgentEntry> = new Map();

// Tool registry
const tools: Map<string, ToolDefinition> = new Map();

// Service references
let contentService: ContentService | null = null;
let aiProviderManager: AIProviderManagerRef | null = null;
let seoService: SeoService | null = null;

const MAX_TOOL_ITERATIONS: number = 5;

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Register built-in tools for CMS operations
 */
function registerBuiltinTools(): void {
  registerTool({
    name: 'readContent',
    description: 'Read a single content item by type and ID',
    parameters: {
      type: {
        type: 'string',
        description: 'Content type (e.g., "article", "page")',
        required: true,
      },
      id: { type: 'string', description: 'Content item ID', required: true },
    },
    execute: (params) => {
      if (!contentService) return { error: 'Content service not available' };
      const item = contentService.get(params.type as string, params.id as string);
      return item || { error: `Not found: ${params.type}/${params.id}` };
    },
  });

  registerTool({
    name: 'listContent',
    description: 'List content items of a given type with optional filters',
    parameters: {
      type: { type: 'string', description: 'Content type', required: true },
      limit: { type: 'number', description: 'Max items to return (default 10)' },
      status: { type: 'string', description: 'Filter by status (e.g., "published")' },
    },
    execute: (params) => {
      if (!contentService) return { error: 'Content service not available' };
      const result = contentService.list(params.type as string);
      let items = result.items || [];
      if (params.status) {
        items = items.filter((i) => i.status === params.status);
      }
      const limit = (params.limit as number) || 10;
      return { items: items.slice(0, limit), total: items.length };
    },
  });

  registerTool({
    name: 'createContent',
    description: 'Create a new content item',
    parameters: {
      type: { type: 'string', description: 'Content type', required: true },
      data: { type: 'object', description: 'Content data object', required: true },
    },
    execute: async (params) => {
      if (!contentService) return { error: 'Content service not available' };
      const item = await contentService.create(
        params.type as string,
        params.data as Record<string, unknown>
      );
      return { id: item.id, created: true };
    },
  });

  registerTool({
    name: 'updateContent',
    description: 'Update an existing content item',
    parameters: {
      type: { type: 'string', description: 'Content type', required: true },
      id: { type: 'string', description: 'Content item ID', required: true },
      data: { type: 'object', description: 'Fields to update', required: true },
    },
    execute: async (params) => {
      if (!contentService) return { error: 'Content service not available' };
      await contentService.update(
        params.type as string,
        params.id as string,
        params.data as Record<string, unknown>
      );
      return { id: params.id, updated: true };
    },
  });

  registerTool({
    name: 'getContentTypeSchema',
    description: 'Get the field schema for a content type',
    parameters: {
      type: { type: 'string', description: 'Content type name', required: true },
    },
    execute: (params) => {
      if (!contentService) return { error: 'Content service not available' };
      const types = contentService.getContentTypes?.() || {};
      const schema = types[params.type as string];
      return schema || { error: `Unknown content type: ${params.type}` };
    },
  });

  registerTool({
    name: 'analyzeSeo',
    description: 'Run SEO analysis on content text',
    parameters: {
      title: { type: 'string', description: 'Content title', required: true },
      body: { type: 'string', description: 'Content body HTML', required: true },
      keyword: { type: 'string', description: 'Focus keyword' },
    },
    execute: (params) => {
      if (!seoService?.analyze) return { error: 'SEO service not available' };
      return seoService.analyze(params as Record<string, unknown>);
    },
  });
}

/**
 * Register built-in agents for common CMS tasks
 */
function registerBuiltinAgents(): void {
  registerAgent('field-agent', {
    name: 'Field Agent',
    description: 'Auto-fills content fields based on title and content type context',
    systemPrompt: `You are a content field assistant for a CMS. Given a content type schema and a title, generate appropriate values for each field. Return a JSON object with field names as keys and generated values as values. Be concise and relevant. For body fields, write 2-3 paragraphs of relevant content. For summary fields, write 1-2 sentences.`,
    tools: ['getContentTypeSchema', 'listContent'],
  });

  registerAgent('seo-agent', {
    name: 'SEO Agent',
    description: 'Analyzes content and provides SEO recommendations',
    systemPrompt: `You are an SEO specialist for a CMS. Analyze the provided content and return JSON with: { "metaDescription": "...", "suggestions": ["..."], "score": 0-100, "keywords": ["..."] }. Focus on: title optimization, keyword usage, readability, meta description quality, heading structure.`,
    tools: ['readContent', 'analyzeSeo', 'listContent'],
  });

  registerAgent('content-moderator', {
    name: 'Content Moderator',
    description: 'Reviews content for policy compliance, profanity, and quality issues',
    systemPrompt: `You are a content moderator for a CMS. Review the provided content and return JSON with: { "approved": true/false, "issues": [{ "type": "profanity|spam|quality|policy", "severity": "low|medium|high", "description": "..." }], "score": 0-100, "recommendation": "approve|review|reject" }. Flag profanity, spam patterns, very low quality content, and potential policy violations. Be reasonable — not every minor issue should block publication.`,
    tools: ['readContent', 'listContent'],
  });

  registerAgent('taxonomy-tagger', {
    name: 'Taxonomy Tagger',
    description: 'Automatically suggests tags and categories based on content analysis',
    systemPrompt: `You are a taxonomy specialist for a CMS. Analyze the provided content and suggest relevant tags and categories. Return JSON with: { "suggestedTags": ["tag1", "tag2"], "suggestedCategories": ["cat1"], "confidence": 0-100, "reasoning": "..." }. Use existing tags when possible. Suggest 3-7 tags that accurately describe the content topic, audience, and format.`,
    tools: ['readContent', 'listContent', 'getContentTypeSchema'],
  });

  registerAgent('translation-agent', {
    name: 'Translation Agent',
    description: 'Translates content fields to a target language',
    systemPrompt: `You are a professional translator for a CMS. Translate the provided content into the requested target language. Return JSON with: { "translations": { "fieldName": "translated value", ... }, "sourceLanguage": "detected language", "targetLanguage": "requested language", "confidence": 0-100 }. Preserve HTML tags. Maintain tone and style. Adapt cultural references where appropriate.`,
    tools: ['readContent', 'getContentTypeSchema'],
  });

  registerAgent('accessibility-checker', {
    name: 'Accessibility Checker',
    description: 'Audits content for accessibility issues and WCAG compliance',
    systemPrompt: `You are an accessibility specialist auditing CMS content for WCAG 2.1 compliance. Analyze the provided content and return JSON with: { "score": 0-100, "level": "A|AA|AAA", "issues": [{ "type": "alt-text|heading-order|color-contrast|link-text|language", "severity": "error|warning|notice", "field": "...", "description": "...", "suggestion": "..." }], "passed": ["check1", "check2"] }. Check: images without alt text, heading hierarchy, link text quality, reading level, semantic HTML usage.`,
    tools: ['readContent', 'listContent'],
  });

  registerAgent('content-summarizer', {
    name: 'Content Summarizer',
    description: 'Generates summaries, excerpts, and social media descriptions',
    systemPrompt: `You are a content editor for a CMS. Generate various summaries of the provided content. Return JSON with: { "summary": "2-3 sentence summary", "excerpt": "1 sentence excerpt", "socialMedia": { "twitter": "280 char max", "facebook": "longer social description", "linkedin": "professional summary" }, "keywords": ["key", "terms"] }. Maintain the original tone. Highlight key points. Make social descriptions engaging.`,
    tools: ['readContent', 'getContentTypeSchema'],
  });
}

/**
 * Build the user message with context.
 */
function buildUserMessage(input: string, context: ExecutionContext): string {
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

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize the AI Agents framework.
 * @param ctx - Boot context with services
 */
export function init(ctx: BootContext): void {
  contentService = ctx?.services?.get?.('content') as ContentService | null;
  aiProviderManager = ctx?.services?.get?.('ai-provider-manager') as AIProviderManagerRef | null;
  try {
    seoService = ctx?.services?.get?.('seo') as SeoService | null;
  } catch {
    seoService = null;
  }

  registerBuiltinTools();
  registerBuiltinAgents();

  console.log(`[ai-agents] Initialized (${agents.size} agents, ${tools.size} tools)`);
}

/**
 * Register a new agent.
 * @param id - Unique agent identifier
 * @param config - Agent configuration
 */
export function registerAgent(id: string, config: AgentConfig): void {
  agents.set(id, { id, ...config });
}

/**
 * Register a new tool.
 * @param tool - Tool definition
 */
export function registerTool(tool: ToolDefinition): void {
  tools.set(tool.name, tool);
}

/**
 * Get an agent by ID.
 */
export function getAgent(id: string): AgentEntry | undefined {
  return agents.get(id);
}

/**
 * List all registered agents.
 */
export function listAgents(): AgentSummary[] {
  return Array.from(agents.values()).map((a) => ({
    id: a.id,
    name: a.name,
    description: a.description,
    tools: a.tools || [],
  }));
}

/**
 * List all registered tools.
 */
export function listTools(): ToolSummary[] {
  return Array.from(tools.values()).map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

/**
 * Execute an agent with the given input.
 * @param agentId - Agent to execute
 * @param input - User input/prompt
 * @param context - Additional context (content type, content ID, etc.)
 * @returns Execution result with text and tool call log
 */
export async function executeAgent(
  agentId: string,
  input: string,
  context: ExecutionContext = {}
): Promise<AgentResult> {
  const agent = agents.get(agentId);
  if (!agent) {
    throw new Error(`Unknown agent: ${agentId}`);
  }

  if (!aiProviderManager) {
    throw new Error('AI provider manager not available');
  }

  // Build tool definitions for the AI provider
  const agentTools: ToolSummary[] = (agent.tools || [])
    .map((name) => tools.get(name))
    .filter((t): t is ToolDefinition => t !== undefined)
    .map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

  // Build messages
  const messages: ChatMessage[] = [
    { role: 'system', content: agent.systemPrompt },
    { role: 'user', content: buildUserMessage(input, context) },
  ];

  const toolCallLog: ToolCallLogEntry[] = [];

  // Agent loop: send to AI, handle tool calls, repeat
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    let response: AIProviderResponse;
    try {
      response = await aiProviderManager.routeToProvider(
        'chat',
        [messages, { tools: agentTools.length > 0 ? agentTools : undefined }],
        context.model || null
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { result: `AI provider error: ${message}`, toolCalls: toolCallLog, error: true };
    }

    // If the response contains tool calls, execute them
    if (response?.toolCalls && response.toolCalls.length > 0) {
      for (const call of response.toolCalls) {
        const tool = tools.get(call.name);
        if (!tool) {
          messages.push({
            role: 'tool',
            name: call.name,
            content: JSON.stringify({ error: `Unknown tool: ${call.name}` }),
          });
          continue;
        }

        try {
          const result = await tool.execute(call.arguments || {});
          toolCallLog.push({ tool: call.name, args: call.arguments, result });
          messages.push({ role: 'tool', name: call.name, content: JSON.stringify(result) });
        } catch (err: unknown) {
          const errMessage = err instanceof Error ? err.message : String(err);
          const errorResult = { error: errMessage };
          toolCallLog.push({ tool: call.name, args: call.arguments, result: errorResult });
          messages.push({ role: 'tool', name: call.name, content: JSON.stringify(errorResult) });
        }
      }
      continue; // Let AI process tool results
    }

    // No tool calls — this is the final response
    const text =
      response?.content || response?.message || response?.text || JSON.stringify(response);
    return { result: text, toolCalls: toolCallLog };
  }

  return {
    result: 'Agent reached maximum iterations without completing.',
    toolCalls: toolCallLog,
    error: true,
  };
}

// ============================================
// AI ASSISTANT API
// ============================================
// Drupal parity: ai_assistant_api module — thread-based conversational assistant.
// Provides persistent conversation threads where users can ask the AI questions
// about the CMS, get help with content, and execute agent tasks via natural language.

/** In-memory thread storage: threadId -> thread data */
const threads: Map<string, ThreadEntry> = new Map();
let threadCounter: number = 0;

/**
 * Create a new conversation thread.
 * @param options - Thread options
 * @returns Thread ID and creation timestamp
 */
export function createThread(options: ThreadOptions = {}): ThreadCreateResult {
  const threadId = `thread_${++threadCounter}_${Date.now().toString(36)}`;
  threads.set(threadId, {
    messages: [],
    systemPrompt:
      options.systemPrompt ||
      'You are a helpful CMS assistant. Help users manage content, answer questions about the CMS, and provide guidance on site administration.',
    agentId: options.agentId || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return { threadId, createdAt: threads.get(threadId)!.createdAt };
}

/**
 * Send a message to a thread and get an AI response.
 * Maintains full conversation history for context.
 *
 * @param threadId - Thread ID
 * @param message - User message
 * @param context - Additional context (content type, etc.)
 * @returns Response with text and metadata
 */
export async function sendMessage(
  threadId: string,
  message: string,
  context: ExecutionContext = {}
): Promise<SendMessageResult> {
  const thread = threads.get(threadId);
  if (!thread) {
    throw new Error(`Thread not found: ${threadId}`);
  }

  if (!aiProviderManager) {
    throw new Error('AI provider manager not available');
  }

  // Add user message to history
  thread.messages.push({ role: 'user', content: message, timestamp: new Date().toISOString() });
  thread.updatedAt = new Date().toISOString();

  // If thread is bound to an agent, use agent execution
  if (thread.agentId) {
    const result = await executeAgent(thread.agentId, message, context);
    const response = result.result || 'No response generated.';
    thread.messages.push({
      role: 'assistant',
      content: response,
      timestamp: new Date().toISOString(),
    });
    return { response, threadId, messageCount: thread.messages.length };
  }

  // Build messages array for the AI provider
  const messages: ChatMessage[] = [
    { role: 'system', content: thread.systemPrompt },
    ...thread.messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  // Get agent tools for the assistant
  const assistantTools: ToolSummary[] = ['readContent', 'listContent', 'getContentTypeSchema']
    .map((name) => tools.get(name))
    .filter((t): t is ToolDefinition => t !== undefined)
    .map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));

  try {
    const result = await aiProviderManager.routeToProvider('chat', messages, {
      tools: assistantTools,
      temperature: 0.7,
      maxTokens: 1024,
    } as unknown as string);

    const response =
      typeof result === 'string'
        ? result
        : (result as AIProviderResponse)?.content ||
          (result as AIProviderResponse)?.message ||
          JSON.stringify(result);
    thread.messages.push({
      role: 'assistant',
      content: response,
      timestamp: new Date().toISOString(),
    });

    return { response, threadId, messageCount: thread.messages.length };
  } catch (error: unknown) {
    const errMsg = `I'm sorry, I encountered an error: ${error instanceof Error ? error.message : String(error)}`;
    thread.messages.push({
      role: 'assistant',
      content: errMsg,
      timestamp: new Date().toISOString(),
    });
    return { response: errMsg, threadId, messageCount: thread.messages.length };
  }
}

/**
 * Get a thread's message history.
 * @param threadId - Thread ID
 * @returns Thread info or null if not found
 */
export function getThread(threadId: string): ThreadInfo | null {
  const thread = threads.get(threadId);
  if (!thread) return null;
  return {
    threadId,
    messages: thread.messages,
    agentId: thread.agentId,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
}

/**
 * List all active threads.
 * @returns Array of thread summaries
 */
export function listThreads(): ThreadListEntry[] {
  return Array.from(threads.entries()).map(([id, t]) => ({
    threadId: id,
    messageCount: t.messages.length,
    agentId: t.agentId,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }));
}

/**
 * Delete a thread.
 * @param threadId - Thread ID
 * @returns True if thread was deleted
 */
export function deleteThread(threadId: string): boolean {
  return threads.delete(threadId);
}
