/**
 * search.ts - Full-Text Search Indexing
 *
 * WHY THIS EXISTS:
 * Content search via simple string matching is slow and imprecise.
 * A proper search index enables:
 * - Fast full-text search across all content
 * - Relevance scoring based on term frequency
 * - Phrase matching and field-specific searches
 * - Highlighting matched terms in results
 *
 * INDEX STRUCTURE:
 * /content/.search/
 *   index.json     - Main inverted index
 *   meta.json      - Index metadata and stats
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ============================================================================
// Types
// ============================================================================

/** Search configuration */
interface SearchConfig {
    enabled: boolean;
    backend: string;
    minWordLength: number;
    stopWords: string[];
    fuzzy: boolean;
    fuzzyDistance: number;
    baseDir?: string;
    [key: string]: unknown;
}

/** A posting entry in the inverted index */
interface PostingEntry {
    type: string;
    id: string;
    field: string;
    positions: number[];
    tf: number;
    weight: number;
}

/** Document info stored in the index */
interface DocInfo {
    type: string;
    id: string;
    fields: Record<string, number>;
    indexed: string;
}

/** The inverted index structure */
interface SearchIndex {
    terms: Record<string, PostingEntry[]>;
    docs: Record<string, DocInfo>;
    fieldWeights: Record<string, number>;
}

/** Index metadata and stats */
interface SearchMeta {
    version: string;
    lastRebuild: string | null;
    totalDocs: number;
    totalTerms: number;
    typeStats: Record<string, { docs: number; terms: number }>;
}

/** Parsed query structure */
interface ParsedQuery {
    terms: string[];
    phrases: string[];
    fields: Record<string, string[]>;
    exclude: string[];
}

/** Document score accumulator during search */
interface DocScore {
    type: string;
    id: string;
    score: number;
    matches: Record<string, number[]>;
    matchedTerms: Set<string>;
}

/** Individual search result */
interface SearchResultItem {
    type: string;
    id: string;
    score: number;
    item: ContentItem | null;
    highlights?: Record<string, string>;
}

/** Search results container */
interface SearchResults {
    results: SearchResultItem[];
    total: number;
    query: string;
    took: number;
    facets?: Record<string, FacetEntry[]>;
}

/** Facet entry */
interface FacetEntry {
    value: string;
    count: number;
}

/** Search options */
interface SearchOptions {
    types?: string[] | null;
    fields?: string[] | null;
    limit?: number;
    offset?: number;
    highlight?: boolean;
    facets?: string[];
    [key: string]: unknown;
}

/** Content item with flexible fields */
interface ContentItem {
    id: string;
    type?: string;
    title?: string;
    body?: string;
    description?: string;
    summary?: string;
    content?: string | unknown;
    searchExclude?: boolean;
    [key: string]: unknown;
}

/** Schema field definition */
interface SchemaFieldDef {
    type: string;
    searchable?: boolean;
    weight?: number;
    [key: string]: unknown;
}

/** Content service interface */
interface ContentService {
    read(type: string, id: string): ContentItem | null;
    list(type: string): ContentItem[];
    listAll(type: string): ContentItem[];
    listTypes(): Array<{ type: string }>;
    getSchema(type: string): Record<string, SchemaFieldDef> | null;
}

/** Hooks service interface */
interface HooksService {
    register(event: string, handler: (ctx: Record<string, unknown>) => Promise<void>, priority?: number, namespace?: string): void;
}

/** Search backend interface */
interface SearchBackend {
    init?(config: SearchConfig): void | Promise<void>;
    indexItem?(type: string, item: ContentItem, fields: SearchableField[]): void;
    removeFromIndex?(type: string, id: string): void;
    buildIndex?(items: Array<{ type: string; item: ContentItem }>): Record<string, unknown>;
    search?(query: string, options: SearchOptions): SearchResults;
    getStats?(): Record<string, unknown>;
    clearIndex?(): void;
}

/** Search backend factory */
interface SearchBackendFactory {
    create(config: SearchConfig): SearchBackend;
}

/** Vector index entry */
interface VectorEntry {
    embedding: number[];
    text: string;
    type: string;
    id: string;
}

/** Semantic search result */
interface SemanticSearchResult {
    type: string;
    id: string;
    score: number;
    snippet: string;
}

