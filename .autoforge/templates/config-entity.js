/**
 * META-PATTERN TEMPLATE: ConfigEntity
 * =====================================
 * 
 * Drupal equivalent: ConfigEntityBase.php, ConfigEntityStorage.php
 * 
 * Config entities are structured configuration that can be exported, imported,
 * and versioned. Unlike content entities (user data), config entities define
 * system behavior: content types, views, image styles, roles, text formats,
 * workflows, vocabularies, blocks, menus, filter formats, languages, etc.
 * 
 * ONE pattern covers ALL config entity types. You create a new config entity
 * type by registering it with EntityTypeManager (isConfigEntity: true) and
 * using ConfigEntityStorage for file-based persistence.
 * 
 * Storage: config/active/{entityTypeId}.{id}.json
 * Export: config/staging/ (for deployment)
 * 
 * @example Defining a config entity type (in a module)
 * ```javascript
 * // modules/node/index.js
 * export function hook_entity_type_info(context) {
 *   context.entityTypeManager.register('node_type', {
 *     label: 'Content type',
 *     isConfigEntity: true,
 *     keys: { id: 'id', uuid: 'uuid', label: 'label' },
 *     handlers: {
 *       storage: new ConfigEntityStorage('node_type', 'config'),
 *     },
 *   });
 * }
 * ```
 * 
 * @example Creating and saving config entities
 * ```javascript
 * const storage = entityTypeManager.getStorage('node_type');
 * 
 * const articleType = new ConfigEntity('node_type', {
 *   id: 'article',
 *   label: 'Article',
 *   description: 'Use articles for time-sensitive content.',
 *   status: true,
 * });
 * 
 * await storage.save(articleType);
 * // Writes to: config/active/node_type.article.json
 * 
 * const loaded = await storage.load('article');
 * console.log(loaded.label); // 'Article'
 * 
 * // Export all config for deployment
 * await storage.exportToStaging();
 * // Copies to: config/staging/node_type.article.json
 * ```
 * 
 * @example Default config during module install
 * ```javascript
 * // modules/node/config/install/node_type.page.json
 * {
 *   "id": "page",
 *   "label": "Basic page",
 *   "description": "Use basic pages for static content.",
 *   "status": true,
 *   "dependencies": { "module": ["node"] }
 * }
 * 
 * // During install, ModuleInstaller copies these to config/active/
 * ```
 * 
 * @example Config entity types in CMS-Core
 * ```
 * node_type       — Content types (Article, Page, etc.)
 * taxonomy.vocabulary — Vocabularies (Tags, Categories)
 * view            — Views (content listings)
 * image_style     — Image styles (thumbnail, medium, large)
 * text_format     — Text formats (Basic HTML, Full HTML)
 * user.role       — User roles (admin, editor, authenticated)
 * block           — Block placements
 * menu            — Menus (main, footer, admin)
 * filter_format   — Filter formats
 * language        — Languages
 * shortcut_set    — Shortcut sets
 * workflow        — Editorial workflows
 * ```
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const ORIGINAL = Symbol('original');

/**
 * Base class for all config entities.
 */
export class ConfigEntity {
  /**
   * @param {string} entityTypeId - Config entity type (e.g., 'node_type', 'view')
   * @param {Object} values - The config values
   */
  constructor(entityTypeId, values = {}) {
    this._entityTypeId = entityTypeId;
    this.uuid = values.uuid || randomUUID();
    this.id = values.id || null;
    this.label = values.label || '';
    this.status = values.status !== false;
    this.dependencies = values.dependencies || { module: [], config: [], content: [] };
    this.langcode = values.langcode || 'en';

    // Store all values
    this._values = { ...values };

    // Track original state for dirty checking
    this[ORIGINAL] = structuredClone(values);
  }

  /** Get a config value */
  get(key) {
    return this._values[key];
  }

  /** Set a config value */
  set(key, value) {
    this._values[key] = value;
    return this;
  }

  /** Check if modified since creation/load */
  isDirty() {
    return JSON.stringify(this._values) !== JSON.stringify(this[ORIGINAL]);
  }

  /** Serialize to plain object */
  toJSON() {
    return {
      uuid: this.uuid,
      id: this.id,
      label: this.label,
      status: this.status,
      dependencies: this.dependencies,
      langcode: this.langcode,
      ...this._values,
    };
  }

  /**
   * Get config name for file storage.
   * e.g., 'node_type.article' for content type 'article'
   */
  getConfigName() {
    return `${this._entityTypeId}.${this.id}`;
  }
}

/**
 * File-based storage for config entities.
 * 
 * Active config: {configDir}/active/{entityTypeId}.{id}.json
 * Staging (export): {configDir}/staging/{entityTypeId}.{id}.json
 */
export class ConfigEntityStorage {
  /**
   * @param {string} entityTypeId
   * @param {string} configDir - Base config directory (usually 'config')
   */
  constructor(entityTypeId, configDir) {
    this._entityTypeId = entityTypeId;
    this._activeDir = join(configDir, 'active');
    this._stagingDir = join(configDir, 'staging');
    this._cache = new Map();

    for (const dir of [this._activeDir, this._stagingDir]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
  }

  async load(id) {
    if (this._cache.has(id)) return this._cache.get(id);
    const filePath = join(this._activeDir, `${this._entityTypeId}.${id}.json`);
    if (!existsSync(filePath)) return null;
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    const entity = new ConfigEntity(this._entityTypeId, data);
    this._cache.set(id, entity);
    return entity;
  }

  async save(entity) {
    const filePath = join(this._activeDir, `${entity.getConfigName()}.json`);
    writeFileSync(filePath, JSON.stringify(entity.toJSON(), null, 2));
    this._cache.set(entity.id, entity);
  }

  async delete(id) {
    const filePath = join(this._activeDir, `${this._entityTypeId}.${id}.json`);
    if (existsSync(filePath)) unlinkSync(filePath);
    this._cache.delete(id);
  }

  async loadMultiple(ids) {
    const results = new Map();
    for (const id of ids) {
      const entity = await this.load(id);
      if (entity) results.set(id, entity);
    }
    return results;
  }

  async loadAll() {
    const prefix = `${this._entityTypeId}.`;
    const files = readdirSync(this._activeDir)
      .filter(f => f.startsWith(prefix) && f.endsWith('.json'));
    const results = new Map();
    for (const file of files) {
      const id = file.slice(prefix.length, -5);
      const entity = await this.load(id);
      if (entity) results.set(id, entity);
    }
    return results;
  }

  /** Export all config to staging directory (for deployment) */
  async exportToStaging() {
    const all = await this.loadAll();
    for (const [id, entity] of all) {
      const filePath = join(this._stagingDir, `${entity.getConfigName()}.json`);
      writeFileSync(filePath, JSON.stringify(entity.toJSON(), null, 2));
    }
    return all.size;
  }
}
