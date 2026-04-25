// Plain JS file that references a TS fixture module via a JSDoc `import()`
// type. Used to verify the codemod preserves the file extension on JSDoc
// type-reference arguments after ts-morph's SourceFile.move() rewrites them.
// Without the extension, tsc (with allowJs + checkJs) and TypeScript-aware
// IDEs cannot resolve the type after the target moves.

/**
 * @type {import('./foo.ts').FooFn | null}
 */
let fooFn = null;

/**
 * @param {import('./foo.ts').FooFn} fn
 */
export function registerFooFn(fn) {
  fooFn = fn;
}

export function getFooFn() {
  return fooFn;
}