/** Semantic search results container */
interface SemanticSearchResults {
    results: SemanticSearchResult[];
    total: number;
    query: string;
    took: number;
    mode: string;
}

/** Semantic search options */
interface SemanticSearchOptions {
    limit?: number;
    types?: string[] | null;
    minScore?: number;
}

/** AI provider manager interface */
interface AIProviderManager {
    routeToProvider(type: string, inputs: string[]): Promise<{ embedding?: number[] } | number[] | unknown>;
}

/** Build index result */
interface BuildIndexResult {
    types: number;
    docs: number;
    terms: number;
}

/** Searchable field with weight */
interface SearchableField {
    field: string;
    weight: number;
}

// ============================================================================
// State
// ============================================================================
let config: SearchConfig = {
    enabled: true,
    backend: 'builtin',
    minWordLength: 2,
    stopWords: ['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
        'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
        'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
        'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
        'from', 'as', 'into', 'through', 'during', 'before', 'after',
        'above', 'below', 'between', 'under', 'again', 'further', 'then',
        'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all',
        'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
        'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
        'and', 'but', 'if', 'or', 'because', 'until', 'while', 'this',
        'that', 'these', 'those', 'it', 'its'],
    fuzzy: false,
    fuzzyDistance: 1,
};
const backends: Record<string, SearchBackendFactory> = {};
let activeBackend: SearchBackend | null = null;
let baseDir: string | null = null;
let contentService: ContentService | null = null;
let hooksServiceRef: HooksService | null = null;
let searchDir: string | null = null;
let index: SearchIndex = { terms: {}, docs: {}, fieldWeights: {} };
let meta: SearchMeta = {
    version: '1.0.0',
    lastRebuild: null,
    totalDocs: 0,
    totalTerms: 0,
    typeStats: {},
};

// ============================================================================
// Backend Registry
// ============================================================================
export function registerBackend(backendName: string, factory: SearchBackendFactory): void {
    backends[backendName] = factory;
    console.log(`[search] Registered backend: ${backendName}`);
}

export function getBackends(): string[] {
    return ['builtin', ...Object.keys(backends)];
}

export async function setBackend(backendName: string, backendConfig: Partial<SearchConfig> = {}): Promise<void> {
    if (backendName === 'builtin') {
        activeBackend = null;
        config.backend = 'builtin';
        console.log('[search] Switched to built-in backend');
        return;
    }
    const factory = backends[backendName];
    if (!factory) {
        throw new Error(`[search] Unknown backend: ${backendName}. Registered: ${getBackends().join(', ')}`);
    }
    activeBackend = factory.create({ ...config, ...backendConfig } as SearchConfig);
    if (activeBackend.init)
        await activeBackend.init({ ...config, ...backendConfig } as SearchConfig);
    config.backend = backendName;
    console.log(`[search] Switched to backend: ${backendName}`);
}

// ============================================================================
// Initialization
// ============================================================================
export function init(dir: string, searchConfig: Partial<SearchConfig> = {}, content: ContentService | null = null, hooks: HooksService | null = null): void {
    baseDir = dir;
    contentService = content;
    hooksServiceRef = hooks;
    config = { ...config, ...searchConfig };
    searchDir = join(baseDir, 'content', '.search');
    if (!existsSync(searchDir)) {
        mkdirSync(searchDir, { recursive: true });
    }
    const backendName = config.backend;
    if (backendName && backendName !== 'builtin' && backends[backendName]) {
        try {
            activeBackend = backends[backendName]!.create(config);
            if (activeBackend.init) {
                const initResult = activeBackend.init(config);
                if (initResult && typeof (initResult as Promise<void>).catch === 'function') {
                    (initResult as Promise<void>).catch((err: Error) => {
                        console.warn(`[search] Backend '${backendName}' async init failed: ${err.message}`);
                        activeBackend = null;
                        config.backend = 'builtin';
                        loadIndex();
                    });
                }
            }
            console.log(`[search] Using backend: ${backendName}`);
        }
        catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.warn(`[search] Failed to init backend '${backendName}', falling back to builtin: ${errMsg}`);
            activeBackend = null;
            config.backend = 'builtin';
        }
    }
    if (!activeBackend) {
        loadIndex();
    }
    if (hooksServiceRef && config.enabled) {
        hooksServiceRef.register('content:afterCreate', (async (ctx: Record<string, unknown>): Promise<void> => {
            const { type, item } = ctx as { type: string; item: ContentItem };
            indexItem(type, item);
            saveIndex();
        }), 5, 'search');
        hooksServiceRef.register('content:afterUpdate', (async (ctx: Record<string, unknown>): Promise<void> => {
            const { type, item } = ctx as { type: string; item: ContentItem };
            indexItem(type, item);
            saveIndex();
        }), 5, 'search');
        hooksServiceRef.register('content:afterDelete', (async (ctx: Record<string, unknown>): Promise<void> => {
            const { type, id } = ctx as { type: string; id: string };
            removeFromIndex(type, id);
            saveIndex();
        }), 5, 'search');
    }
}

