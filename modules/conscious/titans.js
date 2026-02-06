/**
 * TITANS Memory System for CMS-Core
 * 
 * Temporal Intelligence for Thought Analysis with Neuromorphic Storage
 * Ported from Python TITANS-Security-Framework to JavaScript
 * 
 * Core Concepts:
 * - Attentional Bias: Weighted relevance scoring
 * - Retention Gate: Determines what persists in long-term memory
 * - Three Memory Types: Long-term, Episodic, Procedural
 */

// ============================================
// STATE
// ============================================

let config = {
  attentionalBias: {
    weightRelevance: 0.30,
    weightRecency: 0.25,
    weightFrequency: 0.20,
    weightSeverity: 0.25
  },
  retentionGate: {
    betaConfidence: 1.5,
    betaImpact: 2.0,
    lambdaDecay: 0.1,
    bias: -0.5,
    threshold: 0.5
  },
  workingMemory: {
    capacity: 1000,
    ttlSeconds: 3600
  }
};

// Memory stores
let workingMemory = new Map();
let longTermMemory = new Map();
let episodicMemory = [];
let proceduralMemory = new Map();

// Services
let contentService = null;
let baseDir = '';

// ============================================
// INITIALIZATION
// ============================================

export function init(cfg = {}, base = '', services = {}) {
  Object.assign(config, cfg);
  baseDir = base;
  contentService = services.content;
  
  // Load persisted memories
  loadMemories();
  
  console.log('[titans] Initialized - LTM:', longTermMemory.size, 
    'Episodic:', episodicMemory.length, 
    'Procedural:', proceduralMemory.size);
}

function loadMemories() {
  if (!contentService) return;
  
  try {
    // Load from content types
    const explorations = contentService.list('exploration', { limit: 1000 });
    for (const item of explorations.items || []) {
      const pattern = contentToPattern(item);
      if (pattern) longTermMemory.set(pattern.id, pattern);
    }
  } catch (e) {
    console.error('[titans] Failed to load memories:', e.message);
  }
}

function contentToPattern(item) {
  return {
    id: item.id,
    type: 'exploration',
    content: item.content || item.body || '',
    topics: item.topics || [],
    confidence: item.confidence || 0.7,
    severity: item.severity || 'medium',
    frequency: item.views || 1,
    firstSeen: new Date(item.created || Date.now()),
    lastSeen: new Date(item.updated || item.created || Date.now()),
    embedding: null // Would be computed by embedding service
  };
}

// ============================================
// ATTENTIONAL BIAS
// ============================================

/**
 * Calculate attentional bias for a pattern
 * α(p) = Σ wᵢ · fᵢ(p)
 */
export function attentionalBias(pattern, context = {}) {
  const { weightRelevance, weightRecency, weightFrequency, weightSeverity } = config.attentionalBias;
  
  const relevance = calculateRelevance(pattern, context);
  const recency = calculateRecency(pattern);
  const frequency = calculateFrequency(pattern);
  const severity = calculateSeverity(pattern);
  
  return (
    weightRelevance * relevance +
    weightRecency * recency +
    weightFrequency * frequency +
    weightSeverity * severity
  );
}

function calculateRelevance(pattern, context) {
  if (!context.topics || !pattern.topics) return 0.5;
  
  const patternTopics = new Set(pattern.topics.map(t => t.toLowerCase()));
  const contextTopics = new Set((context.topics || []).map(t => t.toLowerCase()));
  
  if (patternTopics.size === 0) return 0.5;
  
  let overlap = 0;
  for (const t of contextTopics) {
    if (patternTopics.has(t)) overlap++;
  }
  
  return Math.min(1.0, overlap / Math.max(patternTopics.size, 1));
}

function calculateRecency(pattern) {
  const daysAgo = (Date.now() - new Date(pattern.lastSeen).getTime()) / (1000 * 60 * 60 * 24);
  return Math.exp(-0.1 * daysAgo);
}

function calculateFrequency(pattern) {
  const freq = pattern.frequency || 1;
  return Math.min(1.0, Math.log1p(freq) / Math.log1p(1000));
}

function calculateSeverity(pattern) {
  const levels = { low: 0.25, medium: 0.5, high: 0.75, critical: 1.0 };
  return levels[pattern.severity] || 0.5;
}

// ============================================
// RETENTION GATE
// ============================================

/**
 * Determine if pattern should persist in long-term memory
 * g(p) = σ(β₁·confidence + β₂·impact - λ·age + b)
 */
