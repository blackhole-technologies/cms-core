/**
 * MIRAS Coordination System for CMS-Core
 * 
 * Multi-agent Intelligent Review and Advisory System
 * Ported from Python TITANS-Security-Framework to JavaScript
 * 
 * Core Concepts:
 * - 6 Specialized Agents with weighted voting
 * - Consensus-driven decisions
 * - Star topology for coordination
 * - Veto system for high-confidence overrides
 */

// ============================================
// AGENT DEFINITIONS
// ============================================

const AGENT_TYPES = {
  SECURITY_AUDITOR: {
    id: 'security-auditor',
    name: 'Security Auditor',
    description: 'Threat intelligence and attack chain analysis',
    baseWeight: 1.2,
    capabilities: ['injection', 'traversal', 'escalation', 'threat-intel']
  },
  PATTERN_MATCHER: {
    id: 'pattern-matcher',
    name: 'Pattern Matcher',
    description: 'Signature detection and similarity analysis',
    baseWeight: 1.0,
    capabilities: ['regex', 'embedding', 'fingerprint', 'similarity']
  },
  CONTEXT_ANALYZER: {
    id: 'context-analyzer',
    name: 'Context Analyzer',
    description: 'Behavioral and situational analysis',
    baseWeight: 0.9,
    capabilities: ['history', 'session', 'user-context', 'behavioral']
  },
  CONSENSUS_BUILDER: {
    id: 'consensus-builder',
    name: 'Consensus Builder',
    description: 'Aggregates and synthesizes agent opinions',
    baseWeight: 1.1,
    capabilities: ['synthesis', 'aggregation', 'conflict-resolution']
  },
  THREAT_MODELER: {
    id: 'threat-modeler',
    name: 'Threat Modeler',
    description: 'Risk assessment and threat modeling',
    baseWeight: 1.1,
    capabilities: ['risk-assessment', 'attack-surface', 'vulnerability']
  },
  COMPLIANCE_AUDITOR: {
    id: 'compliance-auditor',
    name: 'Compliance Auditor',
    description: 'Policy enforcement and rule compliance',
    baseWeight: 1.0,
    capabilities: ['policy', 'rules', 'whitelist', 'blacklist']
  }
};

// ============================================
// STATE
// ============================================

let config = {
  quorumThreshold: 0.6,      // 60% agreement for majority
  vetoThreshold: 0.9,        // 90% confidence to veto
  timeoutMs: 5000,           // Agent response timeout
  minAgents: 3,              // Minimum agents for decision
  starTopology: true         // Use star coordinator pattern
};

let agents = new Map();
let decisionLog = [];
let coordinatorAgent = null;

// ============================================
// INITIALIZATION
// ============================================

export function init(cfg = {}) {
  Object.assign(config, cfg);
  
  // Initialize all agents
  for (const [key, def] of Object.entries(AGENT_TYPES)) {
    agents.set(def.id, createAgent(def));
  }
  
  // Set consensus builder as coordinator
  coordinatorAgent = agents.get('consensus-builder');
  
  console.log('[miras] Initialized', agents.size, 'agents, coordinator:', coordinatorAgent?.id);
}

function createAgent(definition) {
  return {
    ...definition,
    status: 'available',
    currentWeight: definition.baseWeight,
    accuracyHistory: [],
    decisionsCount: 0,
    lastActive: null
  };
}

// ============================================
// AGENT OPERATIONS
// ============================================

/**
 * Get agent by ID
 */
export function getAgent(agentId) {
  return agents.get(agentId);
}

/**
 * List all agents with status
 */
export function listAgents() {
  return [...agents.values()].map(a => ({
    id: a.id,
    name: a.name,
    status: a.status,
    weight: a.currentWeight,
    capabilities: a.capabilities,
    decisionsCount: a.decisionsCount
  }));
}

/**
 * Select agents for a request based on capabilities needed
 */
export function selectAgents(requiredCapabilities = [], minCount = 3) {
  const selected = [];
  const available = [...agents.values()].filter(a => a.status === 'available');
  
  // First, select agents that match required capabilities
  for (const agent of available) {
    const hasCapability = requiredCapabilities.length === 0 || 
      requiredCapabilities.some(c => agent.capabilities.includes(c));
    
    if (hasCapability && selected.length < minCount * 2) {
      selected.push(agent);
    }
  }
  
  // Ensure minimum diversity
  if (selected.length < minCount) {
    for (const agent of available) {
      if (!selected.includes(agent)) {
        selected.push(agent);
        if (selected.length >= minCount) break;
      }
    }
  }
  
  return selected;
}

// ============================================
// VOTING & CONSENSUS
// ============================================

/**
 * Agent vote structure
 */
