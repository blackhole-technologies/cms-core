/**
 * TEMPLATE: AI Function Call Plugin (AI Agent Tool)
 * 
 * Each tool the AI can invoke is a function call plugin.
 * Defines name, description, parameter schema, and execute function.
 * Maps directly to Claude/GPT function calling format.
 * 
 * Used by: TIER 2 (AI Agents) features
 */

// Module: modules/ai-agents/tools/create-content.js
export const functionCall = {
  // Tool identity — sent to the AI model
  name: 'create_content',
  description: 'Create new content in the CMS. Specify the content type and provide field data.',

  // JSON Schema for parameters — AI uses this to structure its calls
  parameters: {
    type: 'object',
    properties: {
      contentType: {
        type: 'string',
        description: 'The content type machine name (e.g., "article", "page")',
        required: true
      },
      data: {
        type: 'object',
        description: 'Field values for the content',
        required: true,
        properties: {
          title: { type: 'string', description: 'Content title' },
          body: { type: 'string', description: 'Content body (HTML or plain text)' },
          status: { type: 'boolean', description: 'Published status', default: false }
        }
      }
    }
  },

  // Permission required to use this tool
  permission: 'content:create',

  // Execute the tool — ctx has services, current user, etc.
  async execute({ contentType, data }, ctx) {
    const content = ctx.services.get('content');

    // Validate content type exists
    const types = content.types();
    if (!types.includes(contentType)) {
      return { error: `Unknown content type: ${contentType}. Available: ${types.join(', ')}` };
    }

    // Create the content
    const result = content.create(contentType, {
      ...data,
      author: ctx.user?.id || 'ai-agent'
    });

    return {
      success: true,
      id: result.id,
      type: contentType,
      title: data.title,
      url: `/${contentType}/${result.id}`
    };
  }
};

/**
 * Registration in module init:
 * 
 *   export function init(ctx) {
 *     const agents = ctx.services.get('ai-agents');
 *     agents.registerTool(functionCall);
 *   }
 * 
 * The AI agent service converts registered tools to the format
 * expected by the AI provider (Claude tools[], GPT functions[]).
 */
