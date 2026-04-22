/**
 * dependencies.ts - Module Dependency Resolution
 *
 * Modules can depend on other modules. For example, an admin module might
 * depend on a users module for authentication. Dependencies must be
 * validated (ensure required modules are present and enabled), sorted (load
 * dependencies before dependents) and cycle-free.
 *
 * Topological sort uses Kahn's algorithm; cycle detection uses DFS with
 * three-colour marking so we can surface the actual cycle path.
 */

export interface ModuleDescriptor {
  name: string;
  dependencies?: string[];
  provides?: string[];
  [key: string]: unknown;
}

export interface ValidationError {
  module: string;
  missing: string;
  reason: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Topologically sort modules by their dependencies.
 */
export function topologicalSort<T extends ModuleDescriptor>(modules: T[] | null | undefined): T[] {
  if (!modules || modules.length === 0) {
    return [];
  }

  const moduleMap = new Map<string, T>();
  for (const mod of modules) {
    moduleMap.set(mod.name, mod);
  }

  const adjacency = new Map<string, string[]>();
  for (const mod of modules) {
    adjacency.set(mod.name, []);
  }

  const waitingCount = new Map<string, number>();
  for (const mod of modules) {
    const deps = mod.dependencies || [];
    const validDeps = deps.filter((d) => moduleMap.has(d));
    waitingCount.set(mod.name, validDeps.length);

    for (const dep of validDeps) {
      const list = adjacency.get(dep);
      if (list) list.push(mod.name);
    }
  }

  const queue: string[] = [];
  for (const mod of modules) {
    if (waitingCount.get(mod.name) === 0) {
      queue.push(mod.name);
    }
  }

  const result: T[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    const mod = moduleMap.get(current);
    if (mod) result.push(mod);

    const dependents = adjacency.get(current) || [];
    for (const dependent of dependents) {
      const oldCount = waitingCount.get(dependent) ?? 0;
      const newCount = oldCount - 1;
      waitingCount.set(dependent, newCount);
      if (newCount === 0) {
        queue.push(dependent);
      }
    }
  }

  if (result.length !== modules.length) {
    const stuck = modules.filter((m) => (waitingCount.get(m.name) ?? 0) > 0);
    const stuckNames = stuck.map((m) => m.name).join(', ');
    throw new Error(`Circular dependency detected involving: ${stuckNames}`);
  }

  return result;
}

/**
 * Detect circular dependencies and return the cycles.
 */
export function detectCircular(modules: ModuleDescriptor[] | null | undefined): string[][] {
  if (!modules || modules.length === 0) {
    return [];
  }

  const moduleMap = new Map<string, ModuleDescriptor>();
  for (const mod of modules) {
    moduleMap.set(mod.name, mod);
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const state = new Map<string, number>();
  for (const mod of modules) {
    state.set(mod.name, WHITE);
  }

  const cycles: string[][] = [];

  function visit(name: string, path: string[]): boolean {
    const currentState = state.get(name);

    if (currentState === GRAY) {
      const cycleStart = path.indexOf(name);
      const cycle = [...path.slice(cycleStart), name];
      cycles.push(cycle);
      return true;
    }

    if (currentState === BLACK) {
      return false;
    }

    state.set(name, GRAY);
    path.push(name);

    const mod = moduleMap.get(name);
    const deps = mod?.dependencies || [];

    for (const dep of deps) {
      if (moduleMap.has(dep)) {
        visit(dep, path);
      }
    }

    path.pop();
    state.set(name, BLACK);

    return false;
  }

  for (const mod of modules) {
    if (state.get(mod.name) === WHITE) {
      visit(mod.name, []);
    }
  }

  return cycles;
}

/**
 * Validate that all dependencies are present and enabled.
 */
export function validateDependencies(
  modules: ModuleDescriptor[],
  enabled: string[]
): ValidationResult {
  const errors: ValidationError[] = [];

  const discoveredNames = new Set(modules.map((m) => m.name));
  const enabledNames = new Set(enabled);

  const moduleMap = new Map<string, ModuleDescriptor>();
  for (const mod of modules) {
    moduleMap.set(mod.name, mod);
  }

  for (const moduleName of enabled) {
    const mod = moduleMap.get(moduleName);
    if (!mod) continue;

    const deps = mod.dependencies || [];

    for (const dep of deps) {
      if (!discoveredNames.has(dep)) {
        errors.push({
          module: moduleName,
          missing: dep,
          reason: 'not found (not installed)',
        });
        continue;
      }

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
 * Get the dependency tree as a formatted string.
 */
export function formatDependencyTree(modules: ModuleDescriptor[]): string {
  const lines: string[] = ['Module dependencies:'];

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

  try {
    const sorted = topologicalSort(modules);
    const order = sorted.map((m) => m.name).join(', ');
    lines.push('');
    lines.push(`Load order: ${order}`);
  } catch (error) {
    lines.push('');
    lines.push(`Load order: ERROR - ${(error as Error).message}`);
  }

  return lines.join('\n');
}
