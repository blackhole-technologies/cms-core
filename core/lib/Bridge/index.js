/**
 * Bridge Layer - Integration between legacy and new systems
 *
 * WHY THIS EXISTS:
 * CMS-Core is migrating from legacy patterns to new lib/ patterns:
 * - Legacy: core/services.js, core/hooks.js
 * - New: core/lib/DependencyInjection/Container.js, core/lib/Hook/HookManager.js
 *
 * The bridge layer allows both systems to coexist during migration:
 * 1. Creates new pattern instances (Container, HookManager)
 * 2. Creates bridge adapters (ServiceBridge, HookBridge)
 * 3. Migrates existing legacy registrations to new systems
 * 4. Wires infrastructure on all pattern classes
 * 5. Registers pattern instances as services
 *
 * This enables:
 * - Existing modules to keep using legacy APIs
 * - New modules to use new pattern APIs
 * - Gradual migration without breaking changes
 * - Both APIs accessing the same underlying data
 *
 * Drupal equivalent: No direct equivalent (Drupal didn't have dual systems)
 */

import { ServiceBridge } from './ServiceBridge.js';
import { HookBridge } from './HookBridge.js';
import { Container } from '../DependencyInjection/Container.js';
import { HookManager } from '../Hook/HookManager.js';

/**
 * Orchestrates the full bridge setup between legacy and new systems.
 *
 * WHY: Single class that handles all bridge wiring. Called once during
 * boot.js to create the integration layer.
 *
 * @example
 * ```javascript
 * // In core/boot.js:
 * import * as legacyServices from './core/services.js';
 * import * as legacyHooks from './core/hooks.js';
 * import { BridgeManager } from './core/lib/Bridge/index.js';
 *
 * const bridge = new BridgeManager(legacyServices, legacyHooks);
 * const { container, hookManager, serviceBridge, hookBridge } = await bridge.setup();
 *
 * // Now both legacy and new APIs work:
 * legacyServices.get('database'); // Works
 * container.get('database');      // Works (same instance)
 * ```
 */
export class BridgeManager {
  /**
   * Create a bridge manager.
   *
   * @param {Object} legacyServices - The legacy core/services.js module
   * @param {Object} legacyHooks - The legacy core/hooks.js module
   */
  constructor(legacyServices, legacyHooks) {
    // WHY: Store references to legacy systems
    this._legacyServices = legacyServices;
    this._legacyHooks = legacyHooks;

    // WHY: Track if setup has been called (prevent double setup)
    this._setupComplete = false;
  }

