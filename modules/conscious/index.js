/**
 * conscious/index.js - Consciousness Engine Module
 *
 * Adds living exploration interface for AM I THAT I AM manuscript.
 *
 * FEATURES:
 * - Knowledge Bank: Curated explorations and conversations
 * - Personalities: Different voices for the same knowledge
 * - Interpretation: YouTube/article analysis through your lens
 * - Conversation: Interactive discussion with the engine
 * - RESTS: Resonance mapping between explorations
 * - Featured: Curated external content with your takes
 *
 * CONTENT TYPES:
 * - exploration: Timestamped insights
 * - featured: External content + your take
 * - conversation: Curated AI conversations
 * - synthesis: Compacted knowledge summaries
 *
 * DESIGN:
 * - Knowledge bank is content (uses core content system)
 * - Personalities are config (stored in config/personalities.json)
 * - RESTS is a service (live connection discovery)
 * - Public interface uses theme templates
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

// TITANS & MIRAS integration
import titans from './titans.js';
import miras from './miras.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Module state
let personalities = {};
let restsGraph = { nodes: [], edges: [], lastUpdated: null };
let baseDir = null;
let contentService = null;

/**
 * Load personalities from config
 */
function loadPersonalities(configDir) {
  const path = join(configDir, 'personalities.json');
  if (existsSync(path)) {
    personalities = JSON.parse(readFileSync(path, 'utf-8'));
  } else {
    // Default personalities
    personalities = {
      default: {
        id: 'default',
        name: 'Default',
        emoji: '🌀',
        description: 'Curious, direct, pattern-seeking',
        prompt: 'Make connections across domains. Use "what if" bridges. Draw from the AM I THAT I AM framework.',
        adult: false
      },
      professor: {
        id: 'professor',
        name: 'Professor',
        emoji: '🎓',
        description: 'Rigorous, qualified, citations',
        prompt: 'Be scholarly and rigorous. Reference literature. Use careful qualifications. Maintain academic tone while making complex ideas accessible.',
        adult: false
      },
      joker: {
        id: 'joker',
        name: 'Joker',
        emoji: '🃏',
        description: 'Irreverent, analogies, playful',
        prompt: 'Be playful and irreverent. Use unexpected analogies. Make jokes. Be entertaining while conveying real insights.',
        adult: false
      },
      mystic: {
        id: 'mystic',
        name: 'Mystic',
        emoji: '🧘',
        description: 'Poetic, spacious, contemplative',
        prompt: 'Be poetic and spacious. Use mystical language. Reference contemplative traditions. Let silence speak.',
        adult: false
      },
      nerd: {
        id: 'nerd',
        name: 'Nerd',
        emoji: '🤖',
        description: 'Technical, equations, deep dive',
        prompt: 'Be technical and precise. Welcome equations. Go deep into mechanisms. Reference papers and models.',
        adult: false
      },
      unfiltered: {
        id: 'unfiltered',
        name: 'Unfiltered',
        emoji: '🔥',
        description: 'Adult mode, raw, expletives',
        prompt: 'Be raw and unfiltered. Use expletives for emphasis. Be blunt. Still insightful, just without filters.',
        adult: true
      }
    };
    // Save defaults
    writeFileSync(path, JSON.stringify(personalities, null, 2));
  }
  return personalities;
}

/**
 * Load RESTS graph
 */
function loadRestsGraph(dataDir) {
  const path = join(dataDir, 'rests-graph.json');
  if (existsSync(path)) {
    restsGraph = JSON.parse(readFileSync(path, 'utf-8'));
  }
  return restsGraph;
}

/**
 * Save RESTS graph
 */
function saveRestsGraph(dataDir) {
  const path = join(dataDir, 'rests-graph.json');
  restsGraph.lastUpdated = new Date().toISOString();
  writeFileSync(path, JSON.stringify(restsGraph, null, 2));
}

/**
 * Boot hook - module initialization
 */
