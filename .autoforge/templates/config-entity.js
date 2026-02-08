/**
 * TEMPLATE: Config Entity Pattern
 * 
 * Config entities are stored as JSON files in config/<type>/.
 * Used by: ECA (rules), Pathauto (patterns), Redirect (redirects),
 *          Sitemap (settings), Search API (indexes, servers)
 * 
 * Unlike content (which is user-created data), config entities
 * define system behavior and are importable/exportable.
 */

// Service that manages a config entity type
class ConfigEntityManager {
  constructor(ctx, entityType) {
    this.ctx = ctx;
    this.entityType = entityType;
    this.configDir = `config/${entityType}`;
    this.cache = new Map();
    this.fs = null; // lazy load node:fs
  }

  async _ensureFs() {
    if (!this.fs) {
      this.fs = await import('node:fs');
      this.path = await import('node:path');
      // Ensure directory exists
      this.fs.mkdirSync(this.configDir, { recursive: true });
    }
  }

  // Load all config entities
  async loadAll() {
    await this._ensureFs();
    this.cache.clear();
    const files = this.fs.readdirSync(this.configDir)
      .filter(f => f.endsWith('.json'));

    for (const file of files) {
      const data = JSON.parse(
        this.fs.readFileSync(this.path.join(this.configDir, file), 'utf8')
      );
      this.cache.set(data.id, data);
    }
    return [...this.cache.values()];
  }

  // Get single entity
  get(id) {
    return this.cache.get(id) || null;
  }

  // List all (optionally filtered)
  list(filter = null) {
    const all = [...this.cache.values()];
    return filter ? all.filter(filter) : all;
  }

  // Create/update entity
  async save(entity) {
    await this._ensureFs();
    if (!entity.id) {
      entity.id = this._generateId(entity);
    }
    entity.updated = new Date().toISOString();
    if (!entity.created) entity.created = entity.updated;

    const filePath = this.path.join(this.configDir, `${entity.id}.json`);
    this.fs.writeFileSync(filePath, JSON.stringify(entity, null, 2), 'utf8');
    this.cache.set(entity.id, entity);
    return entity;
  }

  // Delete entity
  async remove(id) {
    await this._ensureFs();
    const filePath = this.path.join(this.configDir, `${id}.json`);
    if (this.fs.existsSync(filePath)) {
      this.fs.unlinkSync(filePath);
    }
    this.cache.delete(id);
  }

  // Export all as array (for backup/migration)
  exportAll() {
    return [...this.cache.values()];
  }

  // Import from array (for restore/migration)
  async importAll(entities) {
    for (const entity of entities) {
      await this.save(entity);
    }
  }

  _generateId(entity) {
    // Use label/name if available, otherwise random
    const base = entity.label || entity.name || '';
    if (base) {
      return base.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 50);
    }
    return `${this.entityType}_${Date.now().toString(36)}`;
  }
}

/**
 * Usage in a module:
 * 
 *   // ECA module
 *   export function hook_boot(ctx) {
 *     const ecaRules = new ConfigEntityManager(ctx, 'eca');
 *     ctx.services.register('eca.rules', ecaRules);
 *   }
 *   
 *   export function hook_ready(ctx) {
 *     const rules = ctx.services.get('eca.rules');
 *     await rules.loadAll();
 *     // Subscribe to events based on loaded rules...
 *   }
 * 
 * Storage:
 *   config/eca/notify-on-publish.json
 *   config/eca/auto-tag-content.json
 *   config/pathauto/article-pattern.json
 *   config/redirect/old-blog-url.json
 *   config/search/default-index.json
 */

export { ConfigEntityManager };