  /**
   * Set up the complete bridge layer.
   *
   * WHY: This method:
   * 1. Creates new Container and HookManager instances
   * 2. Creates ServiceBridge and HookBridge adapters
   * 3. Migrates existing legacy registrations to new systems
   * 4. Wires infrastructure on pattern classes (PluginManager, EntityTypeManager)
   * 5. Registers pattern instances as services in the Container
   * 6. Returns all components for use in boot.js
   *
   * @returns {Promise<Object>} Bridge components:
   *   - container: The new DI Container instance
   *   - hookManager: The new HookManager instance
   *   - serviceBridge: ServiceBridge adapter
   *   - hookBridge: HookBridge adapter
   *
   * @example
   * ```javascript
   * const { container, hookManager, serviceBridge, hookBridge } = await bridge.setup();
   *
   * // Access pattern instances:
   * const hooks = container.get('hooks');
   * const entityManager = container.get('entity_type.manager');
   * ```
   */
  async setup() {
    // WHY: Prevent double setup (would create duplicate instances)
    if (this._setupComplete) {
      throw new Error('BridgeManager.setup() has already been called');
    }

    // STEP 1: Create new pattern instances
    // WHY: These replace the legacy systems
    const container = new Container();
    const hookManager = new HookManager();

    // STEP 2: Create bridge adapters
    // WHY: These allow both systems to work together
    const serviceBridge = new ServiceBridge(this._legacyServices, container);
    const hookBridge = new HookBridge(this._legacyHooks, hookManager);

    // STEP 3: Migrate existing legacy registrations
    // WHY: Legacy services/hooks may have been registered before bridge setup
    // (early boot). Wrap them so both systems have the same data.
    const migratedServices = serviceBridge.wrapLegacy();
    const migratedHooks = hookBridge.wrapLegacy();

    console.log(
      `[BridgeManager] Migrated ${migratedServices} legacy services to Container`
    );
    console.log(
      `[BridgeManager] Migrated ${migratedHooks} legacy hooks to HookManager`
    );

    // STEP 4: Wire infrastructure on pattern classes
    // WHY: Pattern classes (PluginManager, EntityTypeManager) need references
    // to Container and HookManager to function. We wire them here.

    // 4a. Check if EntityTypeManager is available
    // WHY: EntityTypeManager might not be built yet (depends on spec progress)
    try {
      const { EntityTypeManager } = await import('../Entity/EntityTypeManager.js');

      // WHY: Create EntityTypeManager instance
      const entityTypeManager = new EntityTypeManager();

      // WHY: Wire infrastructure (Container + HookManager)
      entityTypeManager.setInfrastructure(container, hookManager);

      // WHY: Register as service 'entity_type.manager'
      // This makes it available via container.get('entity_type.manager')
      container.register('entity_type.manager', () => entityTypeManager, {
        singleton: true,
        tags: ['manager'],
      });

      console.log('[BridgeManager] Wired EntityTypeManager infrastructure');
    } catch (e) {
      // WHY: EntityTypeManager not built yet - skip (not an error)
      if (e.code !== 'ERR_MODULE_NOT_FOUND') {
        console.warn('[BridgeManager] Error loading EntityTypeManager:', e.message);
      }
    }

    // 4b. Wire PluginManager instances
    // WHY: PluginManager instances may already exist (created by modules).
    // We need to wire their infrastructure so they can function.
    // However, at this point in boot, we don't have module paths yet.
    // So we register a helper service that modules can call later.

    // WHY: Helper function to wire a PluginManager instance
    const wirePluginManager = (pluginManager, modulePaths) => {
      pluginManager.setInfrastructure(container, hookManager, modulePaths);
    };

    // WHY: Register helper as service
    container.register('plugin_manager.wire_infrastructure', () => wirePluginManager, {
      singleton: true,
      tags: ['helper'],
    });

    // STEP 5: Register pattern instances as services
    // WHY: Makes them available via container.get() for dependency injection

    // 5a. Register Container itself
    // WHY: Allows services to inject the container (e.g., for lazy resolution)
    container.register('container', () => container, {
      singleton: true,
      tags: ['core'],
    });

    // 5b. Register HookManager
    // WHY: Modules need access to hook system for registering hooks
    container.register('hooks', () => hookManager, {
      singleton: true,
      tags: ['core'],
    });

    // 5c. Register ServiceBridge and HookBridge
    // WHY: Boot.js may need to access bridges for special cases
    container.register('service_bridge', () => serviceBridge, {
      singleton: true,
      tags: ['bridge'],
    });

    container.register('hook_bridge', () => hookBridge, {
      singleton: true,
      tags: ['bridge'],
    });

    // STEP 6: Mark setup as complete
    this._setupComplete = true;

    console.log('[BridgeManager] Bridge setup complete');

    // STEP 7: Return all components
    // WHY: Boot.js needs references to use the new systems
    return {
      container,
      hookManager,
      serviceBridge,
      hookBridge,
    };
  }

  /**
   * Check if setup has been completed.
   *
   * @returns {boolean} True if setup() has been called
   */
  isSetupComplete() {
    return this._setupComplete;
  }
}

// WHY: Export individual classes for direct import
export { ServiceBridge, HookBridge };
