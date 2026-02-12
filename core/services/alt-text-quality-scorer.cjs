/**
 * Alt Text Quality Scorer Service
 *
 * Evaluates alt text quality based on accessibility best practices (WCAG),
 * descriptiveness, length, and common pitfalls. Returns 0-100 score with
 * detailed feedback and improvement suggestions.
 */

class AltTextQualityScorer {
  constructor() {
    this.profiles = {
      strict: { minLength: 15, maxLength: 100, penaltyMultiplier: 1.5 },
      balanced: { minLength: 10, maxLength: 125, penaltyMultiplier: 1.0 },
      lenient: { minLength: 5, maxLength: 150, penaltyMultiplier: 0.7 }
    };
    this.currentProfile = 'balanced';
  }

  /**
   * Set scoring profile
   * @param {string} profile - 'strict', 'balanced', or 'lenient'
   */
  setProfile(profile) {
    if (!this.profiles[profile]) {
      throw new Error(`Invalid profile: ${profile}. Use 'strict', 'balanced', or 'lenient'.`);
    }
    this.currentProfile = profile;
  }

  /**
   * Score alt text quality (0-100)
   * @param {string} altText - Alt text to evaluate
   * @returns {Object} Score with breakdown and suggestions
   */
  score(altText) {
    if (!altText || typeof altText !== 'string') {
      return this._buildResult(0, 'Empty or invalid alt text', [
        'Alt text is required for accessibility',
        'Provide a descriptive alternative text for the image'
      ]);
    }

    const profile = this.profiles[this.currentProfile];
    let score = 100;
    const penalties = [];
    const suggestions = [];

    // Length checks
    const lengthResult = this._checkLength(altText, profile);
    score -= lengthResult.penalty;
    penalties.push(...lengthResult.penalties);
    suggestions.push(...lengthResult.suggestions);

    // Redundant phrases
    const redundancyResult = this._checkRedundantPhrases(altText, profile);
    score -= redundancyResult.penalty;
    penalties.push(...redundancyResult.penalties);
    suggestions.push(...redundancyResult.suggestions);

    // Generic descriptions
    const genericResult = this._checkGenericDescriptions(altText, profile);
    score -= genericResult.penalty;
    penalties.push(...genericResult.penalties);
    suggestions.push(...genericResult.suggestions);

    // Descriptiveness
    const descriptiveResult = this._checkDescriptiveness(altText, profile);
    score -= descriptiveResult.penalty;
    penalties.push(...descriptiveResult.penalties);
    suggestions.push(...descriptiveResult.suggestions);

    // Sentence structure
    const structureResult = this._checkSentenceStructure(altText, profile);
    score -= structureResult.penalty;
    penalties.push(...structureResult.penalties);
    suggestions.push(...structureResult.suggestions);

    // Keyword density (avoid stuffing)
    const keywordResult = this._checkKeywordDensity(altText, profile);
    score -= keywordResult.penalty;
    penalties.push(...keywordResult.penalties);
    suggestions.push(...keywordResult.suggestions);

    // WCAG compliance
    const wcagResult = this._checkWCAGCompliance(altText, profile);
    score -= wcagResult.penalty;
    penalties.push(...wcagResult.penalties);
    suggestions.push(...wcagResult.suggestions);

    // Ensure score is within bounds
    score = Math.max(0, Math.min(100, score));

    return this._buildResult(score, this._getRating(score), suggestions, penalties);
  }

  /**
   * Check length requirements
   */
  _checkLength(altText, profile) {
    const penalties = [];
    const suggestions = [];
    let penalty = 0;

    const length = altText.trim().length;

    if (length < profile.minLength) {
      penalty = (profile.minLength - length) * 2 * profile.penaltyMultiplier;
      penalties.push(`Too short (${length} chars, minimum ${profile.minLength})`);
      suggestions.push('Add more descriptive details to the alt text');
    }

    if (length > profile.maxLength) {
      penalty = (length - profile.maxLength) * 0.5 * profile.penaltyMultiplier;
      penalties.push(`Too long (${length} chars, recommended max ${profile.maxLength})`);
      suggestions.push('Condense to essential information only');
    }

    return { penalty, penalties, suggestions };
  }

