/**
 * dependencies.js - Module Dependency Resolution
 *
 * WHY THIS EXISTS:
 * Modules can depend on other modules. For example, an admin module
 * might depend on a users module for authentication. Dependencies must:
 * - Be validated (ensure required modules are present and enabled)
 * - Be sorted (load dependencies before dependents)
 * - Be cycle-free (A → B → A creates an infinite loop)
 *
 * This module provides the algorithms to handle all three concerns.
 *
 * DESIGN DECISIONS:
 * =================
 *
 * 1. FAIL FAST
 *    If dependencies can't be resolved, fail immediately with a clear
 *    error message. Don't try to proceed with partial loading.
 *
 * 2. TOPOLOGICAL SORT
 *    We use Kahn's algorithm for topological sorting because:
 *    - It naturally detects cycles (leftover nodes = cycle)
 *    - It's iterative (no stack overflow on deep graphs)
 *    - It produces a stable, predictable order
 *
 * 3. SEPARATE DETECTION FROM SORTING
 *    Circular dependency detection is separate from sorting so we can
 *    provide better error messages (the actual cycle, not just "failed").
 */

/**
 * Topologically sort modules by their dependencies
 *
 * @param {Array} modules - Array of module objects with { name, dependencies }
 * @returns {Array} - Modules sorted so dependencies come before dependents
 *
 * ALGORITHM: Kahn's Algorithm for Topological Sort
 * =================================================
 *
 * Topological sort orders nodes in a directed acyclic graph (DAG) such that
 * for every edge A → B (A depends on B), B appears before A in the output.
 *
 * Think of it like this: You can't put on shoes before socks. If we have:
 *   shoes → socks (shoes depends on socks)
 * Then the order must be: socks, shoes
 *
 * KAHN'S ALGORITHM STEPS:
 *
 * 1. BUILD IN-DEGREE MAP
 *    Count how many modules depend on each module (in-degree).
 *    If nothing depends on a module, its in-degree is 0.
 *
 *    Example: users has in-degree 1 (admin depends on it)
 *             admin has in-degree 0 (nothing depends on it)
 *
 * 2. FIND STARTING NODES
 *    Modules with in-degree 0 have no unmet dependencies.
 *    These can be loaded first.
 *
 * 3. PROCESS QUEUE
 *    - Take a node with in-degree 0
 *    - Add it to the result (it's safe to load now)
 *    - For each module that depends on it, decrement their in-degree
 *    - If any module now has in-degree 0, add it to the queue
 *    - Repeat until queue is empty
 *
 * 4. CHECK FOR CYCLES
 *    If we processed all modules, there's no cycle.
 *    If some modules remain (in-degree > 0), there's a cycle.
 *
 * WHY KAHN'S (not DFS-based topological sort):
 * - Iterative, not recursive (no stack overflow for large graphs)
 * - Queue-based, so we can control order of equal-priority nodes
 * - Leftover nodes naturally indicate cycles
 *
 * TIME COMPLEXITY: O(V + E) where V = modules, E = dependency edges
 * SPACE COMPLEXITY: O(V) for the in-degree map and queue
 *
 * EXAMPLE:
 * --------
 * Modules: [admin, users, hello]
 * Dependencies: admin → users
 *
 * Step 1: In-degrees
 *   admin: 0 (nothing depends on admin)
 *   users: 1 (admin depends on users)
 *   hello: 0 (nothing depends on hello)
 *
 * Step 2: Starting queue: [admin, hello] (in-degree 0)
 *         Wait, that's wrong! admin depends on users!
 *
 *   Actually, we need to think about this differently.
 *   In-degree counts how many things THIS module depends on.
 *
 *   admin: 1 (depends on users)
 *   users: 0 (depends on nothing)
 *   hello: 0 (depends on nothing)
 *
 *   Starting queue: [users, hello] (in-degree 0)
 *
 * Step 3: Process users
 *   - Add users to result: [users]
 *   - admin depended on users, so decrement admin's "waiting count"
 *   - admin now has waiting count 0, add to queue
 *
 *   Process hello
 *   - Add hello to result: [users, hello]
 *   - Nothing depended on hello
 *
 *   Process admin
 *   - Add admin to result: [users, hello, admin]
 *
 * Step 4: All modules processed, no cycle!
 *
 * Result: [users, hello, admin]
 * (users loads first, then hello, then admin)
 */