export async function hook_boot(context) {
  baseDir = context.baseDir;
  contentService = context.services?.content;
  
  // Ensure directories exist
  const dataDir = join(baseDir, 'content', 'conscious');
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  
  // Load configurations
  loadPersonalities(join(baseDir, 'config'));
  loadRestsGraph(dataDir);
  
  // Initialize TITANS memory system
  titans.init({
    retentionGate: { threshold: 0.5 },
    workingMemory: { capacity: 1000, ttlSeconds: 3600 }
  }, baseDir, { content: contentService });
  
  // Initialize MIRAS agent coordination
  miras.init({
    quorumThreshold: 0.6,
    vetoThreshold: 0.9,
    minAgents: 3
  });
  
  console.log('[conscious] Module initialized');
  console.log(`[conscious] Personalities: ${Object.keys(personalities).join(', ')}`);
  console.log(`[conscious] RESTS graph: ${restsGraph.nodes?.length || 0} nodes, ${restsGraph.edges?.length || 0} edges`);
  console.log(`[conscious] TITANS: ${titans.getStatus().longTermMemory} patterns in long-term memory`);
  console.log(`[conscious] MIRAS: ${miras.getStatus().totalAgents} agents active`);
}

/**
 * Content hook - register content types
 */
export function hook_content(register, context) {
  // Exploration: timestamped insights
  register('exploration', {
    title: { type: 'string', required: true },
    content: { type: 'text', required: true },
    topics: { type: 'array', items: { type: 'string' } },
    source: { type: 'string' }, // conversation source (Claude, GPT, etc.)
    date: { type: 'date' },
    type: { type: 'string', enum: ['full', 'compacted', 'synthesis'] },
    wordCount: { type: 'number' },
    connections: { type: 'array', items: { type: 'string' } }, // related exploration IDs
  });

  // Featured: external content with your take
  register('featured', {
    title: { type: 'string', required: true },
    sourceTitle: { type: 'string', required: true },
    sourceUrl: { type: 'url', required: true },
    sourceType: { type: 'string', enum: ['youtube', 'article', 'paper', 'podcast'] },
    summary: { type: 'text' },
    take: { type: 'text', required: true }, // Your interpretation
    topics: { type: 'array', items: { type: 'string' } },
    videoId: { type: 'string' }, // For YouTube embeds
    publishDate: { type: 'date' },
  });

  // Conversation: curated AI conversations
  register('conversation', {
    title: { type: 'string', required: true },
    content: { type: 'text', required: true },
    topics: { type: 'array', items: { type: 'string' } },
    source: { type: 'string' }, // AI used
    turns: { type: 'number' },
    wordCount: { type: 'number' },
    compactedFrom: { type: 'string' }, // Original conversation ID if compacted
  });

  // Synthesis: compacted knowledge summaries
  register('synthesis', {
    title: { type: 'string', required: true },
    content: { type: 'text', required: true },
    topics: { type: 'array', items: { type: 'string' } },
    sources: { type: 'array', items: { type: 'string' } }, // Source exploration IDs
    lastUpdated: { type: 'date' },
  });

  console.log('[conscious] Registered content types: exploration, featured, conversation, synthesis');
}

/**
 * Routes hook - register public and admin routes
 */
