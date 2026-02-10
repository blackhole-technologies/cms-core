/**
 * plugin-type-manager.js - Plugin Type Management Service
 *
 * WHY THIS EXISTS:
 * Manages plugin type definitions (field types, block types, condition types).
 * Provides utilities for registering, querying, validating, and instantiating
 * plugin types. Enables introspection of the plugin system.
 *
 * Drupal equivalent: PluginManagerInterface, PluginDefinitionInterface
 *
 * DESIGN DECISION:
 * - Centralized registry for all plugin type metadata
 * - Validation of plugin definitions against schema
 * - Support for type hierarchies (base types, subtypes)
 * - Factory methods for creating plugin instances
 *
 * @example Registering a plugin type
 * ```javascript
 * pluginTypeManager.registerPluginType('field_widget', {
 *   label: 'Field Widget',
 *   description: 'Plugins for rendering form elements',
 *   category: 'field',
 *   baseClass: 'FieldWidgetBase',
 *   defaultSettings: { label: 'visible' },
 * });
 * ```
 *
 * @example Querying plugin types
 * ```javascript
 * const fieldTypes = pluginTypeManager.getPluginTypesByCategory('field');
 * const widgetDef = pluginTypeManager.getPluginType('field_widget');
 * ```
 */

/**
 * Plugin type registry
 * Structure: { typeName: definition }
 */
const pluginTypes = {};

/**
 * Register a plugin type definition
 *
 * @param {string} typeName - Plugin type identifier (e.g., 'field_type', 'block')
 * @param {Object} definition - Plugin type definition
 * @param {string} definition.label - Human-readable name
 * @param {string} [definition.description] - Description of the plugin type
 * @param {string} [definition.category] - Category for grouping (e.g., 'field', 'block')
 * @param {string} [definition.baseClass] - Name of the base class for this type
 * @param {Object} [definition.defaultSettings] - Default configuration for plugins
 * @param {string} [definition.parentType] - Parent type for inheritance
 * @param {Object} [definition.schema] - Validation schema for plugin definitions
 * @param {Function} [definition.factory] - Factory function for creating instances
 *
 * WHY ALLOW METADATA:
 * - label/description: For admin UIs showing available plugin types
 * - category: Grouping related types together (all field-related types)
 * - baseClass: Documentation of expected class hierarchy
 * - defaultSettings: Sensible defaults that all plugins of this type inherit
 * - parentType: Support for type inheritance (field_widget extends field_type)
 * - schema: Runtime validation of plugin definitions
 * - factory: Custom instantiation logic if needed
 */
export function registerPluginType(typeName, definition) {
  // WHY VALIDATE REQUIRED FIELDS:
  // Fail fast if definition is malformed. Better to catch at registration
  // than when trying to use the type later.
  if (!typeName || typeof typeName !== 'string') {
    throw new Error('Plugin type name must be a non-empty string');
  }

  if (!definition || typeof definition !== 'object') {
    throw new Error(`Plugin type "${typeName}" definition must be an object`);
  }

  if (!definition.label || typeof definition.label !== 'string') {
    throw new Error(`Plugin type "${typeName}" must have a label`);
  }

  // WHY ALLOW RE-REGISTRATION:
  // Enables overriding (testing, customization) and hot-reload scenarios.
  // Production code should register once, but dev tools benefit from flexibility.
  pluginTypes[typeName] = {
    name: typeName,
    label: definition.label,
    description: definition.description || '',
    category: definition.category || 'general',
    baseClass: definition.baseClass || 'PluginBase',
    defaultSettings: definition.defaultSettings || {},
    parentType: definition.parentType || null,
    schema: definition.schema || null,
    factory: definition.factory || null,
    // Store registration time for debugging
    registeredAt: new Date().toISOString(),
  };
}