export function topologicalSort(modules) {
  // Edge case: no modules
  if (!modules || modules.length === 0) {
    return [];
  }

  // Build a map for quick lookup: name → module
  const moduleMap = new Map();
  for (const mod of modules) {
    moduleMap.set(mod.name, mod);
  }

  // Build adjacency list: module → modules that depend on it
  // If users exists and admin depends on users:
  //   adjacency[users] = [admin]
  const adjacency = new Map();
  for (const mod of modules) {
    adjacency.set(mod.name, []);
  }

  // Count "waiting" dependencies for each module
  // This is how many dependencies are not yet processed
  const waitingCount = new Map();
  for (const mod of modules) {
    const deps = mod.dependencies || [];
    // Only count dependencies that are in our module list
    const validDeps = deps.filter(d => moduleMap.has(d));
    waitingCount.set(mod.name, validDeps.length);

    // For each dependency, record that this module depends on it
    for (const dep of validDeps) {
      adjacency.get(dep).push(mod.name);
    }
  }

  // Find modules with no waiting dependencies (can load immediately)
  const queue = [];
  for (const mod of modules) {
    if (waitingCount.get(mod.name) === 0) {
      queue.push(mod.name);
    }
  }

  // Process queue to build sorted order
  const result = [];

  while (queue.length > 0) {
    // Take next module with no waiting dependencies
    // WHY SHIFT (not pop):
    // Shift gives us FIFO order, which means modules are processed
    // in a more stable, predictable order (roughly discovery order
    // for modules with equal priority).
    const current = queue.shift();
    result.push(moduleMap.get(current));

    // For each module that was waiting on this one
    for (const dependent of adjacency.get(current)) {
      // Decrement their waiting count
      const newCount = waitingCount.get(dependent) - 1;
      waitingCount.set(dependent, newCount);

      // If all their dependencies are now met, they can be processed
      if (newCount === 0) {
        queue.push(dependent);
      }
    }
  }

  // If we didn't process all modules, there's a cycle
  // (Kahn's algorithm leaves cyclic nodes with waiting > 0)
  if (result.length !== modules.length) {
    // Find which modules are stuck in a cycle
    const stuck = modules.filter(m => waitingCount.get(m.name) > 0);
    const stuckNames = stuck.map(m => m.name).join(', ');
    throw new Error(`Circular dependency detected involving: ${stuckNames}`);
  }

  return result;
}

/**
 * Detect circular dependencies and return the cycles
 *
 * @param {Array} modules - Array of module objects with { name, dependencies }
 * @returns {Array} - Array of cycle chains, e.g., [['admin', 'users', 'admin']]
 *
 * ALGORITHM: DFS Cycle Detection
 * ===============================
 *
 * We use depth-first search with three states:
 * - WHITE (0): Not yet visited
 * - GRAY (1): Currently being visited (in the current path)
 * - BLACK (2): Fully processed
 *
 * If we visit a GRAY node, we've found a cycle - we've come back
 * to a node that's on our current path.
 *
 * WHY DFS (not Kahn's):
 * Kahn's algorithm can detect THAT a cycle exists (by leftover nodes),
 * but it can't easily tell you WHICH nodes form the cycle. DFS with
 * path tracking can reconstruct the actual cycle.
 *
 * EXAMPLE:
 * --------
 * Modules: [admin, users, auth]
 * Dependencies:
 *   admin → users
 *   users → auth
 *   auth → admin (creates a cycle!)
 *
 * DFS from admin:
 *   Visit admin (GRAY), path = [admin]
 *   Visit users (GRAY), path = [admin, users]
 *   Visit auth (GRAY), path = [admin, users, auth]
 *   Visit admin - but admin is GRAY!
 *   Cycle found: [admin, users, auth, admin]
 */