function createVote(agentId, decision, confidence, reasoning) {
  return {
    agentId,
    decision,        // 'allow', 'block', 'review', 'escalate'
    confidence,      // 0.0 - 1.0
    reasoning,       // explanation
    timestamp: Date.now()
  };
}

/**
 * Collect votes from selected agents
 * Each agent evaluates the request and returns a vote
 */
export async function collectVotes(request, context = {}) {
  const selectedAgents = selectAgents(request.capabilities || [], config.minAgents);
  const votes = [];
  
  for (const agent of selectedAgents) {
    const vote = await evaluateRequest(agent, request, context);
    votes.push(vote);
    agent.lastActive = Date.now();
    agent.decisionsCount++;
  }
  
  return votes;
}

/**
 * Agent evaluates a request (simulated - would be actual logic per agent type)
 */
async function evaluateRequest(agent, request, context) {
  // Simulate agent-specific evaluation logic
  const evaluation = agentEvaluationLogic[agent.id]?.(request, context) || defaultEvaluation(request);
  
  return createVote(
    agent.id,
    evaluation.decision,
    evaluation.confidence,
    evaluation.reasoning
  );
}

// Agent-specific evaluation strategies
const agentEvaluationLogic = {
  'security-auditor': (request, context) => {
    // Check for security threats
    const threatLevel = assessThreatLevel(request.content || '');
    return {
      decision: threatLevel > 0.7 ? 'block' : threatLevel > 0.4 ? 'review' : 'allow',
      confidence: 0.7 + Math.random() * 0.2,
      reasoning: `Threat assessment: ${(threatLevel * 100).toFixed(0)}%`
    };
  },
  
  'pattern-matcher': (request, context) => {
    // Look for known patterns
    const matches = findPatternMatches(request.content || '');
    return {
      decision: matches.length > 2 ? 'review' : 'allow',
      confidence: 0.6 + Math.random() * 0.3,
      reasoning: `Found ${matches.length} pattern matches`
    };
  },
  
  'context-analyzer': (request, context) => {
    // Analyze context and history
    const anomalyScore = context.anomalyScore || Math.random() * 0.5;
    return {
      decision: anomalyScore > 0.6 ? 'review' : 'allow',
      confidence: 0.65 + Math.random() * 0.25,
      reasoning: `Context anomaly score: ${(anomalyScore * 100).toFixed(0)}%`
    };
  },
  
  'consensus-builder': (request, context) => {
    // Meta-analysis (coordinator perspective)
    return {
      decision: 'allow',
      confidence: 0.5,
      reasoning: 'Awaiting other agent inputs'
    };
  },
  
  'threat-modeler': (request, context) => {
    // Model potential threats
    const riskLevel = assessRiskLevel(request);
    return {
      decision: riskLevel > 0.6 ? 'block' : riskLevel > 0.3 ? 'review' : 'allow',
      confidence: 0.7 + Math.random() * 0.2,
      reasoning: `Risk level: ${riskLevel > 0.6 ? 'HIGH' : riskLevel > 0.3 ? 'MEDIUM' : 'LOW'}`
    };
  },
  
  'compliance-auditor': (request, context) => {
    // Check policy compliance
    const compliant = checkCompliance(request);
    return {
      decision: compliant ? 'allow' : 'block',
      confidence: 0.8 + Math.random() * 0.15,
      reasoning: compliant ? 'Passes policy checks' : 'Policy violation detected'
    };
  }
};

function defaultEvaluation(request) {
  return { decision: 'allow', confidence: 0.5, reasoning: 'Default evaluation' };
}

// Helper functions for evaluation
function assessThreatLevel(content) {
  const threatPatterns = ['injection', 'attack', 'exploit', 'malicious', 'unauthorized'];
  const lower = content.toLowerCase();
  let score = 0;
  for (const pattern of threatPatterns) {
    if (lower.includes(pattern)) score += 0.2;
  }
  return Math.min(1.0, score);
}

function findPatternMatches(content) {
  // Simplified pattern matching
  const patterns = [/\bpattern\b/gi, /\brecognition\b/gi, /\bconsciousness\b/gi];
  const matches = [];
  for (const p of patterns) {
    const m = content.match(p);
    if (m) matches.push(...m);
  }
  return matches;
}

function assessRiskLevel(request) {
  // Simplified risk assessment
  return Math.random() * 0.5;
}

function checkCompliance(request) {
  // Simplified compliance check
  return true;
}

// ============================================
// CONSENSUS ENGINE
// ============================================

/**
 * Build consensus from collected votes
 */