/**
 * Get a plugin type definition
 *
 * @param {string} typeName - Plugin type identifier
 * @returns {Object|null} - The plugin type definition, or null if not found
 *
 * WHY RETURN NULL (not throw):
 * Allows checking existence: if (getPluginType('foo')) { ... }
 * For mandatory lookups, caller can throw their own error.
 */
export function getPluginType(typeName) {
  return pluginTypes[typeName] || null;
}

/**
 * List all registered plugin types
 *
 * @returns {Object[]} - Array of plugin type definitions
 *
 * WHY RETURN COPY:
 * Prevents external code from mutating the registry.
 * Object.values() returns a new array.
 */
export function listPluginTypes() {
  return Object.values(pluginTypes);
}

/**
 * Get plugin types by category
 *
 * @param {string} category - Category to filter by (e.g., 'field', 'block')
 * @returns {Object[]} - Array of plugin type definitions
 *
 * WHY FILTER BY CATEGORY:
 * Admin UIs often group types: "Field Types", "Block Types", etc.
 * This makes it easy to get all types in a group.
 */
export function getPluginTypesByCategory(category) {
  return Object.values(pluginTypes).filter(type => type.category === category);
}

/**
 * Validate a plugin instance against its type definition
 *
 * @param {string} typeName - Plugin type identifier
 * @param {Object} instance - Plugin instance to validate
 * @returns {Object} - Validation result { valid: boolean, errors: string[] }
 *
 * WHY RETURN RESULT OBJECT (not throw):
 * Enables collecting all errors at once (better UX) and allows
 * caller to decide how to handle validation failure.
 */
export function validatePluginType(typeName, instance) {
  const result = {
    valid: true,
    errors: [],
  };

  // Check type exists
  const typeDefinition = pluginTypes[typeName];
  if (!typeDefinition) {
    result.valid = false;
    result.errors.push(`Unknown plugin type: ${typeName}`);
    return result;
  }

  // Basic checks
  if (!instance || typeof instance !== 'object') {
    result.valid = false;
    result.errors.push('Plugin instance must be an object');
    return result;
  }

  // WHY CHECK FOR PLUGIN ID:
  // All plugins should have an ID for identification and debugging.
  // This is part of the PluginBase interface.
  if (typeof instance.getPluginId === 'function') {
    const pluginId = instance.getPluginId();
    if (!pluginId || typeof pluginId !== 'string') {
      result.valid = false;
      result.errors.push('Plugin must have a valid string ID');
    }
  }

  // WHY SCHEMA VALIDATION:
  // If type defines a schema, validate instance against it.
  // Schema format depends on what validation library we use.
  // For now, just check if schema exists and plugin has required fields.
  if (typeDefinition.schema) {
    const schema = typeDefinition.schema;

    // Simple validation: check required fields
    if (schema.required && Array.isArray(schema.required)) {
      for (const field of schema.required) {
        if (!(field in instance)) {
          result.valid = false;
          result.errors.push(`Missing required field: ${field}`);
        }
      }
    }

    // Check field types if schema defines them
    if (schema.properties) {
      for (const [field, fieldSchema] of Object.entries(schema.properties)) {
        if (field in instance) {
          const actualType = typeof instance[field];
          const expectedType = fieldSchema.type;

          if (expectedType && actualType !== expectedType) {
            result.valid = false;
            result.errors.push(
              `Field "${field}" should be ${expectedType}, got ${actualType}`
            );
          }
        }
      }
    }
  }

  return result;
}

/**
 * Create a plugin instance
 *
 * @param {string} typeName - Plugin type identifier
 * @param {Object} config - Configuration for the plugin instance
 * @returns {Object} - Plugin instance
 * @throws {Error} - If type not found or factory fails
 *
 * WHY FACTORY METHOD:
 * Centralizes plugin instantiation logic. If type has a custom factory,
 * use it. Otherwise, return a basic object with the config.
 */
