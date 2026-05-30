// Pure, byte-stable renderer: ScaffoldInputs → the concrete
// reactlens.config.ts contents written by `reactlens init` (ADR-0010).
//
// This replaces the verbatim `fs.copyFile` of templates/reactlens.config.ts.
// The only value interpolated from the detected stack is `componentGlobs`,
// seeded from the project's actual component directories so `reactlens
// generate` finds something out of the box (issue #71). Everything else
// mirrors the template verbatim.
//
// Kept as a template string (not an AST transform) so the output is
// deterministic to the byte for the formatter-style unit tests, matching the
// pattern in render-playwright-config.ts.
import type { ScaffoldInputs } from './detect-scaffold-inputs';

function renderGlobs(globs: string[]): string {
  return globs.map((g) => `'${g}'`).join(', ');
}

export function renderReactlensConfig(inputs: ScaffoldInputs): string {
  const { componentGlobs } = inputs;
  return `// User-facing reactlens config. Validated by Zod via src/config/schema.ts.
// Anything you change here is the contract between your app and reactlens.
import { defineConfig } from '@reynsu/reactlens/config';

export default defineConfig({
  // Glob of components reactlens analyzes for visual states. Seeded from the
  // component directories detected at init time (ADR-0010).
  componentGlobs: [${renderGlobs(componentGlobs)}],

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

  // Dashboard server.
  dashboard: {
    port: 7777,
    open: true,
  },
});
`;
}
