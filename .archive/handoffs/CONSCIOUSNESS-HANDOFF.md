# Consciousness Engine Module - Handoff

## Overview

The consciousness module adds a living exploration interface for the "AM I THAT I AM" manuscript to cms-core. It provides:

- **Knowledge Bank**: Curated explorations, conversations, and syntheses
- **Personalities**: Different voices for the same knowledge (academic, playful, mystical, etc.)
- **Interpretation**: Analyze external content (YouTube, articles) through the manuscript's lens
- **Conversation**: Interactive discussion with the engine
- **RESTS**: Connection mapping between explorations

## Current State: Working ✅

All routes functional. Module loads correctly. API endpoints accessible.

**Content loaded:**
- 9 seed explorations (key manuscript themes)
- 1 featured piece (example external content + take)
- 36 RESTS connections (topic overlap)
- 34 unique topics indexed

**Personalities configured:**
- 6 active: default, professor, joker, mystic, nerd, unfiltered
- 5 planned historical: Newton, Tesla, Feynman, Watts, Sagan

## File Locations

```
cms-core/
├── modules/consciousness/
│   ├── index.js              # Main module (hooks, routes, CLI, API)
│   └── manifest.json         # Module metadata
│
├── themes/default/templates/consciousness/
│   ├── explore.html          # Public interface
│   ├── admin-dashboard.html  # Admin overview
│   └── admin-curate.html     # Curation tool
│
├── config/
│   ├── modules.json          # consciousness enabled
│   └── personalities.json    # Created on first boot
│
└── content/consciousness/
    └── rests-graph.json      # RESTS connection data
```

## Content Types

| Type | Purpose | Key Fields |
|------|---------|------------|
| `exploration` | Timestamped insights | title, content, topics, source, type |
| `featured` | External content + takes | sourceTitle, sourceUrl, take, videoId |
| `conversation` | Curated AI conversations | content, topics, source, turns |
| `synthesis` | Compacted summaries | content, topics, sources |

## API Endpoints (Public - No Auth)

```
GET  /api/consciousness/stats         # Knowledge bank statistics
GET  /api/consciousness/bridges       # Random topic suggestions
GET  /api/consciousness/featured      # Random featured piece
GET  /api/consciousness/connections   # Recent RESTS connections
GET  /api/consciousness/personalities # Available voices
POST /api/consciousness/chat          # Conversation endpoint
POST /api/consciousness/interpret     # YouTube/article interpretation
```

## Admin Routes (Auth Required)

```
GET  /admin/consciousness              # Dashboard
GET  /admin/consciousness/curate       # Add content
POST /admin/consciousness/curate       # Save content
GET  /admin/consciousness/personalities # Manage voices
```

## CLI Commands

```bash
node index.js consciousness:stats         # Show statistics
node index.js consciousness:index         # Rebuild RESTS graph
node index.js consciousness:personalities # List personalities
node index.js consciousness:import <path> # Import from markdown (stub)
```

## Personalities

| ID | Emoji | Style |
|----|-------|-------|
| default | 🌀 | Curious, direct, pattern-seeking |
| professor | 🎓 | Rigorous, citations, qualified |
| joker | 🃏 | Irreverent, analogies, playful |
| mystic | 🧘 | Poetic, spacious, contemplative |
| nerd | 🤖 | Technical, equations, deep dive |
| unfiltered | 🔥 | Adult mode, expletives, raw |

## Planned: Historical Personalities

Map famous thinkers to base types with their unique voice:

| Historical | Base Type | Style |
|------------|-----------|-------|
| Newton | professor | Mathematical rigor, laws, precision |
| Tesla | nerd + mystic | Visionary, electrical analogies |
| Feynman | joker | Playful curiosity, "surely you're joking" |
| Einstein | default | Thought experiments, imagination |
| Watts | mystic | Zen paradox, cosmic humor |
| Sagan | professor | Cosmic perspective, wonder |

## Integration Points

### LLM Integration (TODO)
The chat and interpret endpoints return stub responses. To add real LLM:

```javascript
// In modules/consciousness/index.js, update generateResponse():
async function generateResponse(message, context, explorations, connections, personality) {
  const systemPrompt = `You are discussing consciousness and patterns...
    Personality: ${personalities[personality].prompt}
    
    Relevant explorations:
    ${explorations.map(e => e.content).join('\n\n')}
  `;
  
  // Call your LLM API here
  const response = await llm.complete({ system: systemPrompt, user: message });
  return response;
}
```