// ============================================================================
// Index Persistence
// ============================================================================
function loadIndex(): void {
    const indexPath = join(searchDir!, 'index.json');
    const metaPath = join(searchDir!, 'meta.json');
    if (existsSync(indexPath)) {
        try {
            index = JSON.parse(readFileSync(indexPath, 'utf-8')) as SearchIndex;
        }
        catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            console.warn(`[search] Failed to load index: ${errMsg}`);
            index = { terms: {}, docs: {}, fieldWeights: {} };
        }
    }
    if (existsSync(metaPath)) {
        try {
            meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as SearchMeta;
        }
        catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            console.warn(`[search] Failed to load meta: ${errMsg}`);
        }
    }
}

function saveIndex(): void {
    if (!searchDir)
        return;
    const indexPath = join(searchDir, 'index.json');
    const metaPath = join(searchDir, 'meta.json');
    try {
        writeFileSync(indexPath, JSON.stringify(index));
        writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    }
    catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error(`[search] Failed to save index: ${errMsg}`);
    }
}

// ============================================================================
// Tokenization
// ============================================================================
function tokenize(text: string): string[] {
    if (!text || typeof text !== 'string')
        return [];
    const normalized = text.toLowerCase().replace(/[^\w\s'-]/g, ' ').replace(/[-']/g, ' ');
    const words = normalized.split(/\s+/).filter(w => w.length >= config.minWordLength);
    return words.filter(w => !config.stopWords.includes(w)).map(w => stem(w));
}

function stem(word: string): string {
    const suffixes = ['ing', 'ed', 'es', 's', 'er', 'est', 'ly', 'ment', 'ness', 'tion', 'sion', 'ity'];
    for (const suffix of suffixes) {
        if (word.length > suffix.length + 2 && word.endsWith(suffix)) {
            const stemmed = word.slice(0, -suffix.length);
            if (stemmed.length > 2 && stemmed[stemmed.length - 1] === stemmed[stemmed.length - 2]) {
                return stemmed.slice(0, -1);
            }
            return stemmed;
        }
    }
    return word;
}

function getSearchableFields(type: string): SearchableField[] {
    if (!contentService)
        return [];
    const schema = contentService.getSchema(type);
    if (!schema)
        return [];
    const fields: SearchableField[] = [];
    for (const [field, def] of Object.entries(schema)) {
        if (def.type === 'string' && def.searchable !== false) {
            const weight = def.weight ?? 1;
            fields.push({ field, weight });
            index.fieldWeights[`${type}:${field}`] = weight;
        }
    }
    if (!fields.some(f => f.field === 'id')) {
        fields.push({ field: 'id', weight: 0.5 });
    }
    return fields;
}

