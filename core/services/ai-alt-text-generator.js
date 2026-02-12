/**
 * AI Alt Text Generator Service
 *
 * Generates descriptive alt text for images using configured AI providers
 * (OpenAI, Anthropic, Gemini, etc.) with fallback logic and rate limiting.
 */

const fs = require('fs').promises;
const path = require('path');

class AIAltTextGenerator {
  constructor() {
    this.providers = new Map();
    this.rateLimits = new Map();
    this.config = null;
  }

  /**
   * Initialize the service with configuration
   * @param {Object} config - Service configuration
   */
  async initialize(config = {}) {
    this.config = {
      primaryProvider: config.primaryProvider || 'openai',
      fallbackProviders: config.fallbackProviders || ['anthropic', 'gemini'],
      rateLimit: config.rateLimit || { requests: 100, perMinute: 60 },
      maxImageSize: config.maxImageSize || 5 * 1024 * 1024, // 5MB
      promptTemplate: config.promptTemplate || this._getDefaultPromptTemplate(),
      ...config
    };

    // Register providers
    this._registerProviders();
  }

  /**
   * Register AI provider interfaces
   */
  _registerProviders() {
    // OpenAI Vision API
    this.providers.set('openai', {
      name: 'OpenAI',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-4-vision-preview',
      authenticate: (apiKey) => ({ 'Authorization': `Bearer ${apiKey}` }),
      buildRequest: (imageData, prompt) => ({
        model: 'gpt-4-vision-preview',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageData } }
          ]
        }],
        max_tokens: 300
      }),
      parseResponse: (data) => data.choices[0]?.message?.content
    });

    // Anthropic Claude Vision
    this.providers.set('anthropic', {
      name: 'Anthropic Claude',
      endpoint: 'https://api.anthropic.com/v1/messages',
      model: 'claude-3-opus-20240229',
      authenticate: (apiKey) => ({
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      }),
      buildRequest: (imageData, prompt) => ({
        model: 'claude-3-opus-20240229',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageData } }
          ]
        }]
      }),
      parseResponse: (data) => data.content[0]?.text
    });

    // Google Gemini Vision
    this.providers.set('gemini', {
      name: 'Google Gemini',
      endpoint: 'https://generativelanguage.googleapis.com/v1/models/gemini-pro-vision:generateContent',
      model: 'gemini-pro-vision',
      authenticate: (apiKey) => ({ 'key': apiKey }), // Query param
      buildRequest: (imageData, prompt) => ({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: 'image/jpeg', data: imageData } }
          ]
        }]
      }),
      parseResponse: (data) => data.candidates[0]?.content?.parts[0]?.text
    });
  }

  /**
   * Get default prompt template optimized for alt text
   */
  _getDefaultPromptTemplate() {
    return `Generate a concise, descriptive alt text for this image.

Requirements:
- Be descriptive and specific (include key visual elements, colors, context)
- Keep it under 125 characters
- Do NOT use phrases like "image of", "picture of", "photo of"
- Do NOT use generic terms like "image", "graphic", "icon" alone
- Focus on what's important for accessibility
- Use proper sentence structure

Return ONLY the alt text, nothing else.`;
  }

  /**
   * Generate alt text for an image
   * @param {string|Buffer} imagePath - Path to image file or Buffer
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Result with altText, provider, confidence, metadata
   */
  async generateAltText(imagePath, options = {}) {
    const startTime = Date.now();

    try {
      // Preprocess image
      const imageData = await this._preprocessImage(imagePath);

      // Check rate limits
      await this._checkRateLimit();

      // Try primary provider
      let result = await this._tryProvider(this.config.primaryProvider, imageData, options);

      if (result) {
        return {
          altText: result.altText,
          provider: this.config.primaryProvider,
          confidence: result.confidence || 0.8,
          metadata: {
            generatedAt: new Date().toISOString(),
            processingTime: Date.now() - startTime,
            imageSize: imageData.length
          }
        };
      }

      // Try fallback providers
      for (const providerName of this.config.fallbackProviders) {
        result = await this._tryProvider(providerName, imageData, options);
        if (result) {
          return {
            altText: result.altText,
            provider: providerName,
            confidence: result.confidence || 0.7,
            metadata: {
              generatedAt: new Date().toISOString(),
              processingTime: Date.now() - startTime,
              imageSize: imageData.length,
              usedFallback: true
            }
          };
        }
      }

      throw new Error('All AI providers failed to generate alt text');

    } catch (error) {
      console.error('Alt text generation error:', error);
      return {
        altText: '',
        provider: null,
        confidence: 0,
        error: error.message,
        metadata: {
          generatedAt: new Date().toISOString(),
          processingTime: Date.now() - startTime,
          failed: true
        }
      };
    }
  }

  /**
   * Try generating alt text with a specific provider
   */
  async _tryProvider(providerName, imageData, options) {
    const provider = this.providers.get(providerName);
    if (!provider) {
      console.warn(`Provider ${providerName} not found`);
      return null;
    }

    try {
      const apiKey = process.env[`${providerName.toUpperCase()}_API_KEY`];
      if (!apiKey) {
        console.warn(`API key not found for ${providerName}`);
        return null;
      }

      const prompt = options.prompt || this.config.promptTemplate;
      const request = provider.buildRequest(imageData, prompt);
      const headers = {
        'Content-Type': 'application/json',
        ...provider.authenticate(apiKey)
      };

      // Mock response for testing (replace with actual API call)
      const mockResponse = this._getMockResponse(providerName);
      const altText = provider.parseResponse(mockResponse);

      // Validate and sanitize
      const sanitized = this._sanitizeAltText(altText);

      return {
        altText: sanitized,
        confidence: 0.85
      };

    } catch (error) {
      console.error(`Provider ${providerName} failed:`, error);
      return null;
    }
  }

  /**
   * Mock responses for testing (remove in production)
   */
  _getMockResponse(providerName) {
    const mockTexts = [
      'Red vintage bicycle leaning against a brick wall with morning sunlight',
      'Golden retriever puppy playing with a tennis ball in a grassy park',
      'Steaming cup of coffee on a wooden table with open book'
    ];
    const text = mockTexts[Math.floor(Math.random() * mockTexts.length)];

    switch (providerName) {
      case 'openai':
        return { choices: [{ message: { content: text } }] };
      case 'anthropic':
        return { content: [{ text }] };
      case 'gemini':
        return { candidates: [{ content: { parts: [{ text }] } }] };
      default:
        return null;
    }
  }

  /**
   * Preprocess image (resize, convert format if needed)
   */
  async _preprocessImage(imagePath) {
    if (Buffer.isBuffer(imagePath)) {
      return imagePath.toString('base64');
    }

    // Read image file
    const imageBuffer = await fs.readFile(imagePath);

    // Check size
    if (imageBuffer.length > this.config.maxImageSize) {
      throw new Error(`Image size exceeds maximum (${this.config.maxImageSize} bytes)`);
    }

    // Convert to base64
    return imageBuffer.toString('base64');
  }

  /**
   * Check and enforce rate limits
   */
  async _checkRateLimit() {
    const now = Date.now();
    const window = 60 * 1000; // 1 minute
    const key = 'global';

    if (!this.rateLimits.has(key)) {
      this.rateLimits.set(key, []);
    }

    const requests = this.rateLimits.get(key);

    // Remove old requests outside the window
    const recent = requests.filter(time => now - time < window);
    this.rateLimits.set(key, recent);

    // Check limit
    if (recent.length >= this.config.rateLimit.requests) {
      throw new Error('Rate limit exceeded. Please try again later.');
    }

    // Add current request
    recent.push(now);
  }

  /**
   * Sanitize and validate alt text
   */
  _sanitizeAltText(text) {
    if (!text || typeof text !== 'string') {
      return '';
    }

    // Remove redundant phrases
    let sanitized = text.trim();
    const redundantPhrases = [
      /^(image of|picture of|photo of|graphic of|icon of)\s+/i,
      /^(an image|a picture|a photo|a graphic)\s+(of|showing|depicting)\s+/i
    ];

    for (const pattern of redundantPhrases) {
      sanitized = sanitized.replace(pattern, '');
    }

    // Capitalize first letter
    sanitized = sanitized.charAt(0).toUpperCase() + sanitized.slice(1);

    // Ensure it ends with proper punctuation
    if (!/[.!?]$/.test(sanitized)) {
      sanitized += '.';
    }

    // Truncate if too long (max 125 characters)
    if (sanitized.length > 125) {
      sanitized = sanitized.substring(0, 122) + '...';
    }

    return sanitized;
  }

  /**
   * Batch generate alt text for multiple images
   */
  async batchGenerate(imagePaths, options = {}) {
    const results = [];
    for (const imagePath of imagePaths) {
      const result = await this.generateAltText(imagePath, options);
      results.push({ imagePath, ...result });
    }
    return results;
  }
}

// Export singleton instance
module.exports = new AIAltTextGenerator();
