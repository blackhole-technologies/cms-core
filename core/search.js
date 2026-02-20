/**
 * search.js - Full-Text Search Indexing
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
 *
 * INVERTED INDEX:
 * Maps terms → list of documents containing that term
 * {
 *   "hello": [
 *     { type: "greeting", id: "abc", field: "message", positions: [0, 15], score: 1.5 }
 *   ]
 * }
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Configuration
 */
let config = {
  enabled: true,
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

/**
 * Base directory and content service reference
 */
let baseDir = null;
let contentService = null;
let hooksService = null;
let searchDir = null;

/**
 * In-memory index (loaded from disk)
 */
let index = {
  terms: {},      // term → [{ type, id, field, positions, tf }]
  docs: {},       // "type:id" → { type, id, fields: { field: wordCount }, indexed: timestamp }
  fieldWeights: {},  // "type:field" → weight
};

/**
 * Index metadata
 */
let meta = {
  version: '1.0.0',
  lastRebuild: null,
  totalDocs: 0,
  totalTerms: 0,
  typeStats: {},  // type → { docs, terms }
};

/**
 * Initialize search system
 *
 * @param {string} dir - Base directory
 * @param {Object} searchConfig - Search configuration
 * @param {Object} content - Content service reference
 * @param {Object} hooks - Hooks service reference
 */
export function init(dir, searchConfig = {}, content = null, hooks = null) {
  baseDir = dir;
  contentService = content;
  hooksService = hooks;

  // Merge config
  config = { ...config, ...searchConfig };

  // Setup search directory
  searchDir = join(baseDir, 'content', '.search');
  if (!existsSync(searchDir)) {
    mkdirSync(searchDir, { recursive: true });
  }

  // Load existing index
  loadIndex();

  // Register content hooks for auto-indexing
  if (hooksService && config.enabled) {
    hooksService.register('content:afterCreate', async ({ type, item }) => {
      indexItem(type, item);
      saveIndex();
    }, 5, 'search');

    hooksService.register('content:afterUpdate', async ({ type, item }) => {
      indexItem(type, item);
      saveIndex();
    }, 5, 'search');

    hooksService.register('content:afterDelete', async ({ type, id }) => {
      removeFromIndex(type, id);
      saveIndex();
    }, 5, 'search');
  }
}

/**
 * Load index from disk
 * @private
 */
function loadIndex() {
  const indexPath = join(searchDir, 'index.json');
  const metaPath = join(searchDir, 'meta.json');

  if (existsSync(indexPath)) {
    try {
      const data = JSON.parse(readFileSync(indexPath, 'utf-8'));
      index = data;
    } catch (error) {
      console.warn(`[search] Failed to load index: ${error.message}`);
      index = { terms: {}, docs: {}, fieldWeights: {} };
    }
  }

  if (existsSync(metaPath)) {
    try {
      meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    } catch (error) {
      console.warn(`[search] Failed to load meta: ${error.message}`);
    }
  }
}

/**
 * Save index to disk
 * @private
 */
function saveIndex() {
  if (!searchDir) return;

  const indexPath = join(searchDir, 'index.json');
  const metaPath = join(searchDir, 'meta.json');

  try {
    writeFileSync(indexPath, JSON.stringify(index));
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  } catch (error) {
    console.error(`[search] Failed to save index: ${error.message}`);
  }
}

/**
 * Normalize text for indexing
 * - Lowercase
 * - Remove punctuation
 * - Stem common suffixes (simple)
 *
 * @param {string} text - Text to normalize
 * @returns {string[]} - Array of normalized tokens
 * @private
 */
function tokenize(text) {
  if (!text || typeof text !== 'string') return [];

  // Lowercase and remove punctuation
  const normalized = text
    .toLowerCase()
    .replace(/[^\w\s'-]/g, ' ')
    .replace(/[-']/g, ' ');

  // Split into words
  const words = normalized.split(/\s+/).filter(w => w.length >= config.minWordLength);

  // Filter stop words and stem
  return words
    .filter(w => !config.stopWords.includes(w))
    .map(w => stem(w));
}

/**
 * Simple suffix stemming
 * Removes common English suffixes
 *
 * @param {string} word - Word to stem
 * @returns {string} - Stemmed word
 * @private
 */
function stem(word) {
  // Very simple stemmer - just removes common suffixes
  // For production, use Porter Stemmer or similar
  const suffixes = ['ing', 'ed', 'es', 's', 'er', 'est', 'ly', 'ment', 'ness', 'tion', 'sion', 'ity'];

  for (const suffix of suffixes) {
    if (word.length > suffix.length + 2 && word.endsWith(suffix)) {
      const stemmed = word.slice(0, -suffix.length);
      // Handle doubling (running → run, not runn)
      if (stemmed.length > 2 && stemmed[stemmed.length - 1] === stemmed[stemmed.length - 2]) {
        return stemmed.slice(0, -1);
      }
      return stemmed;
    }
  }

  return word;
}

/**
 * Get searchable fields for a content type
 *
 * @param {string} type - Content type
 * @returns {Array<{ field: string, weight: number }>}
 * @private
 */
function getSearchableFields(type) {
  if (!contentService) return [];

  const schema = contentService.getSchema(type);
  if (!schema) return [];

  const fields = [];

  for (const [field, def] of Object.entries(schema)) {
    // Only index string fields that are searchable
    if (def.type === 'string' && def.searchable !== false) {
      const weight = def.weight || 1;
      fields.push({ field, weight });

      // Cache field weight
      index.fieldWeights[`${type}:${field}`] = weight;
    }
  }

  // Always index id and common fields
  if (!fields.some(f => f.field === 'id')) {
    fields.push({ field: 'id', weight: 0.5 });
  }

  return fields;
}

/**
 * Index a single content item
 *
 * @param {string} type - Content type
 * @param {Object} item - Content item to index
 */
export function indexItem(type, item) {
  if (!config.enabled) return;
  if (!item || !item.id) return;

  // Per-entity search exclusion (Drupal parity: search_api_exclude)
  // Content items with searchExclude=true are skipped from indexing.
  if (item.searchExclude === true) {
    removeFromIndex(type, item.id);
    return;
  }

  const docKey = `${type}:${item.id}`;

  // Remove old entries for this document
  removeFromIndex(type, item.id);

  // Get searchable fields
  const searchableFields = getSearchableFields(type);
  if (searchableFields.length === 0) {
    // If no schema, index all string fields
    for (const [field, value] of Object.entries(item)) {
      if (typeof value === 'string' && !field.startsWith('_')) {
        searchableFields.push({ field, weight: 1 });
      }
    }
  }

  // Track document info
  const docInfo = {
    type,
    id: item.id,
    fields: {},
    indexed: new Date().toISOString(),
  };

  // Index each field
  for (const { field, weight } of searchableFields) {
    const value = item[field];
    if (!value || typeof value !== 'string') continue;

    const tokens = tokenize(value);
    docInfo.fields[field] = tokens.length;

    // Track positions for each term
    const termPositions = {};
    tokens.forEach((term, position) => {
      if (!termPositions[term]) {
        termPositions[term] = [];
      }
      termPositions[term].push(position);
    });

    // Add to inverted index
    for (const [term, positions] of Object.entries(termPositions)) {
      if (!index.terms[term]) {
        index.terms[term] = [];
      }

      // Calculate term frequency (tf)
      const tf = positions.length / tokens.length;

      index.terms[term].push({
        type,
        id: item.id,
        field,
        positions,
        tf,
        weight,
      });
    }
  }

  // Store document info
  index.docs[docKey] = docInfo;

  // Update stats
  updateStats();
}

/**
 * Remove item from index
 *
 * @param {string} type - Content type
 * @param {string} id - Content ID
 */
export function removeFromIndex(type, id) {
  const docKey = `${type}:${id}`;

  // Remove from docs
  delete index.docs[docKey];

  // Remove from terms
  for (const term of Object.keys(index.terms)) {
    index.terms[term] = index.terms[term].filter(
      entry => !(entry.type === type && entry.id === id)
    );

    // Clean up empty term entries
    if (index.terms[term].length === 0) {
      delete index.terms[term];
    }
  }

  updateStats();
}

/**
 * Build/rebuild search index
 *
 * @param {string|null} type - Content type to rebuild, or null for all
 * @returns {{ types: number, docs: number, terms: number }}
 */
export function buildIndex(type = null) {
  if (!contentService) {
    throw new Error('Content service not initialized');
  }

  const types = type
    ? [{ type }]
    : contentService.listTypes();

  let totalDocs = 0;

  // Clear existing index for specified types
  if (type) {
    // Remove only entries for this type
    for (const term of Object.keys(index.terms)) {
      index.terms[term] = index.terms[term].filter(e => e.type !== type);
      if (index.terms[term].length === 0) {
        delete index.terms[term];
      }
    }
    for (const docKey of Object.keys(index.docs)) {
      if (docKey.startsWith(`${type}:`)) {
        delete index.docs[docKey];
      }
    }
  } else {
    // Clear entire index
    index = { terms: {}, docs: {}, fieldWeights: {} };
  }

  // Index all content
  for (const { type: contentType } of types) {
    const items = contentService.listAll(contentType);

    for (const item of items) {
      indexItem(contentType, item);
      totalDocs++;
    }
  }

  meta.lastRebuild = new Date().toISOString();
  updateStats();
  saveIndex();

  return {
    types: types.length,
    docs: totalDocs,
    terms: Object.keys(index.terms).length,
  };
}

/**
 * Update index statistics
 * @private
 */
function updateStats() {
  meta.totalDocs = Object.keys(index.docs).length;
  meta.totalTerms = Object.keys(index.terms).length;

  // Per-type stats
  meta.typeStats = {};
  for (const docKey of Object.keys(index.docs)) {
    const [type] = docKey.split(':');
    if (!meta.typeStats[type]) {
      meta.typeStats[type] = { docs: 0, terms: 0 };
    }
    meta.typeStats[type].docs++;
  }

  // Count terms per type
  for (const [term, entries] of Object.entries(index.terms)) {
    const typesSeen = new Set();
    for (const entry of entries) {
      if (!typesSeen.has(entry.type)) {
        typesSeen.add(entry.type);
        if (meta.typeStats[entry.type]) {
          meta.typeStats[entry.type].terms++;
        }
      }
    }
  }
}

/**
 * Parse search query into components
 *
 * Supports:
 * - Simple terms: hello world (AND)
 * - Phrases: "hello world"
 * - Field-specific: title:hello
 * - Exclusions: -goodbye
 *
 * @param {string} query - Search query
 * @returns {{ terms: string[], phrases: string[], fields: Object, exclude: string[] }}
 * @private
 */
function parseQuery(query) {
  const result = {
    terms: [],
    phrases: [],
    fields: {},     // field → [terms]
    exclude: [],
  };

  if (!query || typeof query !== 'string') return result;

  // Extract phrases first (quoted strings)
  const phraseRegex = /"([^"]+)"/g;
  let match;
  let remaining = query;

  while ((match = phraseRegex.exec(query)) !== null) {
    result.phrases.push(match[1].toLowerCase());
    remaining = remaining.replace(match[0], ' ');
  }

  // Parse remaining terms
  const parts = remaining.split(/\s+/).filter(p => p.length > 0);

  for (const part of parts) {
    // Exclusion
    if (part.startsWith('-') && part.length > 1) {
      const term = stem(part.slice(1).toLowerCase());
      if (term.length >= config.minWordLength) {
        result.exclude.push(term);
      }
      continue;
    }

    // Field-specific
    if (part.includes(':')) {
      const [field, value] = part.split(':', 2);
      if (field && value) {
        if (!result.fields[field]) {
          result.fields[field] = [];
        }
        const term = stem(value.toLowerCase());
        if (term.length >= config.minWordLength && !config.stopWords.includes(term)) {
          result.fields[field].push(term);
        }
      }
      continue;
    }

    // Regular term
    const term = stem(part.toLowerCase());
    if (term.length >= config.minWordLength && !config.stopWords.includes(term)) {
      result.terms.push(term);
    }
  }

  return result;
}

/**
 * Calculate Levenshtein distance for fuzzy matching
 *
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} - Edit distance
 * @private
 */
function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Find terms matching with fuzzy distance
 *
 * @param {string} term - Term to match
 * @returns {string[]} - Matching terms from index
 * @private
 */
function findFuzzyMatches(term) {
  if (!config.fuzzy) return [term];

  const matches = [term];

  for (const indexedTerm of Object.keys(index.terms)) {
    if (indexedTerm === term) continue;

    const distance = levenshtein(term, indexedTerm);
    if (distance <= config.fuzzyDistance) {
      matches.push(indexedTerm);
    }
  }

  return matches;
}

/**
 * Search indexed content
 *
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @param {string[]} options.types - Limit to these content types
 * @param {string[]} options.fields - Limit to these fields
 * @param {number} options.limit - Max results (default 20)
 * @param {number} options.offset - Skip results (default 0)
 * @param {boolean} options.highlight - Include highlighted snippets (default true)
 * @returns {{ results: Array, total: number, query: string, took: number }}
 */
export function search(query, options = {}) {
  const startTime = Date.now();

  const {
    types = null,
    fields = null,
    limit = 20,
    offset = 0,
    highlight = true,
  } = options;

  const parsed = parseQuery(query);

  // No valid search terms
  if (parsed.terms.length === 0 &&
      parsed.phrases.length === 0 &&
      Object.keys(parsed.fields).length === 0) {
    return {
      results: [],
      total: 0,
      query,
      took: Date.now() - startTime,
    };
  }

  // Collect matching documents with scores
  const docScores = {};  // "type:id" → { score, matches: { field: [positions] } }

  // Score regular terms
  for (const term of parsed.terms) {
    const matchingTerms = findFuzzyMatches(term);

    for (const matchTerm of matchingTerms) {
      const entries = index.terms[matchTerm] || [];

      for (const entry of entries) {
        // Filter by type
        if (types && !types.includes(entry.type)) continue;

        // Filter by field
        if (fields && !fields.includes(entry.field)) continue;

        const docKey = `${entry.type}:${entry.id}`;

        if (!docScores[docKey]) {
          docScores[docKey] = {
            type: entry.type,
            id: entry.id,
            score: 0,
            matches: {},
            matchedTerms: new Set(),
          };
        }

        // Calculate score: tf * field_weight * idf
        const idf = Math.log(meta.totalDocs / entries.length + 1);
        const score = entry.tf * entry.weight * idf;

        docScores[docKey].score += score;
        docScores[docKey].matchedTerms.add(term);

        // Track positions for highlighting
        if (!docScores[docKey].matches[entry.field]) {
          docScores[docKey].matches[entry.field] = [];
        }
        docScores[docKey].matches[entry.field].push(...entry.positions);
      }
    }
  }

  // Score field-specific terms
  for (const [field, terms] of Object.entries(parsed.fields)) {
    for (const term of terms) {
      const matchingTerms = findFuzzyMatches(term);

      for (const matchTerm of matchingTerms) {
        const entries = index.terms[matchTerm] || [];

        for (const entry of entries) {
          // Must match specified field
          if (entry.field !== field) continue;

          // Filter by type
          if (types && !types.includes(entry.type)) continue;

          const docKey = `${entry.type}:${entry.id}`;

          if (!docScores[docKey]) {
            docScores[docKey] = {
              type: entry.type,
              id: entry.id,
              score: 0,
              matches: {},
              matchedTerms: new Set(),
            };
          }

          const idf = Math.log(meta.totalDocs / entries.length + 1);
          const score = entry.tf * entry.weight * idf * 1.5; // Boost field-specific matches

          docScores[docKey].score += score;
          docScores[docKey].matchedTerms.add(term);

          if (!docScores[docKey].matches[entry.field]) {
            docScores[docKey].matches[entry.field] = [];
          }
          docScores[docKey].matches[entry.field].push(...entry.positions);
        }
      }
    }
  }

  // Filter by phrase matches
  if (parsed.phrases.length > 0) {
    for (const docKey of Object.keys(docScores)) {
      const { type, id } = docScores[docKey];
      const item = contentService?.read(type, id);

      if (!item) {
        delete docScores[docKey];
        continue;
      }

      // Check if all phrases exist in the document
      let allPhrasesMatch = true;
      for (const phrase of parsed.phrases) {
        let phraseFound = false;

        for (const [field, value] of Object.entries(item)) {
          if (typeof value === 'string' && value.toLowerCase().includes(phrase)) {
            phraseFound = true;

            // Track match position for highlighting
            const pos = value.toLowerCase().indexOf(phrase);
            if (!docScores[docKey].matches[field]) {
              docScores[docKey].matches[field] = [];
            }
            docScores[docKey].matches[field].push(pos);
            break;
          }
        }

        if (!phraseFound) {
          allPhrasesMatch = false;
          break;
        }
      }

      if (!allPhrasesMatch) {
        delete docScores[docKey];
      } else {
        // Boost score for phrase matches
        docScores[docKey].score *= 1.5;
      }
    }
  }

  // Filter by exclusions
  if (parsed.exclude.length > 0) {
    for (const docKey of Object.keys(docScores)) {
      const { type, id } = docScores[docKey];
      const item = contentService?.read(type, id);

      if (!item) continue;

      for (const excludeTerm of parsed.exclude) {
        let termFound = false;

        for (const [field, value] of Object.entries(item)) {
          if (typeof value === 'string') {
            const tokens = tokenize(value);
            if (tokens.includes(excludeTerm)) {
              termFound = true;
              break;
            }
          }
        }

        if (termFound) {
          delete docScores[docKey];
          break;
        }
      }
    }
  }

  // Require all terms to match (AND behavior)
  const requiredTermCount = parsed.terms.length + Object.values(parsed.fields).flat().length;
  if (requiredTermCount > 1) {
    for (const docKey of Object.keys(docScores)) {
      if (docScores[docKey].matchedTerms.size < requiredTermCount) {
        delete docScores[docKey];
      }
    }
  }

  // Sort by score (descending)
  const sortedDocs = Object.values(docScores)
    .sort((a, b) => b.score - a.score);

  const total = sortedDocs.length;

  // Apply pagination
  const paginated = sortedDocs.slice(offset, offset + limit);

  // Build results with optional highlighting
  const results = paginated.map(doc => {
    const item = contentService?.read(doc.type, doc.id);

    const result = {
      type: doc.type,
      id: doc.id,
      score: Math.round(doc.score * 100) / 100,
      item: item || null,
    };

    if (highlight && item) {
      result.highlights = generateHighlights(item, doc.matches, parsed);
    }

    return result;
  });

  // Build facets if requested
  let facetResults = null;
  if (options.facets && Array.isArray(options.facets) && contentService) {
    facetResults = buildFacets(sortedDocs, options.facets);
  }

  const result = {
    results,
    total,
    query,
    took: Date.now() - startTime,
  };

  if (facetResults) {
    result.facets = facetResults;
  }

  return result;
}

/**
 * Build facet aggregations from search result documents.
 * Counts distinct values for each requested field across matching docs.
 *
 * @param {Array} docs - Scored document list from search
 * @param {string[]} facetFields - Field names to aggregate
 * @returns {Object} Field → [{ value, count }] sorted by count descending
 */
function buildFacets(docs, facetFields) {
  const facets = {};

  for (const field of facetFields) {
    const counts = {};

    for (const doc of docs) {
      const item = contentService?.read(doc.type, doc.id);
      if (!item) continue;

      // Special built-in facets
      if (field === '_type') {
        counts[doc.type] = (counts[doc.type] || 0) + 1;
        continue;
      }

      const value = item[field];
      if (value == null) continue;

      // Handle arrays (e.g. tags)
      if (Array.isArray(value)) {
        for (const v of value) {
          const str = String(v);
          counts[str] = (counts[str] || 0) + 1;
        }
      } else {
        const str = String(value);
        counts[str] = (counts[str] || 0) + 1;
      }
    }

    facets[field] = Object.entries(counts)
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count);
  }

  return facets;
}

/**
 * Get facet counts across all indexed content (without a search query).
 * Useful for building filter UIs before any search is performed.
 *
 * @param {string[]} facetFields - Fields to aggregate
 * @param {Object} [options]
 * @param {string[]} [options.types] - Limit to specific content types
 * @returns {Object} Field → [{ value, count }]
 */
export function getFacets(facetFields, options = {}) {
  if (!contentService) return {};

  const { types = null } = options;
  const facets = {};

  // Iterate over all indexed documents
  const allDocs = Object.values(index.docs);

  for (const field of facetFields) {
    const counts = {};

    for (const doc of allDocs) {
      if (types && !types.includes(doc.type)) continue;

      if (field === '_type') {
        counts[doc.type] = (counts[doc.type] || 0) + 1;
        continue;
      }

      const item = contentService.read(doc.type, doc.id);
      if (!item) continue;

      const value = item[field];
      if (value == null) continue;

      if (Array.isArray(value)) {
        for (const v of value) {
          const str = String(v);
          counts[str] = (counts[str] || 0) + 1;
        }
      } else {
        const str = String(value);
        counts[str] = (counts[str] || 0) + 1;
      }
    }

    facets[field] = Object.entries(counts)
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count);
  }

  return facets;
}

/**
 * Generate highlighted snippets for search results
 *
 * @param {Object} item - Content item
 * @param {Object} matches - Field → positions map
 * @param {Object} parsed - Parsed query
 * @returns {Object} - Field → highlighted snippet
 * @private
 */
function generateHighlights(item, matches, parsed) {
  const highlights = {};
  const snippetLength = 100;

  for (const [field, positions] of Object.entries(matches)) {
    const value = item[field];
    if (!value || typeof value !== 'string') continue;

    // Find the best position to create a snippet around
    const bestPos = positions.length > 0 ? Math.min(...positions) : 0;

    // Extract snippet around the match
    let start = Math.max(0, bestPos - snippetLength / 2);
    let end = Math.min(value.length, start + snippetLength);

    // Adjust to word boundaries
    if (start > 0) {
      const spacePos = value.indexOf(' ', start);
      if (spacePos !== -1 && spacePos < start + 20) {
        start = spacePos + 1;
      }
    }
    if (end < value.length) {
      const spacePos = value.lastIndexOf(' ', end);
      if (spacePos !== -1 && spacePos > end - 20) {
        end = spacePos;
      }
    }

    let snippet = value.slice(start, end);

    // Add ellipsis
    if (start > 0) snippet = '...' + snippet;
    if (end < value.length) snippet = snippet + '...';

    // Highlight matching terms
    const allTerms = [...parsed.terms, ...Object.values(parsed.fields).flat()];
    for (const term of allTerms) {
      // Match the term and its variations
      const regex = new RegExp(`\\b(${term}\\w*)\\b`, 'gi');
      snippet = snippet.replace(regex, '<<$1>>');
    }

    // Highlight phrases
    for (const phrase of parsed.phrases) {
      const regex = new RegExp(`(${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      snippet = snippet.replace(regex, '<<$1>>');
    }

    highlights[field] = snippet;
  }

  return highlights;
}

/**
 * Get index statistics
 *
 * @returns {Object} - Index stats
 */
export function getStats() {
  return {
    enabled: config.enabled,
    totalDocs: meta.totalDocs,
    totalTerms: meta.totalTerms,
    lastRebuild: meta.lastRebuild,
    typeStats: meta.typeStats,
    config: {
      minWordLength: config.minWordLength,
      stopWordsCount: config.stopWords.length,
      fuzzy: config.fuzzy,
      fuzzyDistance: config.fuzzyDistance,
    },
  };
}

/**
 * Get current configuration
 *
 * @returns {Object}
 */
export function getConfig() {
  return { ...config };
}

/**
 * Check if search is enabled
 *
 * @returns {boolean}
 */
export function isEnabled() {
  return config.enabled;
}

/**
 * Clear entire index
 */
export function clearIndex() {
  index = { terms: {}, docs: {}, fieldWeights: {} };
  meta = {
    version: '1.0.0',
    lastRebuild: null,
    totalDocs: 0,
    totalTerms: 0,
    typeStats: {},
  };
  saveIndex();
}

// ============================================
// VECTOR / SEMANTIC SEARCH
// ============================================

let vectorIndex = {};   // "type:id" → { embedding: Float64Array, text: string }
let aiProviderRef = null;
const VECTOR_INDEX_FILE = 'vectors.json';

/**
 * Initialize vector search with AI provider for embeddings.
 * Registers hooks to auto-index content on create/update/delete.
 * @param {Object} providerManager - AI provider manager service
 * @param {Object} hooksService - Hooks service for auto-indexing (optional)
 */
export function initVectorSearch(providerManager, hooksService) {
  aiProviderRef = providerManager;
  loadVectorIndex();

  // Auto-index content for vector search
  if (hooksService) {
    hooksService.register('content:afterCreate', async ({ type, item }) => {
      const text = extractTextContent(item);
      if (text) await vectorIndexItem(type, item.id, text);
    }, 10, 'vector-search');

    hooksService.register('content:afterUpdate', async ({ type, item }) => {
      const text = extractTextContent(item);
      if (text) await vectorIndexItem(type, item.id, text);
    }, 10, 'vector-search');

    hooksService.register('content:afterDelete', async ({ type, id }) => {
      vectorRemoveItem(type, id);
    }, 10, 'vector-search');
  }
}

/**
 * Extract text content from a content item for embedding.
 */
function extractTextContent(item) {
  const parts = [];
  if (item.title) parts.push(item.title);
  if (item.body) parts.push(item.body);
  if (item.description) parts.push(item.description);
  if (item.summary) parts.push(item.summary);
  if (item.content) parts.push(typeof item.content === 'string' ? item.content : '');
  return parts.join(' ').replace(/<[^>]+>/g, '').trim();
}

function loadVectorIndex() {
  try {
    const filePath = join(config.baseDir || '.', 'content', '.search', VECTOR_INDEX_FILE);
    if (existsSync(filePath)) {
      vectorIndex = JSON.parse(readFileSync(filePath, 'utf-8'));
    }
  } catch { vectorIndex = {}; }
}

function saveVectorIndex() {
  try {
    const dir = join(config.baseDir || '.', 'content', '.search');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, VECTOR_INDEX_FILE), JSON.stringify(vectorIndex));
  } catch (err) {
    console.error('[search] Failed to save vector index:', err.message);
  }
}

/**
 * Generate an embedding for text using the AI provider.
 * Falls back to a simple bag-of-words vector if no AI provider is available.
 */
async function getEmbedding(text) {
  if (aiProviderRef) {
    try {
      const result = await aiProviderRef.routeToProvider('embedding', [text]);
      if (result && result.embedding) return result.embedding;
      if (Array.isArray(result)) return result;
    } catch { /* fall through to bag-of-words fallback */ }
  }

  // Fallback: simple term-frequency vector (256 dimensions via hash buckets)
  const dims = 256;
  const vec = new Array(dims).fill(0);
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
  for (const word of words) {
    if (word.length < 2) continue;
    // Hash word to a bucket
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) - hash + word.charCodeAt(i)) & 0x7fffffff;
    }
    vec[hash % dims] += 1;
  }
  // Normalize
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map(v => v / norm);
}

/**
 * Index a content item for vector search.
 * @param {string} type
 * @param {string} id
 * @param {string} text - Combined text content to embed
 */
export async function vectorIndexItem(type, id, text) {
  if (!text || text.length < 10) return;
  const key = `${type}:${id}`;
  const embedding = await getEmbedding(text);
  vectorIndex[key] = { embedding, text: text.slice(0, 500), type, id };
  saveVectorIndex();
}

/**
 * Remove a content item from the vector index.
 */
export function vectorRemoveItem(type, id) {
  delete vectorIndex[`${type}:${id}`];
  saveVectorIndex();
}

/**
 * Cosine similarity between two vectors.
 */
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

/**
 * Semantic search: find content similar to a query.
 * @param {string} query - Natural language query
 * @param {Object} options - { limit, types, minScore }
 * @returns {{ results: Array, total: number, query: string, took: number }}
 */
export async function semanticSearch(query, options = {}) {
  const startTime = Date.now();
  const { limit = 10, types = null, minScore = 0.1 } = options;

  const queryEmbedding = await getEmbedding(query);
  const scored = [];

  for (const [key, entry] of Object.entries(vectorIndex)) {
    if (types && !types.includes(entry.type)) continue;
    const score = cosineSimilarity(queryEmbedding, entry.embedding);
    if (score >= minScore) {
      scored.push({ ...entry, score, key });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const results = scored.slice(0, limit).map(r => ({
    type: r.type,
    id: r.id,
    score: Math.round(r.score * 1000) / 1000,
    snippet: r.text,
  }));

  return {
    results,
    total: scored.length,
    query,
    took: Date.now() - startTime,
    mode: 'semantic',
  };
}