export function hook_routes(register, context) {
  const content = context.services.get('content');
  const template = context.services.get('template');
  const auth = context.services.get('auth');

  // === PUBLIC ROUTES ===

  // Main explore page - serve the self-contained HTML
  register('GET', '/explore', async (req, res, params, ctx) => {
    // Read the explore template directly (it's self-contained with JS)
    const templatePath = join(baseDir, 'themes', 'default', 'templates', 'conscious', 'explore.html');
    
    try {
      const html = readFileSync(templatePath, 'utf-8');
      res.setHeader('Content-Type', 'text/html');
      res.end(html);
    } catch (err) {
      console.error('[conscious] Failed to load explore template:', err.message);
      res.writeHead(500);
      res.end('Template not found');
    }
  });

  // API: Get personalities
  register('GET', '/api/conscious/personalities', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ personalities: Object.values(personalities) }));
  });

  // API: Get bridge topics
  register('GET', '/api/conscious/bridges', async (req, res) => {
    const explorations = content.list('exploration', { limit: 100 });
    const allTopics = new Set();
    for (const item of explorations.items) {
      for (const topic of item.topics || []) {
        allTopics.add(topic);
      }
    }
    const topics = Array.from(allTopics);
    const bridges = topics.sort(() => 0.5 - Math.random()).slice(0, 6);
    
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ bridges }));
  });

  // API: Get featured
  register('GET', '/api/conscious/featured', async (req, res) => {
    const featured = content.list('featured', { limit: 10, sortBy: 'created', sortOrder: 'desc' });
    const item = featured.items[Math.floor(Math.random() * featured.items.length)];
    
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ featured: item }));
  });

  // API: Get connections
  register('GET', '/api/conscious/connections', async (req, res) => {
    const connections = (restsGraph.edges || [])
      .slice(-10)
      .map(e => ({
        type: e.type || 'connection',
        from: e.source,
        to: e.target,
        strength: e.strength,
        isNew: e.timestamp && (Date.now() - new Date(e.timestamp).getTime() < 3600000)
      }));
    
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ connections }));
  });

  // API: Stats
  register('GET', '/api/conscious/stats', async (req, res) => {
    const explorations = content.list('exploration');
    const conversations = content.list('conversation');
    const syntheses = content.list('synthesis');
    
    const allTopics = new Set();
    for (const item of explorations.items) {
      for (const topic of item.topics || []) {
        allTopics.add(topic);
      }
    }
    
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      explorations: explorations.total,
      conversations: conversations.total,
      syntheses: syntheses.total,
      connections: (restsGraph.edges || []).length,
      topics: allTopics.size,
      lastIndexed: restsGraph.lastUpdated,
    }));
  });

  // API: Recent items (for curate page)
  register('GET', '/api/conscious/recent', async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const type = url.searchParams.get('type') || 'conversation';
    const limit = parseInt(url.searchParams.get('limit') || '10', 10);
    
    const items = content.list(type, { limit, sort: '-created' });
    
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      items: items.items.map(item => ({
        id: item.id,
        title: item.title,
        topics: item.topics,
        source: item.source,
        type: type,
        created: item.created,
        timestamp: item.timestamp
      }))
    }));
  });

  // API: Chat (stub - needs LLM integration)
  register('POST', '/api/conscious/chat', async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { sessionId, message, personality = 'default' } = JSON.parse(body);
    
    const p = personalities[personality] || personalities.default;
    
    // Find relevant explorations (simple keyword matching for now)
    const words = message.toLowerCase().split(/\s+/);
    const explorations = content.list('exploration', { limit: 100 });
    const relevant = explorations.items.filter(item => {
      const text = `${item.title} ${item.content} ${(item.topics || []).join(' ')}`.toLowerCase();
      return words.some(w => text.includes(w));
    }).slice(0, 5);
    
    // Generate response (stub - would use LLM)
    const starters = {
      default: "Here's what I'm seeing...",
      professor: "The evidence suggests several relevant connections...",
      joker: "Okay so here's the thing...",
      mystic: "In the space of this question, patterns emerge...",
      nerd: "Analyzing the query against the knowledge base...",
      unfiltered: "Alright, let's dive into this..."
    };
    
    const response = relevant.length > 0
      ? `${starters[personality] || starters.default} I found ${relevant.length} relevant explorations. ${relevant[0]?.content?.slice(0, 200) || ''}... [Full LLM integration pending]`
      : `${starters[personality] || starters.default} Let me search the knowledge bank for connections... [Full LLM integration pending]`;
    
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      response,
      sources: relevant.slice(0, 3).map(e => e.id),
      personality
    }));
  });

  // API: Interpret (YouTube/article)
  register('POST', '/api/conscious/interpret', async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { url, personality = 'default', content: directContent } = JSON.parse(body);
    
    let contentText = directContent;
    let title = 'Content';
    let sourceType = 'text';
    let videoId = null;
    
    // Extract YouTube ID
    if (url && !directContent) {
      const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/);
      if (ytMatch) {
        videoId = ytMatch[1];
        sourceType = 'youtube';
        title = `YouTube Video (${videoId})`;
        // Would fetch transcript here
        contentText = '[YouTube transcript fetching pending]';
      } else if (url.startsWith('http')) {
        sourceType = 'article';
        title = url;
        // Would fetch article here
        contentText = '[Article fetching pending]';
      }
    }
    
    if (!contentText) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'No content to interpret' }));
      return;
    }
    
    const p = personalities[personality] || personalities.default;
    
    // Generate interpretation (stub)
    const interpretation = `${p.emoji} ${p.name} interpretation:

[This is where the full interpretation would appear, using the ${personality} voice and drawing from the knowledge bank to make connections to the AM I THAT I AM framework.]

Content type: ${sourceType}
${videoId ? `Video ID: ${videoId}` : ''}

[Full LLM integration pending]`;
    
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      title,
      sourceType,
      videoId,
      interpretation,
      personality
    }));
  });

  // === ADMIN ROUTES ===

  // Curation dashboard
  register('GET', '/admin/conscious', async (req, res) => {
    const session = auth.getSession(req);
    if (!session) {
      res.writeHead(302, { Location: '/admin/login?redirect=/admin/conscious' });
      res.end();
      return;
    }
    
    const explorations = content.list('exploration', { limit: 10, sortBy: 'created', sortOrder: 'desc' });
    const conversations = content.list('conversation', { limit: 10, sortBy: 'created', sortOrder: 'desc' });
    const featured = content.list('featured', { limit: 10, sortBy: 'created', sortOrder: 'desc' });
    
    const html = template.render('conscious/admin-dashboard', {
      explorations: explorations.items,
      conversations: conversations.items,
      featured: featured.items,
      stats: {
        explorations: explorations.total,
        conversations: conversations.total,
        featured: featured.total,
        connections: (restsGraph.edges || []).length,
      },
      user: session.user,
    });
    
    res.setHeader('Content-Type', 'text/html');
    res.end(html);
  });

  // Curate page (add new content)
  register('GET', '/admin/conscious/curate', async (req, res) => {
    const session = auth.getSession(req);
    if (!session) {
      res.writeHead(302, { Location: '/admin/login' });
      res.end();
      return;
    }
    
    const recent = content.list('conversation', { limit: 5, sortBy: 'created', sortOrder: 'desc' });
    
    const html = template.render('conscious/admin-curate', {
      recentItems: recent.items,
      user: session.user,
    });
    
    res.setHeader('Content-Type', 'text/html');
    res.end(html);
  });

  // Save curated content
  register('POST', '/admin/conscious/curate', async (req, res) => {
    const session = auth.getSession(req);
    if (!session) {
      res.writeHead(302, { Location: '/admin/login' });
      res.end();
      return;
    }
    
    let body = '';
    for await (const chunk of req) body += chunk;
    const data = Object.fromEntries(new URLSearchParams(body));
    
    const type = data.type || 'conversation';
    const topics = (data.topics || '').split(',').map(t => t.trim()).filter(t => t);
    
    const item = await content.create(type, {
      title: data.title || 'Untitled',
      content: data.content,
      topics,
      source: data.source || 'unknown',
      wordCount: (data.content || '').split(/\s+/).length,
      turns: (data.content || '').split(/Human:|User:|Assistant:/i).length - 1,
    });
    
    res.writeHead(302, { Location: `/admin/conscious?success=Saved+${type}+${item.id}` });
    res.end();
  });

  // Personalities management
  register('GET', '/admin/conscious/personalities', async (req, res) => {
    const session = auth.getSession(req);
    if (!session) {
      res.writeHead(302, { Location: '/admin/login' });
      res.end();
      return;
    }
    
    const html = template.render('conscious/admin-personalities', {
      personalities: Object.values(personalities),
      user: session.user,
    });
    
    res.setHeader('Content-Type', 'text/html');
    res.end(html);
  });

  console.log('[conscious] Registered routes: /explore, /api/conscious/*, /admin/conscious/*');
}