export function retentionGate(pattern) {
  const { betaConfidence, betaImpact, lambdaDecay, bias } = config.retentionGate;
  
  const ageDays = (Date.now() - new Date(pattern.firstSeen).getTime()) / (1000 * 60 * 60 * 24);
  const impact = impactScore(pattern);
  
  const logit = (
    betaConfidence * (pattern.confidence || 0.5) +
    betaImpact * impact -
    lambdaDecay * ageDays +
    bias
  );
  
  return sigmoid(logit);
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function impactScore(pattern) {
  const severity = calculateSeverity(pattern);
  const frequency = Math.min(1.0, (pattern.frequency || 1) / 100);
  return severity * 0.7 + frequency * 0.3;
}

export function shouldRetain(pattern) {
  return retentionGate(pattern) > config.retentionGate.threshold;
}

// ============================================
// MEMORY OPERATIONS
// ============================================

/**
 * Store a pattern in appropriate memory
 */
export function store(pattern, context = {}) {
  const alpha = attentionalBias(pattern, context);
  const gate = retentionGate(pattern);
  
  // Always store in working memory
  workingMemory.set(pattern.id, {
    pattern,
    alpha,
    gate,
    timestamp: Date.now()
  });
  
  // Evict old working memory entries
  evictWorkingMemory();
  
  // Check retention gate for long-term storage
  if (gate >= config.retentionGate.threshold) {
    longTermMemory.set(pattern.id, pattern);
    return { stored: true, memoryType: 'long-term', alpha, gate };
  }
  
  return { stored: true, memoryType: 'working', alpha, gate };
}

/**
 * Record an episode (incident/interaction)
 */
export function recordEpisode(episode) {
  episodicMemory.push({
    id: `ep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    ...episode
  });
  
  // Limit episodic memory size
  if (episodicMemory.length > 100000) {
    episodicMemory = episodicMemory.slice(-50000);
  }
  
  return episodicMemory[episodicMemory.length - 1];
}

/**
 * Store a learned procedure
 */
export function storeProcedure(procedure) {
  proceduralMemory.set(procedure.id || procedure.name, {
    ...procedure,
    timesExecuted: procedure.timesExecuted || 0,
    lastExecuted: null,
    successRate: procedure.successRate || 1.0
  });
}

/**
 * Query patterns by context
 */
export function query(context, options = {}) {
  const { limit = 10, threshold = 0.3 } = options;
  const results = [];
  
  // Search long-term memory
  for (const pattern of longTermMemory.values()) {
    const alpha = attentionalBias(pattern, context);
    if (alpha >= threshold) {
      results.push({ pattern, score: alpha });
    }
  }
  
  // Sort by score
  results.sort((a, b) => b.score - a.score);
  
  return results.slice(0, limit);
}

/**
 * Query recent episodes
 */
export function queryEpisodes(filter = {}, limit = 10) {
  let results = episodicMemory;
  
  if (filter.since) {
    results = results.filter(e => e.timestamp >= filter.since);
  }
  if (filter.type) {
    results = results.filter(e => e.type === filter.type);
  }
  
  return results.slice(-limit).reverse();
}

function evictWorkingMemory() {
  const now = Date.now();
  const ttl = config.workingMemory.ttlSeconds * 1000;
  
  for (const [id, entry] of workingMemory) {
    if (now - entry.timestamp > ttl) {
      workingMemory.delete(id);
    }
  }
  
  // Also enforce capacity
  if (workingMemory.size > config.workingMemory.capacity) {
    const sorted = [...workingMemory.entries()]
      .sort((a, b) => a[1].alpha - b[1].alpha);
    
    const toRemove = sorted.slice(0, workingMemory.size - config.workingMemory.capacity);
    for (const [id] of toRemove) {
      workingMemory.delete(id);
    }
  }
}

// ============================================
// STATUS & STATS
// ============================================

export function getStatus() {
  return {
    workingMemory: workingMemory.size,
    longTermMemory: longTermMemory.size,
    episodicMemory: episodicMemory.length,
    proceduralMemory: proceduralMemory.size,
    config: {
      retentionThreshold: config.retentionGate.threshold,
      workingMemoryCapacity: config.workingMemory.capacity
    }
  };
}

export function getMemoryStats() {
  // Calculate average attention scores
  let totalAlpha = 0;
  for (const entry of workingMemory.values()) {
    totalAlpha += entry.alpha;
  }
  
  // Calculate retention distribution
  let retainedCount = 0;
  for (const pattern of longTermMemory.values()) {
    if (shouldRetain(pattern)) retainedCount++;
  }
  
  return {
    workingMemoryUsage: workingMemory.size / config.workingMemory.capacity,
    averageAttention: workingMemory.size > 0 ? totalAlpha / workingMemory.size : 0,
    retentionRate: longTermMemory.size > 0 ? retainedCount / longTermMemory.size : 0,
    episodesPerDay: calculateEpisodesPerDay()
  };
}

function calculateEpisodesPerDay() {
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  return episodicMemory.filter(e => e.timestamp > dayAgo).length;
}

// ============================================
// EXPORTS
// ============================================

export default {
  init,
  store,
  query,
  recordEpisode,
  queryEpisodes,
  storeProcedure,
  attentionalBias,
  retentionGate,
  shouldRetain,
  getStatus,
  getMemoryStats
};