export function buildConsensus(votes) {
  if (votes.length === 0) {
    return { decision: 'review', confidence: 0, consensus: 'none', votes: [] };
  }
  
  // Check for veto (any agent with confidence >= vetoThreshold on 'block')
  const vetoVote = votes.find(v => 
    v.decision === 'block' && v.confidence >= config.vetoThreshold
  );
  if (vetoVote) {
    return {
      decision: 'block',
      confidence: vetoVote.confidence,
      consensus: 'veto',
      vetoAgent: vetoVote.agentId,
      reasoning: `Veto by ${vetoVote.agentId}: ${vetoVote.reasoning}`,
      votes
    };
  }
  
  // Count weighted votes
  const decisionWeights = { allow: 0, block: 0, review: 0, escalate: 0 };
  let totalWeight = 0;
  
  for (const vote of votes) {
    const agent = agents.get(vote.agentId);
    const weight = (agent?.currentWeight || 1.0) * vote.confidence;
    decisionWeights[vote.decision] += weight;
    totalWeight += weight;
  }
  
  // Find majority decision
  let maxWeight = 0;
  let majorityDecision = 'review';
  
  for (const [decision, weight] of Object.entries(decisionWeights)) {
    if (weight > maxWeight) {
      maxWeight = weight;
      majorityDecision = decision;
    }
  }
  
  // Check if quorum met
  const quorumMet = totalWeight > 0 && (maxWeight / totalWeight) >= config.quorumThreshold;
  const consensusType = quorumMet ? 'majority' : 'split';
  
  // If split, escalate
  if (!quorumMet) {
    majorityDecision = 'escalate';
  }
  
  // Build reasoning
  const reasoningSummary = votes.map(v => 
    `${v.agentId}: ${v.decision} (${(v.confidence * 100).toFixed(0)}%)`
  ).join('; ');
  
  return {
    decision: majorityDecision,
    confidence: totalWeight > 0 ? maxWeight / totalWeight : 0,
    consensus: consensusType,
    reasoning: reasoningSummary,
    weights: decisionWeights,
    votes
  };
}

/**
 * Full decision cycle: select agents → collect votes → build consensus
 */
export async function decide(request, context = {}) {
  const startTime = Date.now();
  
  // Collect votes
  const votes = await collectVotes(request, context);
  
  // Build consensus
  const result = buildConsensus(votes);
  
  // Log decision
  const decision = {
    id: `dec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    duration: Date.now() - startTime,
    request: { type: request.type, id: request.id },
    ...result
  };
  
  decisionLog.push(decision);
  
  // Limit log size
  if (decisionLog.length > 10000) {
    decisionLog = decisionLog.slice(-5000);
  }
  
  return decision;
}

// ============================================
// FEEDBACK & LEARNING
// ============================================

/**
 * Update agent weights based on feedback
 */
export function provideFeedback(decisionId, wasCorrect) {
  const decision = decisionLog.find(d => d.id === decisionId);
  if (!decision) return false;
  
  for (const vote of decision.votes) {
    const agent = agents.get(vote.agentId);
    if (!agent) continue;
    
    // Track accuracy
    agent.accuracyHistory.push(wasCorrect ? 1 : 0);
    if (agent.accuracyHistory.length > 100) {
      agent.accuracyHistory.shift();
    }
    
    // Adjust weight based on rolling accuracy
    const accuracy = agent.accuracyHistory.reduce((a, b) => a + b, 0) / agent.accuracyHistory.length;
    agent.currentWeight = agent.baseWeight * (0.5 + accuracy);
  }
  
  return true;
}

// ============================================
// STATUS & STATS
// ============================================

export function getStatus() {
  const available = [...agents.values()].filter(a => a.status === 'available').length;
  
  return {
    totalAgents: agents.size,
    availableAgents: available,
    coordinator: coordinatorAgent?.id,
    decisionCount: decisionLog.length,
    config: {
      quorumThreshold: config.quorumThreshold,
      vetoThreshold: config.vetoThreshold
    }
  };
}

export function getRecentDecisions(limit = 10) {
  return decisionLog.slice(-limit).reverse();
}

export function getAgentStats() {
  return [...agents.values()].map(a => ({
    id: a.id,
    name: a.name,
    currentWeight: a.currentWeight.toFixed(2),
    baseWeight: a.baseWeight,
    accuracy: a.accuracyHistory.length > 0 
      ? (a.accuracyHistory.reduce((x, y) => x + y, 0) / a.accuracyHistory.length * 100).toFixed(1) + '%'
      : 'N/A',
    decisionsCount: a.decisionsCount
  }));
}

// ============================================
// EXPORTS
// ============================================

export default {
  init,
  getAgent,
  listAgents,
  selectAgents,
  collectVotes,
  buildConsensus,
  decide,
  provideFeedback,
  getStatus,
  getRecentDecisions,
  getAgentStats,
  AGENT_TYPES
};