/**
 * CLI hook - register commands
 */
export function hook_cli(register, context) {
  // Index explorations for RESTS
  register('conscious:index', async (args, ctx) => {
    const content = ctx.services.get('content');
    const explorations = content.list('exploration', { limit: 1000 });
    
    console.log(`\nIndexing ${explorations.total} explorations for RESTS...\n`);
    
    // Build nodes
    restsGraph.nodes = explorations.items.map(item => ({
      id: item.id,
      title: item.title,
      topics: item.topics || [],
      wordCount: item.wordCount || 0,
    }));
    
    // Build edges (simple topic overlap for now)
    restsGraph.edges = [];
    for (let i = 0; i < restsGraph.nodes.length; i++) {
      for (let j = i + 1; j < restsGraph.nodes.length; j++) {
        const a = restsGraph.nodes[i];
        const b = restsGraph.nodes[j];
        const overlap = (a.topics || []).filter(t => (b.topics || []).includes(t));
        
        if (overlap.length > 0) {
          restsGraph.edges.push({
            source: a.id,
            target: b.id,
            type: 'topic_overlap',
            topics: overlap,
            strength: overlap.length / Math.max(a.topics.length, b.topics.length),
            timestamp: new Date().toISOString(),
          });
        }
      }
    }
    
    saveRestsGraph(join(baseDir, 'content', 'conscious'));
    
    console.log(`Indexed ${restsGraph.nodes.length} nodes, ${restsGraph.edges.length} edges`);
    console.log(`Graph saved to content/conscious/rests-graph.json`);
  }, 'Index explorations for RESTS connections');

  // Import from markdown files
  register('conscious:import', async (args, ctx) => {
    const content = ctx.services.get('content');
    const path = args[0];
    
    if (!path) {
      console.log('Usage: conscious:import <path-to-markdown-or-directory>');
      return;
    }
    
    console.log(`\nImporting from ${path}...`);
    console.log('[Import functionality pending]');
  }, 'Import explorations from markdown files');

  // Stats
  register('conscious:stats', async (args, ctx) => {
    const content = ctx.services.get('content');
    
    const explorations = content.list('exploration');
    const conversations = content.list('conversation');
    const featured = content.list('featured');
    const syntheses = content.list('synthesis');
    
    console.log('\n=== Consciousness Engine Stats ===\n');
    console.log(`Explorations:  ${explorations.total}`);
    console.log(`Conversations: ${conversations.total}`);
    console.log(`Featured:      ${featured.total}`);
    console.log(`Syntheses:     ${syntheses.total}`);
    console.log(`RESTS nodes:   ${restsGraph.nodes?.length || 0}`);
    console.log(`RESTS edges:   ${restsGraph.edges?.length || 0}`);
    console.log(`Personalities: ${Object.keys(personalities).length}`);
    console.log(`Last indexed:  ${restsGraph.lastUpdated || 'never'}`);
    console.log('');
  }, 'Show conscious engine statistics');

  // List personalities
  register('conscious:personalities', async (args, ctx) => {
    console.log('\n=== Personalities ===\n');
    for (const p of Object.values(personalities)) {
      console.log(`${p.emoji} ${p.name} (${p.id})${p.adult ? ' [ADULT]' : ''}`);
      console.log(`   ${p.description}`);
      console.log('');
    }
  }, 'List available personalities');

  // === TITANS Commands ===
  
  register('titans:status', async (args, ctx) => {
    const status = titans.getStatus();
    const stats = titans.getMemoryStats();
    
    console.log('\n=== TITANS Memory System ===\n');
    console.log('Memory Stores:');
    console.log(`  Working Memory:    ${status.workingMemory} patterns`);
    console.log(`  Long-Term Memory:  ${status.longTermMemory} patterns`);
    console.log(`  Episodic Memory:   ${status.episodicMemory} records`);
    console.log(`  Procedural Memory: ${status.proceduralMemory} procedures`);
    console.log('');
    console.log('Statistics:');
    console.log(`  Working Memory Usage: ${(stats.workingMemoryUsage * 100).toFixed(1)}%`);
    console.log(`  Average Attention:    ${(stats.averageAttention * 100).toFixed(1)}%`);
    console.log(`  Retention Rate:       ${(stats.retentionRate * 100).toFixed(1)}%`);
    console.log(`  Episodes Today:       ${stats.episodesPerDay}`);
    console.log('');
    console.log('Configuration:');
    console.log(`  Retention Threshold:  ${status.config.retentionThreshold}`);
    console.log(`  Working Memory Cap:   ${status.config.workingMemoryCapacity}`);
    console.log('');
  }, 'Show TITANS memory system status');

  register('titans:query', async (args, ctx) => {
    const topics = args.length > 0 ? args : ['consciousness'];
    const results = titans.query({ topics }, { limit: 10 });
    
    console.log(`\n=== TITANS Query: ${topics.join(', ')} ===\n`);
    if (results.length === 0) {
      console.log('No patterns found matching query.');
    } else {
      for (const { pattern, score } of results) {
        console.log(`[${(score * 100).toFixed(0)}%] ${pattern.id}`);
        console.log(`        Topics: ${(pattern.topics || []).join(', ')}`);
      }
    }
    console.log('');
  }, 'Query TITANS memory by topics');

  // === MIRAS Commands ===
  
  register('miras:agents', async (args, ctx) => {
    const agents = miras.listAgents();
    
    console.log('\n=== MIRAS Agents ===\n');
    for (const agent of agents) {
      const status = agent.status === 'available' ? '✅' : '⚠️';
      console.log(`${status} ${agent.name} (${agent.id})`);
      console.log(`     Weight: ${agent.weight.toFixed(2)} | Decisions: ${agent.decisionsCount}`);
      console.log(`     Capabilities: ${agent.capabilities.join(', ')}`);
      console.log('');
    }
  }, 'List MIRAS coordination agents');

  register('miras:status', async (args, ctx) => {
    const status = miras.getStatus();
    
    console.log('\n=== MIRAS Coordination System ===\n');
    console.log(`Total Agents:     ${status.totalAgents}`);
    console.log(`Available:        ${status.availableAgents}`);
    console.log(`Coordinator:      ${status.coordinator}`);
    console.log(`Decision Count:   ${status.decisionCount}`);
    console.log('');
    console.log('Configuration:');
    console.log(`  Quorum Threshold: ${(status.config.quorumThreshold * 100).toFixed(0)}%`);
    console.log(`  Veto Threshold:   ${(status.config.vetoThreshold * 100).toFixed(0)}%`);
    console.log('');
  }, 'Show MIRAS coordination status');

  register('miras:decide', async (args, ctx) => {
    const content = args.join(' ') || 'test request';
    const request = { 
      id: `req-${Date.now()}`,
      type: 'test',
      content 
    };
    
    console.log(`\n=== MIRAS Decision: "${content.slice(0, 50)}${content.length > 50 ? '...' : ''}" ===\n`);
    
    const decision = await miras.decide(request, {});
    
    console.log(`Decision:   ${decision.decision.toUpperCase()}`);
    console.log(`Confidence: ${(decision.confidence * 100).toFixed(1)}%`);
    console.log(`Consensus:  ${decision.consensus}`);
    console.log('');
    console.log('Agent Votes:');
    for (const vote of decision.votes) {
      console.log(`  ${vote.agentId}: ${vote.decision} (${(vote.confidence * 100).toFixed(0)}%)`);
      console.log(`    → ${vote.reasoning}`);
    }
    console.log('');
  }, 'Test MIRAS decision on content');

  register('miras:decisions', async (args, ctx) => {
    const limit = parseInt(args[0]) || 10;
    const decisions = miras.getRecentDecisions(limit);
    
    console.log(`\n=== Recent MIRAS Decisions (${decisions.length}) ===\n`);
    for (const d of decisions) {
      const time = new Date(d.timestamp).toLocaleString();
      console.log(`[${time}] ${d.decision.toUpperCase()} (${d.consensus})`);
      console.log(`    Confidence: ${(d.confidence * 100).toFixed(1)}% | Request: ${d.request.type}`);
    }
    console.log('');
  }, 'Show recent MIRAS decisions');
}