export function detectCircular(modules) {
  // Edge case: no modules
  if (!modules || modules.length === 0) {
    return [];
  }

  // Build module map for quick lookup
  const moduleMap = new Map();
  for (const mod of modules) {
    moduleMap.set(mod.name, mod);
  }

  // Track node states: 0 = WHITE, 1 = GRAY, 2 = BLACK
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const state = new Map();
  for (const mod of modules) {
    state.set(mod.name, WHITE);
  }

  // Store found cycles
  const cycles = [];

  /**
   * DFS visit function
   *
   * @param {string} name - Module name to visit
   * @param {Array} path - Current path of module names
   * @returns {boolean} - True if a cycle was found
   */
  function visit(name, path) {
    const currentState = state.get(name);

    // If this node is GRAY, we've found a cycle
    if (currentState === GRAY) {
      // Find where the cycle starts in the path
      const cycleStart = path.indexOf(name);
      // Extract the cycle (including the repeated node at the end)
      const cycle = [...path.slice(cycleStart), name];
      cycles.push(cycle);
      return true;
    }

    // If this node is BLACK, it's fully processed (no cycle through here)
    if (currentState === BLACK) {
      return false;
    }

    // Mark as GRAY (currently visiting)
    state.set(name, GRAY);
    path.push(name);

    // Visit all dependencies
    const mod = moduleMap.get(name);
    const deps = mod?.dependencies || [];

    for (const dep of deps) {
      // Only visit dependencies that exist in our module list
      if (moduleMap.has(dep)) {
        visit(dep, path);
      }
    }

    // Mark as BLACK (fully processed)
    path.pop();
    state.set(name, BLACK);

    return false;
  }

  // Visit all modules (in case the graph is disconnected)
  for (const mod of modules) {
    if (state.get(mod.name) === WHITE) {
      visit(mod.name, []);
    }
  }

  return cycles;
}

/**
 * Validate that all dependencies are present and enabled
 *
 * @param {Array} modules - Array of discovered modules with { name, dependencies }
 * @param {Array} enabled - Array of enabled module names
 * @returns {{ valid: boolean, errors: Array<{ module: string, missing: string }> }}
 *
 * VALIDATION RULES:
 * 1. For each enabled module, check its dependencies
 * 2. Each dependency must exist in the discovered modules
 * 3. Each dependency must also be enabled
 *
 * WHY CHECK DISCOVERED AND ENABLED:
 * A module might exist on disk (discovered) but not be enabled.
 * We need both conditions to be true for a dependency to be satisfied.
 */
export function validateDependencies(modules, enabled) {
  const errors = [];

  // Build sets for quick lookup
  const discoveredNames = new Set(modules.map(m => m.name));
  const enabledNames = new Set(enabled);

  // Build module map for dependency lookup
  const moduleMap = new Map();
  for (const mod of modules) {
    moduleMap.set(mod.name, mod);
  }

  // Check each enabled module
  for (const moduleName of enabled) {
    const mod = moduleMap.get(moduleName);

    if (!mod) {
      // Module is enabled but not discovered - handled elsewhere
      continue;
    }

    const deps = mod.dependencies || [];

    for (const dep of deps) {
      // Check if dependency exists
      if (!discoveredNames.has(dep)) {
        errors.push({
          module: moduleName,
          missing: dep,
          reason: 'not found (not installed)',
        });
        continue;
      }

      // Check if dependency is enabled
      if (!enabledNames.has(dep)) {
        errors.push({
          module: moduleName,
          missing: dep,
          reason: 'not enabled',
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get the dependency tree as a formatted string
 *
 * @param {Array} modules - Array of module objects with { name, dependencies, provides }
 * @returns {string} - Formatted dependency tree
 *
 * EXAMPLE OUTPUT:
 * ---------------
 * Module dependencies:
 *   hello (no dependencies)
 *   test (no dependencies)
 *   users (no dependencies)
 *     provides: auth, user content type
 *   admin
 *     depends on: users
 *
 * Load order: hello, test, users, admin
 */
export function formatDependencyTree(modules) {
  const lines = ['Module dependencies:'];

  for (const mod of modules) {
    const deps = mod.dependencies || [];
    const provides = mod.provides || [];

    if (deps.length === 0) {
      lines.push(`  ${mod.name} (no dependencies)`);
    } else {
      lines.push(`  ${mod.name}`);
      lines.push(`    depends on: ${deps.join(', ')}`);
    }

    if (provides.length > 0) {
      lines.push(`    provides: ${provides.join(', ')}`);
    }
  }

  // Add load order
  try {
    const sorted = topologicalSort(modules);
    const order = sorted.map(m => m.name).join(', ');
    lines.push('');
    lines.push(`Load order: ${order}`);
  } catch (error) {
    lines.push('');
    lines.push(`Load order: ERROR - ${error.message}`);
  }

  return lines.join('\n');
}
