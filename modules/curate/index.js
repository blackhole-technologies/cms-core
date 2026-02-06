/**
 * Curate Module - Knowledge Bank Curation Engine
 * 
 * Extracted from curate.html prototype.
 * Provides conversation parsing, tag suggestions, compaction, and save functionality.
 * Can be imported anywhere in the CMS.
 */

// ============================================
// TOPIC POOLS - Used for tag suggestions
// ============================================

export const topicPools = {
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

// Flattened list for quick matching
export const allTopics = Object.values(topicPools).flat();

// ============================================
// CONVERSATION PARSER
// ============================================

/**
 * Parse conversation from various formats into structured turns
 * Handles: Human:/Assistant:, User:/AI:, Claude:/GPT:, JSON, plain text
 * 
 * @param {string} text - Raw conversation text
 * @returns {Array<{role: string, content: string}>} Parsed turns
 */
export function parseConversation(text) {
    if (!text || typeof text !== 'string') {
        return [];
    }
    
    const trimmed = text.trim();
    
    // Try JSON first
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        try {
            const json = JSON.parse(trimmed);
            const messages = Array.isArray(json) ? json : json.messages || [json];
            return messages.map(m => ({
                role: normalizeRole(m.role || m.speaker || 'unknown'),
                content: m.content || m.text || m.message || ''
            })).filter(m => m.content);
        } catch {
            // Not valid JSON, continue with text parsing
        }
    }
    
    // Try chat format (Human:/Assistant:, User:/AI:, etc.)
    const chatPattern = /(Human|User|Assistant|AI|Claude|GPT|System):\s*/gi;
    const parts = text.split(chatPattern).filter(p => p.trim());
    
    if (parts.length > 1) {
        const turns = [];
        for (let i = 0; i < parts.length - 1; i += 2) {
            const role = normalizeRole(parts[i]);
            const content = parts[i + 1]?.trim() || '';
            if (content) {
                turns.push({ role, content });
            }
        }
        if (turns.length > 0) {
            return turns;
        }
    }
    
    // Try line-by-line format (lines starting with > or labels)
    const lines = text.split('\n');
    const labelPattern = /^([A-Za-z]+):\s*(.+)$/;
    const quotePattern = /^>\s*(.+)$/;
    
    let currentRole = null;
    let currentContent = [];
    const turns = [];
    
    for (const line of lines) {
        const labelMatch = line.match(labelPattern);
        const quoteMatch = line.match(quotePattern);
        
        if (labelMatch) {
            if (currentRole && currentContent.length) {
                turns.push({ role: currentRole, content: currentContent.join('\n').trim() });
            }
            currentRole = normalizeRole(labelMatch[1]);
            currentContent = [labelMatch[2]];
        } else if (quoteMatch) {
            if (currentRole !== 'quoted') {
                if (currentRole && currentContent.length) {
                    turns.push({ role: currentRole, content: currentContent.join('\n').trim() });
                }
                currentRole = 'quoted';
                currentContent = [];
            }
            currentContent.push(quoteMatch[1]);
        } else if (currentRole) {
            currentContent.push(line);
        }
    }
    
    if (currentRole && currentContent.length) {
        turns.push({ role: currentRole, content: currentContent.join('\n').trim() });
    }
    
    if (turns.length > 0) {
        return turns;
    }
    
    // Fallback: treat as single block
    return [{ role: 'mixed', content: trimmed }];
}

/**
 * Normalize role names to standard format
 */
function normalizeRole(role) {
    const lower = role.toLowerCase().trim();
    if (['human', 'user', 'me', 'i'].includes(lower)) return 'human';
    if (['assistant', 'ai', 'claude', 'gpt', 'gemini', 'bot'].includes(lower)) return 'assistant';
    if (lower === 'system') return 'system';
    return lower;
}

// ============================================
// TAG SUGGESTIONS
// ============================================

/**
 * Suggest relevant tags based on content
 * 
 * @param {string} text - Content to analyze
 * @param {number} maxSuggestions - Max tags to return (default 8)
 * @returns {string[]} Suggested topic tags
 */