// ============================================================================
// Indexing
// ============================================================================
export function indexItem(type: string, item: ContentItem): void {
    if (!config.enabled)
        return;
    if (!item || !item.id)
        return;
    if (item.searchExclude === true) {
        removeFromIndex(type, item.id);
        return;
    }
    if (activeBackend && activeBackend.indexItem) {
        const fields = getSearchableFields(type);
        activeBackend.indexItem(type, item, fields);
        return;
    }
    const docKey = `${type}:${item.id}`;
    removeFromIndex(type, item.id);
    const searchableFields = getSearchableFields(type);
    if (searchableFields.length === 0) {
        for (const [field, value] of Object.entries(item)) {
            if (typeof value === 'string' && !field.startsWith('_')) {
                searchableFields.push({ field, weight: 1 });
            }
        }
    }
    const docInfo: DocInfo = { type, id: item.id, fields: {}, indexed: new Date().toISOString() };
    for (const { field, weight } of searchableFields) {
        const value = item[field];
        if (!value || typeof value !== 'string')
            continue;
        const tokens = tokenize(value);
        docInfo.fields[field] = tokens.length;
        const termPositions: Record<string, number[]> = {};
        tokens.forEach((term, position) => {
            if (!termPositions[term])
                termPositions[term] = [];
            termPositions[term]!.push(position);
        });
        for (const [term, positions] of Object.entries(termPositions)) {
            if (!index.terms[term])
                index.terms[term] = [];
            const tf = positions.length / tokens.length;
            index.terms[term]!.push({ type, id: item.id, field, positions, tf, weight });
        }
    }
    index.docs[docKey] = docInfo;
    updateStats();
}

export function removeFromIndex(type: string, id: string): void {
    if (activeBackend && activeBackend.removeFromIndex) {
        activeBackend.removeFromIndex(type, id);
        return;
    }
    delete index.docs[`${type}:${id}`];
    for (const term of Object.keys(index.terms)) {
        index.terms[term] = index.terms[term]!.filter(entry => !(entry.type === type && entry.id === id));
        if (index.terms[term]!.length === 0)
            delete index.terms[term];
    }
    updateStats();
}

export function buildIndex(type: string | null = null): BuildIndexResult | Record<string, unknown> {
    if (!contentService)
        throw new Error('Content service not initialized');
    if (activeBackend && activeBackend.buildIndex) {
        const types = type ? [{ type }] : contentService.listTypes();
        const items: Array<{ type: string; item: ContentItem }> = [];
        for (const { type: t } of types) {
            for (const item of contentService.list(t))
                items.push({ type: t, item });
        }
        return activeBackend.buildIndex(items);
    }
    const types = type ? [{ type }] : contentService.listTypes();
    let totalDocs = 0;
    if (type) {
        for (const term of Object.keys(index.terms)) {
            index.terms[term] = index.terms[term]!.filter(e => e.type !== type);
            if (index.terms[term]!.length === 0)
                delete index.terms[term];
        }
        for (const docKey of Object.keys(index.docs)) {
            if (docKey.startsWith(`${type}:`))
                delete index.docs[docKey];
        }
    }
    else {
        index = { terms: {}, docs: {}, fieldWeights: {} };
    }
    for (const { type: contentType } of types) {
        for (const item of contentService.listAll(contentType)) {
            indexItem(contentType, item);
            totalDocs++;
        }
    }
    meta.lastRebuild = new Date().toISOString();
    updateStats();
    saveIndex();
    return { types: types.length, docs: totalDocs, terms: Object.keys(index.terms).length };
}

function updateStats(): void {
    meta.totalDocs = Object.keys(index.docs).length;
    meta.totalTerms = Object.keys(index.terms).length;
    meta.typeStats = {};
    for (const docKey of Object.keys(index.docs)) {
        const [docType] = docKey.split(':');
        if (!meta.typeStats[docType!])
            meta.typeStats[docType!] = { docs: 0, terms: 0 };
        meta.typeStats[docType!]!.docs++;
    }
    for (const [, entries] of Object.entries(index.terms)) {
        const typesSeen = new Set<string>();
        for (const entry of entries) {
            if (!typesSeen.has(entry.type)) {
                typesSeen.add(entry.type);
                if (meta.typeStats[entry.type])
                    meta.typeStats[entry.type]!.terms++;
            }
        }
    }
}