  /**
   * Check for redundant phrases
   */
  _checkRedundantPhrases(altText, profile) {
    const penalties = [];
    const suggestions = [];
    let penalty = 0;

    const redundantPatterns = [
      { pattern: /\b(image of|picture of|photo of|graphic of|icon of)\b/i, name: 'redundant prefix' },
      { pattern: /\b(an image|a picture|a photo|a graphic)\b/i, name: 'redundant article phrase' },
      { pattern: /\b(showing|depicting|containing|featuring)\s+an?\s+image\b/i, name: 'redundant description' }
    ];

    for (const { pattern, name } of redundantPatterns) {
      if (pattern.test(altText)) {
        penalty += 15 * profile.penaltyMultiplier;
        penalties.push(`Contains ${name}: "${altText.match(pattern)[0]}"`);
        suggestions.push(`Remove "${name}" and describe the content directly`);
      }
    }

    return { penalty, penalties, suggestions };
  }

  /**
   * Check for generic descriptions
   */
  _checkGenericDescriptions(altText, profile) {
    const penalties = [];
    const suggestions = [];
    let penalty = 0;

    const genericWords = ['image', 'graphic', 'icon', 'picture', 'photo'];
    const words = altText.toLowerCase().split(/\s+/);

    // Check if alt text is ONLY generic words
    if (words.length <= 2 && words.some(w => genericWords.includes(w))) {
      penalty = 40 * profile.penaltyMultiplier;
      penalties.push('Uses only generic terms without description');
      suggestions.push('Describe what the image actually shows');
    }

    // Check for standalone generic words
    for (const generic of genericWords) {
      const standalonePattern = new RegExp(`\\b${generic}\\b(?!\\w)`, 'i');
      if (standalonePattern.test(altText) && words.length < 5) {
        penalty += 10 * profile.penaltyMultiplier;
        penalties.push(`Generic term "${generic}" without context`);
        suggestions.push(`Replace "${generic}" with specific description`);
      }
    }

    return { penalty, penalties, suggestions };
  }

  /**
   * Check descriptiveness (adjectives, context)
   */
  _checkDescriptiveness(altText, profile) {
    const penalties = [];
    const suggestions = [];
    let penalty = 0;

    const words = altText.split(/\s+/);
    const hasAdjectives = /\b(red|blue|green|large|small|beautiful|old|new|bright|dark|colorful)\b/i.test(altText);
    const hasContext = words.length >= 5;

    if (!hasAdjectives && words.length > 3) {
      penalty += 10 * profile.penaltyMultiplier;
      penalties.push('Lacks descriptive adjectives');
      suggestions.push('Add descriptive details (colors, sizes, states)');
    }

    if (!hasContext) {
      penalty += 15 * profile.penaltyMultiplier;
      penalties.push('Insufficient context');
      suggestions.push('Provide more context about the scene or purpose');
    }

    return { penalty, penalties, suggestions };
  }

  /**
   * Check sentence structure
   */
  _checkSentenceStructure(altText, profile) {
    const penalties = [];
    const suggestions = [];
    let penalty = 0;

    // Check capitalization
    if (!/^[A-Z]/.test(altText.trim())) {
      penalty += 5 * profile.penaltyMultiplier;
      penalties.push('Does not start with capital letter');
      suggestions.push('Capitalize the first letter');
    }

    // Check ending punctuation
    if (!/[.!?]$/.test(altText.trim())) {
      penalty += 3 * profile.penaltyMultiplier;
      penalties.push('Missing ending punctuation');
      suggestions.push('End with appropriate punctuation');
    }

    // Check for proper structure
    const words = altText.split(/\s+/);
    if (words.length === 1) {
      penalty += 20 * profile.penaltyMultiplier;
      penalties.push('Single word is not a complete description');
      suggestions.push('Use a complete phrase or sentence');
    }

    return { penalty, penalties, suggestions };
  }