export function suggestTags(text, maxSuggestions = 8) {
    if (!text) return [];
    
    const lower = text.toLowerCase();
    const found = [];
    
    for (const topic of allTopics) {
        // Check for whole word match or partial match for longer terms
        const pattern = topic.length > 6 
            ? topic.toLowerCase() 
            : new RegExp(`\\b${topic.toLowerCase()}\\b`);
        
        if (typeof pattern === 'string' ? lower.includes(pattern) : pattern.test(lower)) {
            found.push(topic);
        }
    }
    
    // Sort by specificity (longer terms first) and limit
    return found
        .sort((a, b) => b.length - a.length)
        .slice(0, maxSuggestions);
}

/**
 * Get tag suggestions grouped by category
 */
export function suggestTagsByCategory(text) {
    const lower = text.toLowerCase();
    const result = {};
    
    for (const [category, topics] of Object.entries(topicPools)) {
        const matches = topics.filter(t => lower.includes(t.toLowerCase()));
        if (matches.length > 0) {
            result[category] = matches;
        }
    }
    
    return result;
}

// ============================================
// STATS
// ============================================

/**
 * Calculate statistics for content
 * 
 * @param {string} text - Raw text
 * @param {Array} turns - Parsed turns (optional, will parse if not provided)
 * @returns {Object} Statistics
 */