export function createPluginInstance(typeName, config = {}) {
  const typeDefinition = pluginTypes[typeName];

  if (!typeDefinition) {
    throw new Error(
      `Cannot create instance of unknown plugin type: ${typeName}. ` +
      `Available types: ${Object.keys(pluginTypes).join(', ') || 'none'}`
    );
  }

  // WHY CHECK FOR CUSTOM FACTORY:
  // Some plugin types need special instantiation (class construction,
  // dependency injection, initialization hooks). Custom factory handles this.
  if (typeDefinition.factory && typeof typeDefinition.factory === 'function') {
    return typeDefinition.factory(config, typeDefinition);
  }

  // WHY DEFAULT FACTORY:
  // If no custom factory, create a basic instance with:
  // - Config merged with default settings
  // - Reference to type definition
  // - Basic PluginBase-like interface
  const mergedConfig = {
    ...typeDefinition.defaultSettings,
    ...config,
  };

  return {
    _typeName: typeName,
    _config: mergedConfig,
    _definition: typeDefinition,

    getPluginId() {
      return config.id || typeName;
    },

    getPluginDefinition() {
      return typeDefinition;
    },

    getConfiguration() {
      return mergedConfig;
    },

    setConfiguration(key, value) {
      mergedConfig[key] = value;
      return this;
    },
  };
}

/**
 * Check if a plugin type is registered
 *
 * @param {string} typeName - Plugin type identifier
 * @returns {boolean} - True if type exists
 *
 * WHY CONVENIENCE METHOD:
 * Cleaner than: if (getPluginType('foo'))
 */
export function hasPluginType(typeName) {
  return typeName in pluginTypes;
}

/**
 * Clear all plugin types (for testing)
 *
 * @returns {void}
 *
 * WHY CLEAR METHOD:
 * Tests need to reset state between runs. Production code should never call this.
 */
export function clearPluginTypes() {
  for (const key of Object.keys(pluginTypes)) {
    delete pluginTypes[key];
  }
}

/**
 * Initialize the plugin type manager
 *
 * WHY INIT FUNCTION:
 * Follows CMS-Core init/register pattern. Init is called during boot
 * to perform any setup. For this service, no setup is needed (stateless
 * registry), but we provide init for consistency.
 *
 * @param {Object} context - Boot context with services, config, etc.
 * @returns {Object} - The plugin type manager API
 */
export function init(context) {
  // No initialization needed - registry is module-level
  // But we return the API for convenience
  return {
    registerPluginType,
    getPluginType,
    listPluginTypes,
    getPluginTypesByCategory,
    validatePluginType,
    createPluginInstance,
    hasPluginType,
    clearPluginTypes,
  };
}

/**
 * Register with services container
 *
 * WHY REGISTER FUNCTION:
 * Makes this service available as 'plugin_type.manager' for other modules.
 * Follows the service-provider pattern.
 *
 * @param {Object} services - Legacy services object
 * @param {Object} container - DI container (new pattern)
 */
export function register(services, container) {
  // Legacy pattern
  if (services && typeof services.register === 'function') {
    services.register('plugin_type.manager', () => {
      return {
        registerPluginType,
        getPluginType,
        listPluginTypes,
        getPluginTypesByCategory,
        validatePluginType,
        createPluginInstance,
        hasPluginType,
        clearPluginTypes,
      };
    });
  }

  // New container pattern
  if (container && typeof container.register === 'function') {
    container.register('plugin_type.manager', () => {
      return {
        registerPluginType,
        getPluginType,
        listPluginTypes,
        getPluginTypesByCategory,
        validatePluginType,
        createPluginInstance,
        hasPluginType,
        clearPluginTypes,
      };
    }, {
      tags: ['manager', 'plugin'],
      singleton: true,
    });
  }
}

// Export individual functions for direct use
export default {
  init,
  register,
  registerPluginType,
  getPluginType,
  listPluginTypes,
  getPluginTypesByCategory,
  validatePluginType,
  createPluginInstance,
  hasPluginType,
  clearPluginTypes,
};