  /**
   * Check keyword density (avoid stuffing)
   */
  _checkKeywordDensity(altText, profile) {
    const penalties = [];
    const suggestions = [];
    let penalty = 0;

    const words = altText.toLowerCase().split(/\s+/);
    const wordFreq = {};

    for (const word of words) {
      if (word.length > 3) { // Ignore short words
        wordFreq[word] = (wordFreq[word] || 0) + 1;
      }
    }

    // Check for repeated keywords
    for (const [word, count] of Object.entries(wordFreq)) {
      if (count > 2) {
        penalty += (count - 2) * 10 * profile.penaltyMultiplier;
        penalties.push(`Keyword "${word}" repeated ${count} times`);
        suggestions.push('Avoid repetitive keywords (potential stuffing)');
        break; // Only penalize once
      }
    }

    return { penalty, penalties, suggestions };
  }

  /**
   * Check WCAG compliance
   */
  _checkWCAGCompliance(altText, profile) {
    const penalties = [];
    const suggestions = [];
    let penalty = 0;

    // WCAG: Alt text should not contain "image" or "graphic" (redundant)
    if (/\b(image|graphic|picture|photo)\b/i.test(altText)) {
      penalty += 8 * profile.penaltyMultiplier;
      penalties.push('Contains redundant words (WCAG guideline)');
      suggestions.push('Screen readers announce "image" automatically');
    }

    // WCAG: Avoid placeholder text
    const placeholders = ['insert alt text', 'alt text here', 'description', 'untitled'];
    for (const placeholder of placeholders) {
      if (altText.toLowerCase().includes(placeholder)) {
        penalty += 50 * profile.penaltyMultiplier;
        penalties.push('Contains placeholder text (WCAG violation)');
        suggestions.push('Replace with actual description');
      }
    }

    // WCAG: Empty or meaningless alt text
    if (altText.trim().length === 0) {
      penalty = 100;
      penalties.push('Empty alt text (WCAG violation)');
      suggestions.push('Provide meaningful description');
    }

    return { penalty, penalties, suggestions };
  }

  /**
   * Get rating based on score
   */
  _getRating(score) {
    if (score >= 90) return 'Excellent';
    if (score >= 75) return 'Good';
    if (score >= 60) return 'Fair';
    if (score >= 40) return 'Poor';
    return 'Very Poor';
  }

  /**
   * Build result object
   */
  _buildResult(score, rating, suggestions = [], penalties = []) {
    return {
      score: Math.round(score),
      rating,
      profile: this.currentProfile,
      suggestions: [...new Set(suggestions)], // Remove duplicates
      penalties: penalties,
      passed: score >= 60
    };
  }

  /**
   * Batch score multiple alt texts
   * @param {Array<string>} altTexts - Array of alt texts to score
   * @returns {Array<Object>} Array of score results
   */
  batchScore(altTexts) {
    return altTexts.map((altText, index) => ({
      index,
      altText,
      ...this.score(altText)
    }));
  }

  /**
   * Get scoring criteria documentation
   */
  getCriteria() {
    return {
      profiles: this.profiles,
      criteria: {
        length: 'Checks if alt text is within recommended length range',
        redundancy: 'Penalizes phrases like "image of", "picture of"',
        generic: 'Penalizes generic terms without context',
        descriptiveness: 'Rewards descriptive adjectives and context',
        structure: 'Checks capitalization and punctuation',
        keywordDensity: 'Penalizes keyword stuffing',
        wcag: 'Validates against WCAG accessibility guidelines'
      },
      scoring: {
        excellent: '90-100: High quality, accessible alt text',
        good: '75-89: Good alt text with minor improvements needed',
        fair: '60-74: Acceptable but needs improvement',
        poor: '40-59: Significant issues, revise recommended',
        veryPoor: '0-39: Major problems, complete rewrite needed'
      }
    };
  }
}

// Export singleton instance
module.exports = new AltTextQualityScorer();
