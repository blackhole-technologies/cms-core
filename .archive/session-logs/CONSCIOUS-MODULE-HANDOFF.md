# Conscious Module - Handoff Document

**Last Updated:** 2026-02-07
**Version:** 0.2.0
**Status:** ✅ TITANS + MIRAS integrated

## Overview

The "conscious" module (renamed from "consciousness") is the living exploration interface for the AM I THAT I AM manuscript. It now includes:

- **TITANS**: Temporal Intelligence memory system with retention gates
- **MIRAS**: Multi-agent coordination with 6 specialized agents
- **RESTS**: Resonance mapping between explorations
- **Personalities**: 6 voices for the same knowledge
- **Curate**: Knowledge bank curation tools

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     CONSCIOUS MODULE                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │     TITANS      │  │     MIRAS       │  │     RESTS       │  │
│  │    (Memory)     │  │   (Agents)      │  │   (Linkage)     │  │
│  │                 │  │                 │  │                 │  │
│  │ • Working Mem   │  │ • 6 Agents      │  │ • Topic Graph   │  │
│  │ • Long-Term     │  │ • Star Topology │  │ • Connections   │  │
│  │ • Episodic      │  │ • Consensus     │  │ • Resonance     │  │
│  │ • Procedural    │  │ • Veto System   │  │                 │  │
│  │ • Retention     │  │                 │  │                 │  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  │
│           │                    │                    │           │
│           └────────────────────┼────────────────────┘           │
│                                │                                │
│  ┌─────────────────────────────┴───────────────────────────┐   │
│  │                    KNOWLEDGE BANK                        │   │
│  │  explorations | conversations | featured | synthesis     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                │                                │
│  ┌─────────────────────────────┴───────────────────────────┐   │
│  │                     INTERFACE                            │   │
│  │  /explore (public) | /admin/conscious (curation)        │   │
│  │  Personalities | YouTube interpret | Chat                │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## TITANS Memory System

### Three Memory Types

| Type | Purpose | Capacity |
|------|---------|----------|
| Working Memory | Active patterns, current context | 1,000 patterns, 1hr TTL |
| Long-Term Memory | Persistent patterns that pass retention gate | Unlimited |
| Episodic Memory | Interaction records, incidents | 100,000 records |
| Procedural Memory | Learned response patterns | 10,000 procedures |

### Attentional Bias Formula

```
α(p) = 0.30·relevance + 0.25·recency + 0.20·frequency + 0.25·severity
```

### Retention Gate Formula

```
g(p) = σ(1.5·confidence + 2.0·impact - 0.1·age - 0.5)
```

Pattern retained if g(p) > 0.5

### CLI Commands

```bash
node index.js titans:status    # Memory system status
node index.js titans:query <topics>  # Query by topics
```

## MIRAS Agent Coordination

### 6 Specialized Agents

| Agent | Weight | Specialization |
|-------|--------|----------------|
| Security Auditor | 1.2 | Threat intelligence, attack chains |
| Pattern Matcher | 1.0 | Signature detection, similarity |
| Context Analyzer | 0.9 | Behavioral analysis |
| Consensus Builder | 1.1 | Coordinator (star topology center) |
| Threat Modeler | 1.1 | Risk assessment |
| Compliance Auditor | 1.0 | Policy enforcement |

### Decision Flow

1. Request arrives
2. Select agents based on required capabilities
3. Each agent evaluates and votes
4. Check for veto (≥90% confidence on "block")
5. Build weighted consensus
6. Return decision: ALLOW | BLOCK | REVIEW | ESCALATE

### CLI Commands

```bash
node index.js miras:agents     # List all agents
node index.js miras:status     # Coordination status
node index.js miras:decide <content>  # Test decision
node index.js miras:decisions  # Recent decisions
```

## File Structure

```
modules/conscious/
├── index.js          # Main module (hooks, routes, CLI)
├── manifest.json     # Module metadata
├── titans.js         # TITANS memory system
├── miras.js          # MIRAS agent coordination
├── curate.js         # Curation utilities
└── templates/        # (empty - uses theme templates)

themes/default/templates/conscious/
├── explore.html          # Public interface
├── admin-dashboard.html  # Admin overview
└── admin-curate.html     # Curation tool

content/conscious/
└── rests-graph.json      # RESTS connection graph
```

## Configuration

### site.json additions

```json
{
  "analytics": {
    "googleAnalyticsId": "G-XXXXXXXXXX"
  }
}
```

### Module config (manifest.json)

```json
{
  "titans": {
    "retentionThreshold": 0.5,
    "memoryTypes": ["long-term", "episodic", "procedural"]
  },
  "miras": {
    "agents": 6,
    "vetoThreshold": 0.9
  }
}
```

## API Endpoints

### Public

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/conscious/stats` | GET | Knowledge bank statistics |
| `/api/conscious/bridges` | GET | Random topic suggestions |
| `/api/conscious/featured` | GET | Random featured piece |
| `/api/conscious/connections` | GET | Recent RESTS connections |
| `/api/conscious/personalities` | GET | Available voices |
| `/api/conscious/recent` | GET | Recent curated items |
| `/api/conscious/chat` | POST | Conversation endpoint |
| `/api/conscious/interpret` | POST | YouTube/article interpretation |

### Admin

| Route | Method | Description |
|-------|--------|-------------|
| `/admin/conscious` | GET | Dashboard |
| `/admin/conscious/curate` | GET/POST | Curation interface |
| `/admin/conscious/personalities` | GET | Manage voices |

## CLI Commands (Full List)

```bash
# Conscious
node index.js conscious:stats          # Statistics
node index.js conscious:index          # Rebuild RESTS graph
node index.js conscious:personalities  # List personalities
node index.js conscious:import <path>  # Import markdown

# TITANS
node index.js titans:status            # Memory status
node index.js titans:query <topics>    # Query patterns

# MIRAS
node index.js miras:agents             # List agents
node index.js miras:status             # Coordination status
node index.js miras:decide <content>   # Test decision
node index.js miras:decisions [limit]  # Recent decisions
```

## Testing

```bash
cd /Users/Alchemy/Projects/experiments/cms-core

# Test TITANS
node index.js titans:status

# Test MIRAS
node index.js miras:agents
node index.js miras:decide "test pattern recognition"

# Test conscious
node index.js conscious:stats

# Start server
node index.js
# Visit: http://localhost:3000/explore
# Admin: http://localhost:3000/admin/conscious
```

## Next Steps

1. **LLM Integration**: Connect chat/interpret to actual LLM
2. **Embedding Service**: Add vector embeddings for semantic search
3. **Feedback Loop**: Wire MIRAS feedback to weight learning
4. **Historical Personalities**: Add Newton, Tesla, Feynman, etc.
5. **YouTube Transcript**: Add actual transcript fetching

## Changes This Session

1. Renamed module: `consciousness` → `conscious`
2. Added TITANS memory system (`modules/conscious/titans.js`)
3. Added MIRAS coordination (`modules/conscious/miras.js`)
4. Added Google Analytics setting to `config/site.json`
5. Updated manifest with TITANS/MIRAS services
6. Added CLI commands for TITANS and MIRAS
7. Updated all routes from `/api/consciousness/*` to `/api/conscious/*`
8. Created curate module at `modules/curate/`

---

*Last updated: 2026-02-07*
