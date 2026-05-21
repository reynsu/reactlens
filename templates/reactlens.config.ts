// User-facing reactlens config. Validated by Zod via src/config/schema.ts.
// Anything you change here is the contract between your app and reactlens.
import { defineConfig } from 'reactlens/config';

export default defineConfig({
  // Glob of components reactlens analyzes for visual states.
  componentGlobs: ['src/pages/**/*.tsx', 'src/components/**/*.tsx'],

  // Test pattern. 'pom' (default) generates portable Page-Object specs that
  // run under plain Playwright without reactlens. 'component-object' emits
  // specs that assert directly on React component props/state via the
  // Component() helper — richer, but requires reactlens at runtime.
  // See docs/adr/0006-component-object-pattern-as-opt-in.md.
  pattern: 'pom',

  // Where generated tests are written.
  output: {
    pages: 'e2e/pages',
    specs: 'e2e/specs',
  },

  // Where MSW handlers shared by generated tests live.
  msw: {
    handlers: 'src/mocks/handlers.ts',
  },

  // Dashboard server.
  dashboard: {
    port: 7777,
    open: true,
  },
});