### RESTS Engine Enhancement (TODO)
Current RESTS uses simple topic overlap. To add semantic similarity:

```javascript
// Enhance edge building with embeddings
async function buildSemanticEdges(explorations) {
  for (const exp of explorations) {
    const embedding = await getEmbedding(exp.content);
    // Compare with other embeddings, create edges for high similarity
  }
}
```

### YouTube Transcript (TODO)
Add actual transcript fetching:

```javascript
import { YoutubeTranscript } from 'youtube-transcript';

async function fetchYouTubeTranscript(videoId) {
  const transcript = await YoutubeTranscript.fetchTranscript(videoId);
  return transcript.map(t => t.text).join(' ');
}
```

## Import Existing Content

The manuscript explorations are at:
- `/Users/Alchemy/clawd/manuscript/consciousness-engine/explorations/`
- Format: JSON files with date, topic, content

To import:
```bash
node index.js consciousness:import /path/to/explorations
```

## Testing

```bash
# Start server
cd /Users/Alchemy/Projects/experiments/cms-core
node index.js

# Test endpoints
curl http://localhost:3000/api/consciousness/stats
curl -X POST -H "Content-Type: application/json" \
  -d '{"sessionId":"test","message":"boundaries","personality":"joker"}' \
  http://localhost:3000/api/consciousness/chat

# Open browser
open http://localhost:3000/explore
open http://localhost:3000/admin/consciousness
```

## Related Work

### Standalone Prototype (Port 3333)
Location: `/Users/Alchemy/clawd/manuscript/consciousness-engine/prototype/`

This was the initial proof-of-concept with polished UI:
- `index.html` - Main explore interface (YouTube embed, personality selector, live connections)
- `curate.html` - Curation tool with preview, topic suggestions, save/compact options
- `server.js` - Express server with API endpoints
- `featured-pieces.json` - Sample curated external content

To run: `cd prototype && npm start` → http://localhost:3333

The polished UI from this prototype has been ported to cms-core templates.

### Manuscript Source
- **Conversations**: `/Users/Alchemy/Documents/Claude/manuscript/` (webarchive files)
- **Working dir**: `/Users/Alchemy/clawd/manuscript/`

### Architecture Diagram
```
┌─────────────────────────────────────────────────────────────────┐
│                     CURATION LAYER (You + AI)                   │
│   Conversations → Edit → Compact → Upload to knowledge bank     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                     KNOWLEDGE BANK (cms-core content)           │
│   explorations/ │ conversations/ │ featured/ │ synthesis/       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                     ENGINES                                     │
│   RESTS (linkage) │ Titans (memory - TODO) │ LLM (responses)   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                     INTERFACE                                   │
│   /explore (public) │ /admin/consciousness (curation)          │
│   Personalities │ YouTube interpret │ Chat │ Featured          │
└─────────────────────────────────────────────────────────────────┘
```

## Prototype Features (Ported to cms-core)

The standalone prototype at `/clawd/manuscript/consciousness-engine/prototype/` included:

**Public Interface (`index.html` → `explore.html`):**
- Personality selector dropdown with descriptions
- "What if we explored..." bridge pills (random topics)
- YouTube video embed with side-by-side interpretation panel
- Featured piece with "The Pattern I See" take section
- Live conversation with personality-aware responses
- Sidebar: Recent connections (with "new" badges), stats, session ID

**Curation Interface (`curate.html` → `admin-curate.html`):**
- Paste conversation textarea with live preview
- Auto-detect topics from content (tag suggestions)
- Title, topics, source, type metadata fields
- Word count stats
- Form-based save to cms-core content system

**API Endpoints (now at `/api/consciousness/*`):**
- `/bridges` - Random topic suggestions
- `/featured` - Random featured piece
- `/connections` - Recent RESTS connections
- `/stats` - Knowledge bank statistics
- `/chat` - Conversation with personality
- `/interpret` - YouTube/article analysis

## Architecture Philosophy

1. **Content and mechanism are orthogonal** - Edit knowledge without changing code
2. **"What ifs" are bridges** - Not rhetorical, actual consciousness bridging
3. **Dynamic experience** - Every visit different, not static pages
4. **Same knowledge, different voices** - Personalities don't change truth, just delivery

---

*Last updated: 2025-02-07*
