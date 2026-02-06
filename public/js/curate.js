/**
 * Curate Module - Browser Version
 * Knowledge Bank Curation Engine for Consciousness Module
 */

window.Curate = (function() {
    'use strict';

    // ============================================
    // TOPIC POOLS
    // ============================================
    
    const topicPools = {
        core: ['consciousness', 'boundaries', 'recognition', 'time', 'scale', 'pattern', 
               'self-reference', 'emergence', 'negentropy', 'observer', 'void', 'AM I THAT'],
        physics: ['quantum', 'measurement', 'collapse', 'superposition', 'entanglement',
                  'time symmetry', 'scale invariance', 'phase transition', 'feedback'],
        biology: ['autopoiesis', 'membrane', 'cell', 'neural', 'binding', 'evolution',
                  'metabolism', 'homeostasis', 'immune', 'recognition'],
        philosophy: ['hard problem', 'free will', 'meaning', 'intentionality', 'qualia',
                     'phenomenology', 'dualism', 'panpsychism', 'integrated information'],
        cosmology: ['fine-tuning', 'arrow of time', 'holographic', 'dark energy', 'big bang',
                    'inflation', 'entropy', 'heat death', 'anthropic'],
        mystical: ['witness', 'non-dual', 'awareness', 'maya', 'lila', 'emptiness',
                   'awakening', 'meditation', 'contemplative', 'presence']
    };

    const allTopics = Object.values(topicPools).flat();

    // ============================================
    // CONVERSATION PARSER
    // ============================================

    function normalizeRole(role) {
        const lower = role.toLowerCase().trim();
        if (['human', 'user', 'me', 'i'].includes(lower)) return 'human';
        if (['assistant', 'ai', 'claude', 'gpt', 'gemini', 'bot'].includes(lower)) return 'assistant';
        if (lower === 'system') return 'system';
        return lower;
    }

    function parseConversation(text) {
        if (!text || typeof text !== 'string') return [];
        
        const trimmed = text.trim();
        
        // Try JSON
        if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
            try {
                const json = JSON.parse(trimmed);
                const messages = Array.isArray(json) ? json : json.messages || [json];
                return messages.map(m => ({
                    role: normalizeRole(m.role || m.speaker || 'unknown'),
                    content: m.content || m.text || m.message || ''
                })).filter(m => m.content);
            } catch (e) {}
        }
        
        // Try Human:/Assistant: format
        const chatPattern = /(Human|User|Assistant|AI|Claude|GPT|System):\s*/gi;
        const parts = text.split(chatPattern).filter(p => p.trim());
        
        if (parts.length > 1) {
            const turns = [];
            for (let i = 0; i < parts.length - 1; i += 2) {
                const role = normalizeRole(parts[i]);
                const content = parts[i + 1]?.trim() || '';
                if (content) turns.push({ role, content });
            }
            if (turns.length > 0) return turns;
        }
        
        // Fallback: single block
        return [{ role: 'mixed', content: trimmed }];
    }

    // ============================================
    // TAG SUGGESTIONS
    // ============================================

    function suggestTags(text, maxSuggestions = 8) {
        if (!text) return [];
        const lower = text.toLowerCase();
        
        return allTopics
            .filter(topic => {
                const pattern = topic.length > 6 
                    ? topic.toLowerCase() 
                    : new RegExp('\\b' + topic.toLowerCase() + '\\b');
                return typeof pattern === 'string' ? lower.includes(pattern) : pattern.test(lower);
            })
            .sort((a, b) => b.length - a.length)
            .slice(0, maxSuggestions);
    }

    function suggestTagsByCategory(text) {
        const lower = text.toLowerCase();
        const result = {};
        
        for (const [category, topics] of Object.entries(topicPools)) {
            const matches = topics.filter(t => lower.includes(t.toLowerCase()));
            if (matches.length > 0) result[category] = matches;
        }
        
        return result;
    }

    // ============================================
    // STATS
    // ============================================

    function calculateStats(text, turns = null) {
        if (!text) return { turns: 0, words: 0, characters: 0, topics: 0 };
        
        const parsedTurns = turns || parseConversation(text);
        const words = text.split(/\s+/).filter(w => w.length > 0);
        const topics = suggestTags(text);
        
        return {
            turns: parsedTurns.length,
            words: words.length,
            characters: text.length,
            topics: topics.length,
            topicsList: topics,
            humanTurns: parsedTurns.filter(t => t.role === 'human').length,
            assistantTurns: parsedTurns.filter(t => t.role === 'assistant').length
        };
    }

    // ============================================
    // COMPACTION
    // ============================================

    function autoCompact(text, options = {}) {
        const {
            maxLines = 20,
            keywords = ['insight', 'pattern', 'connection', 'key', 'important', 
                        'recognize', 'realize', 'understanding', 'therefore', 'thus',
                        'in other words', 'essentially', 'the point is', 'what this means'],
            minLineLength = 50
        } = options;
        
        const lines = text.split('\n').filter(line => line.trim());
        const scored = [];
        
        for (const line of lines) {
            const lower = line.toLowerCase();
            let score = 0;
            
            for (const kw of keywords) {
                if (lower.includes(kw)) score += 2;
            }
            
            if (line.length > minLineLength) score += 1;
            if (line.length > 200) score += 1;
            if (line.match(/^[-*•]\s/)) score += 1;
            if (line.match(/^\d+\.\s/)) score += 1;
            if (line.match(/^#{1,3}\s/)) score += 2;
            if (line.length < 20) score -= 2;
            if (/^(yes|no|okay|right|hmm|ah|oh|I see|interesting)\.?$/i.test(line.trim())) {
                score -= 5;
            }
            
            scored.push({ line, score });
        }
        
        const threshold = scored.length > maxLines 
            ? scored.map(s => s.score).sort((a, b) => b - a)[maxLines - 1] 
            : -Infinity;
        
        return scored
            .map((s, i) => ({ ...s, index: i }))
            .filter(s => s.score >= threshold)
            .sort((a, b) => a.index - b.index)
            .slice(0, maxLines)
            .map(s => s.line)
            .join('\n\n');
    }

    // ============================================
    // PREVIEW RENDERING
    // ============================================

    function escapeHtml(text) {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
        return text.replace(/[&<>"']/g, c => map[c]);
    }

    function renderPreview(turns, options = {}) {
        const { maxLength = 500, showRole = true } = options;
        const roleColors = {
            human: 'var(--gold, #d4a574)',
            assistant: 'var(--blue, #7aa2d4)',
            system: 'var(--purple, #a87fd4)',
            mixed: 'var(--text-dim, #888898)',
            quoted: 'var(--green, #7ad4a8)'
        };
        
        if (!turns || turns.length === 0) {
            return '<p style="color: var(--text-dim); font-style: italic;">No content to preview</p>';
        }
        
        return turns.map(turn => {
            const color = roleColors[turn.role] || 'var(--text-dim)';
            const truncated = turn.content.length > maxLength 
                ? turn.content.slice(0, maxLength) + '...'
                : turn.content;
            
            return `
                <div class="turn" style="margin-bottom: 1rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border, #2a2a3a);">
                    ${showRole ? `<div class="turn-role" style="font-size: 0.75rem; color: ${color}; text-transform: uppercase; margin-bottom: 0.25rem;">${turn.role}</div>` : ''}
                    <div class="turn-content" style="white-space: pre-wrap;">${escapeHtml(truncated)}</div>
                </div>
            `;
        }).join('');
    }

    // ============================================
    // API CLIENT
    // ============================================

    const api = {
        async save(content, metadata = {}) {
            const response = await fetch('/api/consciousness/curate/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content,
                    title: metadata.title || 'Untitled',
                    topics: metadata.topics || suggestTags(content),
                    source: metadata.source || 'unknown',
                    type: metadata.type || 'conversation',
                    timestamp: Date.now()
                })
            });
            if (!response.ok) throw new Error('Failed to save');
            return response.json();
        },

        async compact(content, style = 'insights') {
            const response = await fetch('/api/consciousness/curate/compact', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content, style })
            });
            if (!response.ok) throw new Error('Failed to compact');
            return response.json();
        },

        async suggestTags(content) {
            const response = await fetch('/api/consciousness/curate/suggest-tags', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content })
            });
            if (!response.ok) throw new Error('Failed to get suggestions');
            return response.json();
        },

        async getRecent(limit = 10) {
            const response = await fetch(`/api/consciousness/curate/recent?limit=${limit}`);
            if (!response.ok) throw new Error('Failed to fetch');
            return response.json();
        }
    };

    // ============================================
    // PUBLIC API
    // ============================================

    return {
        parseConversation,
        suggestTags,
        suggestTagsByCategory,
        calculateStats,
        autoCompact,
        renderPreview,
        api,
        topicPools,
        allTopics
    };

})();
