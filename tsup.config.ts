import { defineConfig } from 'tsup';

// A GitHub JavaScript Action must be self-contained — the runner executes the
// committed dist/ directly, with no `npm install` step. So we bundle every
// dependency (including @modexagents/core and its transitive deps) into one file.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  noExternal: [/.*/],
  clean: true,
  // No sourcemap: the bundle is committed and CI diff-checks it, so the
  // artifact must be deterministic across machines. A ~9MB map also bloats
  // every commit that touches a dependency.
  sourcemap: false,
  target: 'node20',
  splitting: false,
  outDir: 'dist',
  // Some transitive CJS deps (e.g. `tunnel`, pulled in via @actions/core's
  // http-client) call `require('net')` and other builtins at runtime. esbuild's
  // ESM output stubs `require` to throw; this banner restores a real one via
  // createRequire, which resolves Node builtins correctly.
  banner: {
    js: "import { createRequire as __modexCreateRequire } from 'node:module'; const require = __modexCreateRequire(import.meta.url);",
  },
});
