// When a CI script runs its main. The tests import these scripts as modules, so the main cannot
// run unconditionally; but gating on `import.meta.main` alone fails open, because a runtime that
// lacks it (Node before 22.18 and 24.2 still strips types) leaves it undefined and the script
// exits 0 having checked nothing. Only an explicit `false`, a module that another one imported,
// skips the main.

/** True unless the runtime says another module imported this file. */
export function runsAsScript(importMetaMain: boolean | undefined): boolean {
  return importMetaMain !== false;
}
