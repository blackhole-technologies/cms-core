// Plain JS file that loads the TS fixture module via a dynamic `import()`.
// Used to verify the codemod preserves the file extension on dynamic-import
// arguments after ts-morph's SourceFile.move() rewrites them. Without the
// extension, Node ESM's runtime resolver cannot find the target module.

export async function loadFooDynamically() {
  const mod = await import('./foo.ts');
  return mod.fooValue;
}