export function calculateStats(text, turns = null) {
    if (!text) {
        return { turns: 0, words: 0, characters: 0, topics: 0 };
    }
    
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

/**
 * Auto-compact conversation by extracting key insights
 * This is a heuristic version - would be enhanced with LLM
 * 
 * @param {string} text - Full conversation text
 * @param {Object} options - Compaction options
 * @returns {string} Compacted text
 */
export function autoCompact(text, options = {}) {
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
        
        // Score based on keyword presence
        for (const kw of keywords) {
            if (lower.includes(kw)) score += 2;
        }
        
        // Score based on length (prefer substantial lines)
        if (line.length > minLineLength) score += 1;
        if (line.length > 200) score += 1;
        
        // Score based on structure markers
        if (line.match(/^[-*•]\s/)) score += 1; // Bullet points
        if (line.match(/^\d+\.\s/)) score += 1; // Numbered lists
        if (line.match(/^#{1,3}\s/)) score += 2; // Headers
        
        // Penalize very short lines or conversational filler
        if (line.length < 20) score -= 2;
        if (/^(yes|no|okay|right|hmm|ah|oh|I see|interesting)\.?$/i.test(line.trim())) {
            score -= 5;
        }
        
        scored.push({ line, score });
    }
    
    // Sort by score and take top lines, preserving original order
    const threshold = scored.length > maxLines 
        ? scored.map(s => s.score).sort((a, b) => b - a)[maxLines - 1] 
        : -Infinity;
    
    const selected = scored
        .map((s, i) => ({ ...s, index: i }))
        .filter(s => s.score >= threshold)
        .sort((a, b) => a.index - b.index)
        .slice(0, maxLines)
        .map(s => s.line);
    
    return selected.join('\n\n');
}

/**
 * Generate extraction prompt for LLM-based compaction
 */
export function getCompactionPrompt(text, style = 'insights') {
    const prompts = {
        insights: `Extract the core insights from this conversation. Focus on:
- Key realizations or "aha moments"
- Novel connections made between ideas
- Important conclusions or decisions
- Unanswered questions worth revisiting

Preserve the essential meaning in 10-20 bullet points.`,

        summary: `Summarize this conversation in 3-5 paragraphs. Include:
- The main topic and context
- Key points discussed
- Conclusions reached
- Any action items or open questions`,

        distill: `Distill this conversation to its essence. What would someone need to know 
to understand the core ideas without reading the full conversation? 
Be concise but complete. Use direct quotes where they capture something essential.`
    };
    
    return prompts[style] || prompts.insights;
}

// ============================================
// PREVIEW RENDERING
// ============================================

/**
 * Render conversation turns to HTML for preview
 * 
 * @param {Array} turns - Parsed turns
 * @param {Object} options - Rendering options
 * @returns {string} HTML string
 */
export function renderPreview(turns, options = {}) {
    const {
        maxLength = 500,
        showRole = true,
        roleColors = {
            human: 'var(--gold-dim)',
            assistant: 'var(--blue)',
            system: 'var(--purple)',
            mixed: 'var(--text-dim)',
            quoted: 'var(--green)'
        }
    } = options;
    
    if (!turns || turns.length === 0) {
        return '<p class="text-dim font-italic">No content to preview</p>';
    }
    
    return turns.map(turn => {
        const color = roleColors[turn.role] || 'var(--text-dim)';
        const truncated = turn.content.length > maxLength 
            ? turn.content.slice(0, maxLength) + '...'
            : turn.content;
        
        return `
            <div class="turn" style="margin-bottom: 1rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border);">
                ${showRole ? `<div class="turn-role" style="font-size: 0.75rem; color: ${color}; text-transform: uppercase; margin-bottom: 0.25rem;">${turn.role}</div>` : ''}
                <div class="turn-content">${escapeHtml(truncated)}</div>
            </div>
        `;
    }).join('');
}

function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return text.replace(/[&<>"']/g, c => map[c]);
}

// ============================================
// CURATION API CLIENT
// ============================================

/**
 * CurateClient - API wrapper for curation endpoints
 */
export class CurateClient {
    constructor(baseUrl = '') {
        this.baseUrl = baseUrl;
    }
    
    /**
     * Save content to knowledge bank
     */
    async save(content, metadata = {}) {
        const response = await fetch(`${this.baseUrl}/api/curate/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content,
                title: metadata.title || 'Untitled',
                topics: metadata.topics || suggestTags(content),
                source: metadata.source || 'unknown',
                type: metadata.type || 'full',
                timestamp: Date.now()
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to save');
        }
        
        return response.json();
    }
    
    /**
     * Save compacted version
     */
    async saveCompacted(content, originalContent, metadata = {}) {
        return this.save(content, {
            ...metadata,
            type: 'compacted',
            topics: metadata.topics || suggestTags(originalContent || content)
        });
    }
    
    /**
     * Get recent curated items
     */
    async getRecent(limit = 10) {
        const response = await fetch(`${this.baseUrl}/api/curate/recent?limit=${limit}`);
        if (!response.ok) {
            throw new Error('Failed to fetch recent items');
        }
        return response.json();
    }
    
    /**
     * Get single curated item
     */
    async get(id) {
        const response = await fetch(`${this.baseUrl}/api/curate/${id}`);
        if (!response.ok) {
            throw new Error('Item not found');
        }
        return response.json();
    }
}

// ============================================
// CURATE WIDGET
// ============================================

/**
 * CurateWidget - Embeddable curation UI component
 * Can be mounted anywhere in the CMS
 */
export class CurateWidget {
    constructor(container, options = {}) {
        this.container = typeof container === 'string' 
            ? document.querySelector(container) 
            : container;
        this.options = {
            mode: 'full', // 'full' | 'compact' | 'minimal'
            autoSuggest: true,
            showPreview: true,
            showRecent: true,
            onSave: null,
            ...options
        };
        this.client = new CurateClient(options.baseUrl || '');
        this.state = {
            content: '',
            title: '',
            topics: [],
            source: '',
            turns: [],
            stats: null
        };
        
        if (this.container) {
            this.render();
            this.bindEvents();
        }
    }
    
    setState(updates) {
        Object.assign(this.state, updates);
        this.updateUI();
    }
    
    handleInput(content) {
        const turns = parseConversation(content);
        const stats = calculateStats(content, turns);
        const suggestedTopics = this.options.autoSuggest ? suggestTags(content) : [];
        
        this.setState({
            content,
            turns,
            stats,
            topics: [...new Set([...this.state.topics, ...suggestedTopics])]
        });
    }
    
    async save(compact = false) {
        const content = compact 
            ? autoCompact(this.state.content)
            : this.state.content;
        
        try {
            const result = await this.client.save(content, {
                title: this.state.title,
                topics: this.state.topics,
                source: this.state.source,
                type: compact ? 'compacted' : 'full'
            });
            
            if (this.options.onSave) {
                this.options.onSave(result);
            }
            
            this.clear();
            return result;
        } catch (err) {
            console.error('Save failed:', err);
            throw err;
        }
    }
    
    clear() {
        this.setState({
            content: '',
            title: '',
            topics: [],
            source: '',
            turns: [],
            stats: null
        });
    }
    
    render() {
        // Widget HTML structure
        this.container.innerHTML = `
            <div class="curate-widget">
                <div class="curate-input">
                    <textarea class="curate-content" placeholder="Paste conversation..."></textarea>
                    <div class="curate-meta">
                        <input type="text" class="curate-title" placeholder="Title">
                        <input type="text" class="curate-topics" placeholder="Topics (comma-separated)">
                        <input type="text" class="curate-source" placeholder="Source">
                    </div>
                    <div class="curate-suggestions"></div>
                </div>
                ${this.options.showPreview ? '<div class="curate-preview"></div>' : ''}
                <div class="curate-stats"></div>
                <div class="curate-actions">
                    <button class="curate-clear btn btn-secondary">Clear</button>
                    <button class="curate-compact btn btn-purple">Compact & Save</button>
                    <button class="curate-save btn btn-primary">Save Full</button>
                </div>
                ${this.options.showRecent ? '<div class="curate-recent"></div>' : ''}
            </div>
        `;
    }
    
    bindEvents() {
        const content = this.container.querySelector('.curate-content');
        const title = this.container.querySelector('.curate-title');
        const topics = this.container.querySelector('.curate-topics');
        const source = this.container.querySelector('.curate-source');
        
        content?.addEventListener('input', (e) => this.handleInput(e.target.value));
        title?.addEventListener('input', (e) => this.setState({ title: e.target.value }));
        topics?.addEventListener('input', (e) => {
            this.setState({ topics: e.target.value.split(',').map(t => t.trim()).filter(Boolean) });
        });
        source?.addEventListener('input', (e) => this.setState({ source: e.target.value }));
        
        this.container.querySelector('.curate-clear')?.addEventListener('click', () => this.clear());
        this.container.querySelector('.curate-save')?.addEventListener('click', () => this.save(false));
        this.container.querySelector('.curate-compact')?.addEventListener('click', () => this.save(true));
    }
    
    updateUI() {
        // Update preview
        const preview = this.container.querySelector('.curate-preview');
        if (preview && this.state.turns.length > 0) {
            preview.innerHTML = renderPreview(this.state.turns);
        }
        
        // Update stats
        const stats = this.container.querySelector('.curate-stats');
        if (stats && this.state.stats) {
            const s = this.state.stats;
            stats.innerHTML = `
                <span>Turns: <strong>${s.turns}</strong></span>
                <span>Words: <strong>${s.words}</strong></span>
                <span>Topics: <strong>${s.topics}</strong></span>
            `;
        }
        
        // Update suggestions
        const suggestions = this.container.querySelector('.curate-suggestions');
        if (suggestions && this.state.stats?.topicsList?.length > 0) {
            suggestions.innerHTML = this.state.stats.topicsList
                .filter(t => !this.state.topics.includes(t))
                .map(t => `<span class="tag-suggestion" data-topic="${t}">${t}</span>`)
                .join('');
            
            suggestions.querySelectorAll('.tag-suggestion').forEach(el => {
                el.addEventListener('click', () => {
                    const topic = el.dataset.topic;
                    const topicsInput = this.container.querySelector('.curate-topics');
                    const current = topicsInput.value ? topicsInput.value.split(',').map(t => t.trim()) : [];
                    if (!current.includes(topic)) {
                        current.push(topic);
                        topicsInput.value = current.join(', ');
                        this.setState({ topics: current });
                    }
                });
            });
        }
    }
}

// ============================================
// EXPORTS
// ============================================

export default {
    // Core functions
    parseConversation,
    suggestTags,
    suggestTagsByCategory,
    calculateStats,
    autoCompact,
    getCompactionPrompt,
    renderPreview,
    
    // Classes
    CurateClient,
    CurateWidget,
    
    // Data
    topicPools,
    allTopics
};
