/**
 * AI Provider Manager
 *
 * Discovers, loads, and manages AI provider plugins.
 * Handles provider instantiation, caching, and lifecycle.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import AIProviderInterface from './provider-interface.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ProviderManager {
  constructor() {
    this.providers = new Map(); // Cache for loaded provider instances
    this.providerClasses = new Map(); // Cache for provider classes
    this.providersDir = path.join(__dirname, '../providers');
  }

  /**
   * Discover all available provider plugins
   * @returns {Promise<Array<string>>} Array of provider names
   */
  async discoverProviders() {
    try {
      // Ensure providers directory exists
      if (!fs.existsSync(this.providersDir)) {
        fs.mkdirSync(this.providersDir, { recursive: true });
        return [];
      }

      const entries = fs.readdirSync(this.providersDir, { withFileTypes: true });
      const providers = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const indexPath = path.join(this.providersDir, entry.name, 'index.js');
          if (fs.existsSync(indexPath)) {
            providers.push(entry.name);
          }
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
          const name = entry.name.replace('.js', '');
          providers.push(name);
        }
      }

      return providers;
    } catch (error) {
      throw new Error(`Failed to discover providers: ${error.message}`);
    }
  }

  /**
   * Load a specific provider by name
   * @param {string} name - Provider name
   * @param {Object} config - Provider configuration
   * @returns {Promise<AIProviderInterface>} Loaded provider instance
   */
  async loadProvider(name, config = {}) {
    try {
      // Check cache first
      const cacheKey = `${name}:${JSON.stringify(config)}`;
      if (this.providers.has(cacheKey)) {
        return this.providers.get(cacheKey);
      }

      // Load provider class if not already loaded
      if (!this.providerClasses.has(name)) {
        const providerPath = this._resolveProviderPath(name);

        if (!fs.existsSync(providerPath)) {
          throw new Error(`Provider not found: ${name}`);
        }

        const module = await import(`file://${providerPath}`);
        const ProviderClass = module.default;

        // Validate that it extends AIProviderInterface
        if (typeof ProviderClass !== 'function') {
          throw new Error(`Invalid provider: ${name} does not export a class`);
        }

        this.providerClasses.set(name, ProviderClass);
      }

      // Instantiate provider
      const ProviderClass = this.providerClasses.get(name);
      const instance = new ProviderClass(config);

      // Verify it implements the interface
      if (!this._implementsInterface(instance)) {
        throw new Error(`Provider ${name} does not implement AIProviderInterface correctly`);
      }

      // Cache the instance
      this.providers.set(cacheKey, instance);

      return instance;
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND') {
        throw new Error(`Provider not found: ${name}`);
      }
      throw new Error(`Failed to load provider ${name}: ${error.message}`);
    }
  }

  /**
   * Get a cached provider instance
   * @param {string} name - Provider name
   * @param {Object} config - Provider configuration
   * @returns {AIProviderInterface|null} Cached provider or null
   */
  getProvider(name, config = {}) {
    const cacheKey = `${name}:${JSON.stringify(config)}`;
    return this.providers.get(cacheKey) || null;
  }

  /**
   * Clear all cached provider instances
   */
  clearCache() {
    this.providers.clear();
  }

  /**
   * Clear a specific provider from cache
   * @param {string} name - Provider name
   * @param {Object} config - Provider configuration
   */
  clearProvider(name, config = {}) {
    const cacheKey = `${name}:${JSON.stringify(config)}`;
    this.providers.delete(cacheKey);
  }

  /**
   * Resolve the file path for a provider
   * @private
   */
  _resolveProviderPath(name) {
    // Check for directory-based provider (providers/openai/index.js)
    const dirPath = path.join(this.providersDir, name, 'index.js');
    if (fs.existsSync(dirPath)) {
      return dirPath;
    }

    // Check for file-based provider (providers/openai.js)
    const filePath = path.join(this.providersDir, `${name}.js`);
    return filePath;
  }

  /**
   * Verify that a provider implements the required interface
   * @private
   */
  _implementsInterface(instance) {
    // Check that it has the required methods
    const requiredMethods = ['getModels', 'isUsable', 'getSupportedOperations'];

    for (const method of requiredMethods) {
      if (typeof instance[method] !== 'function') {
        return false;
      }
    }

    return true;
  }

  /**
   * Get metadata for all discovered providers
   * @returns {Promise<Array<Object>>} Array of provider metadata
   */
  async getProvidersMetadata() {
    const names = await this.discoverProviders();
    const metadata = [];

    for (const name of names) {
      try {
        const provider = await this.loadProvider(name);
        metadata.push({
          name,
          ...provider.getMetadata(),
          supportedOperations: provider.getSupportedOperations()
        });
      } catch (error) {
        metadata.push({
          name,
          error: error.message
        });
      }
    }

    return metadata;
  }
}

// Export singleton instance
export default new ProviderManager();