// ============================================================================
// Query Parsing
// ============================================================================
function parseQuery(query: string): ParsedQuery {
    const result: ParsedQuery = { terms: [], phrases: [], fields: {}, exclude: [] };
    if (!query || typeof query !== 'string')
        return result;
    const phraseRegex = /"([^"]+)"/g;
    let match: RegExpExecArray | null;
    let remaining = query;
    while ((match = phraseRegex.exec(query)) !== null) {
        result.phrases.push(match[1]!.toLowerCase());
        remaining = remaining.replace(match[0], ' ');
    }
    const parts = remaining.split(/\s+/).filter(p => p.length > 0);
    for (const part of parts) {
        if (part.startsWith('-') && part.length > 1) {
            const term = stem(part.slice(1).toLowerCase());
            if (term.length >= config.minWordLength)
                result.exclude.push(term);
            continue;
        }
        if (part.includes(':')) {
            const [field, value] = part.split(':', 2) as [string, string];
            if (field && value) {
                if (!result.fields[field])
                    result.fields[field] = [];
                const term = stem(value.toLowerCase());
                if (term.length >= config.minWordLength && !config.stopWords.includes(term)) {
                    result.fields[field]!.push(term);
                }
            }
            continue;
        }
        const term = stem(part.toLowerCase());
        if (term.length >= config.minWordLength && !config.stopWords.includes(term)) {
            result.terms.push(term);
        }
    }
    return result;
}

// ============================================================================
// Fuzzy Matching
// ============================================================================
function levenshtein(a: string, b: string): number {
    if (a.length === 0)
        return b.length;
    if (b.length === 0)
        return a.length;
    const matrix: number[][] = [];
    for (let i = 0; i <= b.length; i++)
        matrix[i] = [i];
    for (let j = 0; j <= a.length; j++)
        matrix[0]![j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i]![j] = matrix[i - 1]![j - 1]!;
            }
            else {
                matrix[i]![j] = Math.min(matrix[i - 1]![j - 1]! + 1, matrix[i]![j - 1]! + 1, matrix[i - 1]![j]! + 1);
            }
        }
    }
    return matrix[b.length]![a.length]!;
}

function findFuzzyMatches(term: string): string[] {
    if (!config.fuzzy)
        return [term];
    const matches = [term];
    for (const indexedTerm of Object.keys(index.terms)) {
        if (indexedTerm === term)
            continue;
        if (levenshtein(term, indexedTerm) <= config.fuzzyDistance)
            matches.push(indexedTerm);
    }
    return matches;
}

