/**
 * API routes for AI alt text generation and quality scoring
 */

const altTextGenerator = require('./services/ai-alt-text-generator');
const altTextScorer = require('./services/alt-text-quality-scorer');

/**
 * Initialize alt text generation service
 */
async function initializeAltTextAPI(config = {}) {
  await altTextGenerator.initialize(config);
  console.log('AI Alt Text API initialized');
}

/**
 * Register API routes for alt text functionality
 * @param {Object} app - Express app instance
 */
function registerAltTextRoutes(app) {
  /**
   * POST /api/generate-alt-text
   * Generate AI alt text for an uploaded image
   */
  app.post('/api/generate-alt-text', async (req, res) => {
    try {
      const { image, filename } = req.body;

      if (!image) {
        return res.status(400).json({ error: 'Image data required' });
      }

      // Convert base64 to buffer
      const imageBuffer = Buffer.from(image, 'base64');

      // Generate alt text
      const result = await altTextGenerator.generateAltText(imageBuffer, {
        filename
      });

      if (result.error) {
        return res.status(500).json({
          error: result.error,
          altText: '',
          provider: null,
          confidence: 0
        });
      }

      res.json({
        altText: result.altText,
        provider: result.provider,
        confidence: result.confidence,
        metadata: result.metadata
      });

    } catch (error) {
      console.error('Alt text generation API error:', error);
      res.status(500).json({
        error: error.message,
        altText: '',
        provider: null,
        confidence: 0
      });
    }
  });

  /**
   * POST /api/score-alt-text
   * Score the quality of alt text
   */
  app.post('/api/score-alt-text', async (req, res) => {
    try {
      const { altText, profile } = req.body;

      if (!altText) {
        return res.status(400).json({ error: 'Alt text required' });
      }

      // Set scoring profile if specified
      if (profile && ['strict', 'balanced', 'lenient'].includes(profile)) {
        altTextScorer.setProfile(profile);
      }

      // Score the alt text
      const result = altTextScorer.score(altText);

      res.json(result);

    } catch (error) {
      console.error('Alt text scoring API error:', error);
      res.status(500).json({
        error: error.message,
        score: 0,
        rating: 'Error'
      });
    }
  });

  /**
   * POST /api/batch-score-alt-text
   * Score multiple alt texts at once
   */
  app.post('/api/batch-score-alt-text', async (req, res) => {
    try {
      const { altTexts, profile } = req.body;

      if (!Array.isArray(altTexts)) {
        return res.status(400).json({ error: 'Alt texts array required' });
      }

      // Set scoring profile if specified
      if (profile && ['strict', 'balanced', 'lenient'].includes(profile)) {
        altTextScorer.setProfile(profile);
      }

      // Batch score
      const results = altTextScorer.batchScore(altTexts);

      res.json({ results });

    } catch (error) {
      console.error('Batch alt text scoring API error:', error);
      res.status(500).json({
        error: error.message,
        results: []
      });
    }
  });

  /**
   * GET /api/alt-text-criteria
   * Get scoring criteria and documentation
   */
  app.get('/api/alt-text-criteria', (req, res) => {
    try {
      const criteria = altTextScorer.getCriteria();
      res.json(criteria);
    } catch (error) {
      console.error('Get criteria API error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  console.log('Alt text API routes registered');
}

module.exports = {
  initializeAltTextAPI,
  registerAltTextRoutes
};