/**
 * Schedule hook - register periodic tasks
 */
export function hook_schedule(schedule, context) {
  // Re-index RESTS connections daily
  schedule('conscious:reindex', '0 3 * * *', async (ctx) => {
    console.log('[conscious] Running scheduled RESTS reindex...');
    const content = ctx.services.get('content');
    const explorations = content.list('exploration', { limit: 1000 });
    
    // Rebuild graph
    restsGraph.nodes = explorations.items.map(item => ({
      id: item.id,
      title: item.title,
      topics: item.topics || [],
    }));
    
    // Simple edge building
    restsGraph.edges = [];
    for (let i = 0; i < restsGraph.nodes.length; i++) {
      for (let j = i + 1; j < restsGraph.nodes.length; j++) {
        const a = restsGraph.nodes[i];
        const b = restsGraph.nodes[j];
        const overlap = (a.topics || []).filter(t => (b.topics || []).includes(t));
        if (overlap.length > 0) {
          restsGraph.edges.push({
            source: a.id,
            target: b.id,
            type: 'topic_overlap',
            strength: overlap.length,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }
    
    saveRestsGraph(join(baseDir, 'content', 'conscious'));
    console.log(`[conscious] Reindexed: ${restsGraph.nodes.length} nodes, ${restsGraph.edges.length} edges`);
  });
}

// Export for direct access
export const api = {
  getPersonalities: () => personalities,
  getPersonality: (id) => personalities[id],
  getRestsGraph: () => restsGraph,
  getStats: (content) => ({
    explorations: content.list('exploration').total,
    conversations: content.list('conversation').total,
    connections: (restsGraph.edges || []).length,
  }),
};
