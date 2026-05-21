import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { cli: 'src/cli.ts' },
    format: ['cjs'],
    target: 'node20',
    platform: 'node',
    outDir: 'dist',
    clean: true,
    sourcemap: true,
    banner: { js: '#!/usr/bin/env node' },
    // Inline the ESM-only @reynsu/* helper packages into the CJS bundle.
    // Without this, `node bin/reactlens.js` crashes at module load with
    // ERR_PACKAGE_PATH_NOT_EXPORTED because Node's CJS loader can't
    // require() a package that only ships an `import` export condition.
    // These are pure helpers (prompts, Zod schemas, tree-diff functions)
    // with no top-level await, so transpile-to-CJS is safe.
    noExternal: [
      '@reynsu/reactlens-diagnosis-prompts',
      '@reynsu/reactlens-diff-core',
    ],
  },
  {
    entry: { reporter: 'src/runner/reporter.ts' },
    format: ['cjs'],
    target: 'node20',
    platform: 'node',
    outDir: 'dist/runner',
    sourcemap: true,
  },
  {
    // v0.3 slice 6: Component-Object Pattern runtime helper. Dual ESM+CJS
    // because user specs run under Playwright's bundler, which may be either.
    // Types are emitted so user-facing autocomplete works.
    entry: { 'snapshot-accessor': 'src/component-object/snapshot-accessor.ts' },
    format: ['cjs', 'esm'],
    target: 'node20',
    platform: 'node',
    outDir: 'dist/component-object',
    dts: true,
    sourcemap: true,
  },
  {
    // Re-publishes `defineConfig` for user-side reactlens.config.ts files via
    // the `reactlens/config` subpath. The full schema (zod) is intentionally
    // bundled here too so users get typed errors at config-load time.
    entry: { schema: 'src/config/schema.ts' },
    format: ['cjs', 'esm'],
    target: 'node20',
    platform: 'node',
    outDir: 'dist/config',
    dts: true,
    sourcemap: true,
  },
  {
    entry: { probe: 'src/component-bridge/probe.ts' },
    format: ['iife'],
    target: 'es2020',
    platform: 'browser',
    outDir: 'dist/probe',
    sourcemap: true,
    globalName: 'ReactLensProbe',
  },
]);