// ============================================================================
// Search
// ============================================================================
export function search(query: string, options: SearchOptions = {}): SearchResults {
    if (activeBackend && activeBackend.search)
        return activeBackend.search(query, options);
    const startTime = Date.now();
    const { types = null, fields = null, limit = 20, offset = 0, highlight = true } = options;
    const parsed = parseQuery(query);
    if (parsed.terms.length === 0 && parsed.phrases.length === 0 && Object.keys(parsed.fields).length === 0) {
        return { results: [], total: 0, query, took: Date.now() - startTime };
    }
    const docScores: Record<string, DocScore> = {};
    for (const term of parsed.terms) {
        for (const matchTerm of findFuzzyMatches(term)) {
            const entries = index.terms[matchTerm] ?? [];
            for (const entry of entries) {
                if (types && !types.includes(entry.type))
                    continue;
                if (fields && !fields.includes(entry.field))
                    continue;
                const docKey = `${entry.type}:${entry.id}`;
                if (!docScores[docKey]) {
                    docScores[docKey] = { type: entry.type, id: entry.id, score: 0, matches: {}, matchedTerms: new Set() };
                }
                const idf = Math.log(meta.totalDocs / entries.length + 1);
                const doc = docScores[docKey]!;
                doc.score += entry.tf * entry.weight * idf;
                doc.matchedTerms.add(term);
                if (!doc.matches[entry.field])
                    doc.matches[entry.field] = [];
                doc.matches[entry.field]!.push(...entry.positions);
            }
        }
    }
    for (const [field, terms] of Object.entries(parsed.fields)) {
        for (const term of terms) {
            for (const matchTerm of findFuzzyMatches(term)) {
                const entries = index.terms[matchTerm] ?? [];
                for (const entry of entries) {
                    if (entry.field !== field)
                        continue;
                    if (types && !types.includes(entry.type))
                        continue;
                    const docKey = `${entry.type}:${entry.id}`;
                    if (!docScores[docKey]) {
                        docScores[docKey] = { type: entry.type, id: entry.id, score: 0, matches: {}, matchedTerms: new Set() };
                    }
                    const idf = Math.log(meta.totalDocs / entries.length + 1);
                    const doc = docScores[docKey]!;
                    doc.score += entry.tf * entry.weight * idf * 1.5;
                    doc.matchedTerms.add(term);
                    if (!doc.matches[entry.field])
                        doc.matches[entry.field] = [];
                    doc.matches[entry.field]!.push(...entry.positions);
                }
            }
        }
    }
    if (parsed.phrases.length > 0) {
        for (const docKey of Object.keys(docScores)) {
            const docEntry = docScores[docKey]!;
            const item = contentService?.read(docEntry.type, docEntry.id);
            if (!item) {
                delete docScores[docKey];
                continue;
            }
            let allMatch = true;
            for (const phrase of parsed.phrases) {
                let found = false;
                for (const [field, value] of Object.entries(item)) {
                    if (typeof value === 'string' && value.toLowerCase().includes(phrase)) {
                        found = true;
                        const pos = value.toLowerCase().indexOf(phrase);
                        if (!docEntry.matches[field])
                            docEntry.matches[field] = [];
                        docEntry.matches[field]!.push(pos);
                        break;
                    }
                }
                if (!found) {
                    allMatch = false;
                    break;
                }
            }
            if (!allMatch)
                delete docScores[docKey];
            else
                docEntry.score *= 1.5;
        }
    }
    if (parsed.exclude.length > 0) {
        for (const docKey of Object.keys(docScores)) {
            const excludeEntry = docScores[docKey]!;
            const item = contentService?.read(excludeEntry.type, excludeEntry.id);
            if (!item)
                continue;
            for (const excludeTerm of parsed.exclude) {
                let found = false;
                for (const [, value] of Object.entries(item)) {
                    if (typeof value === 'string' && tokenize(value).includes(excludeTerm)) {
                        found = true;
                        break;
                    }
                }
                if (found) {
                    delete docScores[docKey];
                    break;
                }
            }
        }
    }
    const requiredTermCount = parsed.terms.length + Object.values(parsed.fields).flat().length;
    if (requiredTermCount > 1) {
        for (const docKey of Object.keys(docScores)) {
            if (docScores[docKey]!.matchedTerms.size < requiredTermCount)
                delete docScores[docKey];
        }
    }
    const sortedDocs = Object.values(docScores).sort((a, b) => b.score - a.score);
    const total = sortedDocs.length;
    const paginated = sortedDocs.slice(offset, offset + limit);
    const results: SearchResultItem[] = paginated.map(doc => {
        const item = contentService?.read(doc.type, doc.id) ?? null;
        const resultItem: SearchResultItem = {
            type: doc.type, id: doc.id,
            score: Math.round(doc.score * 100) / 100,
            item: item,
        };
        if (highlight && item)
            resultItem.highlights = generateHighlights(item, doc.matches, parsed);
        return resultItem;
    });
    let facetResults: Record<string, FacetEntry[]> | null = null;
    if (options.facets && Array.isArray(options.facets) && contentService) {
        facetResults = buildFacets(sortedDocs, options.facets);
    }
    const searchResult: SearchResults = { results, total, query, took: Date.now() - startTime };
    if (facetResults)
        searchResult.facets = facetResults;
    return searchResult;
}

// ============================================================================
// Facets
// ============================================================================
function buildFacets(docs: DocScore[], facetFields: string[]): Record<string, FacetEntry[]> {
    const facets: Record<string, FacetEntry[]> = {};
    for (const field of facetFields) {
        const counts: Record<string, number> = {};
        for (const doc of docs) {
            const item = contentService?.read(doc.type, doc.id);
            if (!item)
                continue;
            if (field === '_type') {
                counts[doc.type] = (counts[doc.type] ?? 0) + 1;
                continue;
            }
            const value = item[field];
            if (value == null)
                continue;
            if (Array.isArray(value)) {
                for (const v of value) {
                    const str = String(v);
                    counts[str] = (counts[str] ?? 0) + 1;
                }
            }
            else {
                const str = String(value);
                counts[str] = (counts[str] ?? 0) + 1;
            }
        }
        facets[field] = Object.entries(counts).map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
    }
    return facets;
}

export function getFacets(facetFields: string[], options: { types?: string[] | null } = {}): Record<string, FacetEntry[]> {
    if (!contentService)
        return {};
    const { types = null } = options;
    const facets: Record<string, FacetEntry[]> = {};
    const allDocs = Object.values(index.docs);
    for (const field of facetFields) {
        const counts: Record<string, number> = {};
        for (const doc of allDocs) {
            if (types && !types.includes(doc.type))
                continue;
            if (field === '_type') {
                counts[doc.type] = (counts[doc.type] ?? 0) + 1;
                continue;
            }
            const item = contentService.read(doc.type, doc.id);
            if (!item)
                continue;
            const value = item[field];
            if (value == null)
                continue;
            if (Array.isArray(value)) {
                for (const v of value) {
                    const str = String(v);
                    counts[str] = (counts[str] ?? 0) + 1;
                }
            }
            else {
                const str = String(value);
                counts[str] = (counts[str] ?? 0) + 1;
            }
        }
        facets[field] = Object.entries(counts).map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
    }
    return facets;
}

// ============================================================================
// Highlighting
// ============================================================================
function generateHighlights(item: ContentItem, matches: Record<string, number[]>, parsed: ParsedQuery): Record<string, string> {
    const highlights: Record<string, string> = {};
    const snippetLength = 100;
    for (const [field, positions] of Object.entries(matches)) {
        const value = item[field];
        if (!value || typeof value !== 'string')
            continue;
        const bestPos = positions.length > 0 ? Math.min(...positions) : 0;
        let start = Math.max(0, bestPos - snippetLength / 2);
        let end = Math.min(value.length, start + snippetLength);
        if (start > 0) {
            const spacePos = value.indexOf(' ', start);
            if (spacePos !== -1 && spacePos < start + 20)
                start = spacePos + 1;
        }
        if (end < value.length) {
            const spacePos = value.lastIndexOf(' ', end);
            if (spacePos !== -1 && spacePos > end - 20)
                end = spacePos;
        }
        let snippet = value.slice(start, end);
        if (start > 0)
            snippet = '...' + snippet;
        if (end < value.length)
            snippet = snippet + '...';
        const allTerms = [...parsed.terms, ...Object.values(parsed.fields).flat()];
        for (const term of allTerms) {
            snippet = snippet.replace(new RegExp(`\\b(${term}\\w*)\\b`, 'gi'), '<<$1>>');
        }
        for (const phrase of parsed.phrases) {
            snippet = snippet.replace(new RegExp(`(${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<<$1>>');
        }
        highlights[field] = snippet;
    }
    return highlights;
}

// ============================================================================
// Stats & Config
// ============================================================================
export function getStats(): Record<string, unknown> {
    if (activeBackend && activeBackend.getStats) {
        return { backend: config.backend, ...activeBackend.getStats() };
    }
    return {
        backend: 'builtin', enabled: config.enabled,
        totalDocs: meta.totalDocs, totalTerms: meta.totalTerms,
        lastRebuild: meta.lastRebuild, typeStats: meta.typeStats,
        registeredBackends: getBackends(),
        config: { minWordLength: config.minWordLength, stopWordsCount: config.stopWords.length, fuzzy: config.fuzzy, fuzzyDistance: config.fuzzyDistance },
    };
}

export function getConfig(): SearchConfig { return { ...config }; }

export function isEnabled(): boolean { return config.enabled; }

export function clearIndex(): void {
    if (activeBackend && activeBackend.clearIndex) {
        activeBackend.clearIndex();
        return;
    }
    index = { terms: {}, docs: {}, fieldWeights: {} };
    meta = { version: '1.0.0', lastRebuild: null, totalDocs: 0, totalTerms: 0, typeStats: {} };
    saveIndex();
}

// ============================================================================
// Vector / Semantic Search
// ============================================================================
let vectorIndex: Record<string, VectorEntry> = {};
let aiProviderRef: AIProviderManager | null = null;
const VECTOR_INDEX_FILE = 'vectors.json';

export function initVectorSearch(providerManager: AIProviderManager, hooks: HooksService | null): void {
    aiProviderRef = providerManager;
    loadVectorIndex();
    if (hooks) {
        hooks.register('content:afterCreate', (async (ctx: Record<string, unknown>): Promise<void> => {
            const { type, item } = ctx as { type: string; item: ContentItem };
            const text = extractTextContent(item);
            if (text)
                await vectorIndexItem(type, item.id, text);
        }), 10, 'vector-search');
        hooks.register('content:afterUpdate', (async (ctx: Record<string, unknown>): Promise<void> => {
            const { type, item } = ctx as { type: string; item: ContentItem };
            const text = extractTextContent(item);
            if (text)
                await vectorIndexItem(type, item.id, text);
        }), 10, 'vector-search');
        hooks.register('content:afterDelete', (async (ctx: Record<string, unknown>): Promise<void> => {
            const { type, id } = ctx as { type: string; id: string };
            vectorRemoveItem(type, id);
        }), 10, 'vector-search');
    }
}

function extractTextContent(item: ContentItem): string {
    const parts: string[] = [];
    if (item.title)
        parts.push(item.title);
    if (item.body && typeof item.body === 'string')
        parts.push(item.body);
    if (item.description)
        parts.push(item.description);
    if (item.summary)
        parts.push(item.summary);
    if (item.content)
        parts.push(typeof item.content === 'string' ? item.content : '');
    return parts.join(' ').replace(/<[^>]+>/g, '').trim();
}

function loadVectorIndex(): void {
    try {
        const filePath = join(config.baseDir ?? '.', 'content', '.search', VECTOR_INDEX_FILE);
        if (existsSync(filePath)) {
            vectorIndex = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, VectorEntry>;
        }
    }
    catch {
        vectorIndex = {};
    }
}

function saveVectorIndex(): void {
    try {
        const dir = join(config.baseDir ?? '.', 'content', '.search');
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, VECTOR_INDEX_FILE), JSON.stringify(vectorIndex));
    }
    catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error('[search] Failed to save vector index:', errMsg);
    }
}

async function getEmbedding(text: string): Promise<number[]> {
    if (aiProviderRef) {
        try {
            const result = await aiProviderRef.routeToProvider('embedding', [text]);
            if (result && typeof result === 'object' && 'embedding' in (result as Record<string, unknown>) && (result as Record<string, unknown>).embedding) {
                return (result as { embedding: number[] }).embedding;
            }
            if (Array.isArray(result))
                return result as number[];
        }
        catch { /* fall through to fallback */ }
    }
    const dims = 256;
    const vec: number[] = new Array(dims).fill(0) as number[];
    const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
    for (const word of words) {
        if (word.length < 2)
            continue;
        let hash = 0;
        for (let i = 0; i < word.length; i++) {
            hash = ((hash << 5) - hash + word.charCodeAt(i)) & 0x7fffffff;
        }
        vec[hash % dims]! += 1;
    }
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map(v => v / norm);
}

export async function vectorIndexItem(type: string, id: string, text: string): Promise<void> {
    if (!text || text.length < 10)
        return;
    const key = `${type}:${id}`;
    const embedding = await getEmbedding(text);
    vectorIndex[key] = { embedding, text: text.slice(0, 500), type, id };
    saveVectorIndex();
}

export function vectorRemoveItem(type: string, id: string): void {
    delete vectorIndex[`${type}:${id}`];
    saveVectorIndex();
}

function cosineSimilarity(a: number[], b: number[]): number {
    if (!a || !b || a.length !== b.length)
        return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i]! * b[i]!;
        normA += a[i]! * a[i]!;
        normB += b[i]! * b[i]!;
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

export async function semanticSearch(query: string, options: SemanticSearchOptions = {}): Promise<SemanticSearchResults> {
    const startTime = Date.now();
    const { limit = 10, types = null, minScore = 0.1 } = options;
    const queryEmbedding = await getEmbedding(query);
    const scored: Array<VectorEntry & { score: number; key: string }> = [];
    for (const [key, entry] of Object.entries(vectorIndex)) {
        if (types && !types.includes(entry.type))
            continue;
        const score = cosineSimilarity(queryEmbedding, entry.embedding);
        if (score >= minScore)
            scored.push({ ...entry, score, key });
    }
    scored.sort((a, b) => b.score - a.score);
    const results: SemanticSearchResult[] = scored.slice(0, limit).map(r => ({
        type: r.type, id: r.id, score: Math.round(r.score * 1000) / 1000, snippet: r.text,
    }));
    return { results, total: scored.length, query, took: Date.now() - startTime, mode: 'semantic' };
}
