// Byte-stable input → expected-contents tests for `renderReactlensConfig`.
// Mirrors render-playwright-config.test.ts. The only interpolated value is
// `componentGlobs`; everything else must match the current template shape
// (no `msw` field — removed by issue #67).
import { describe, expect, it } from 'vitest';
import { renderReactlensConfig } from '../../src/scaffold/render-reactlens-config';
import type { ScaffoldInputs } from '../../src/scaffold/detect-scaffold-inputs';

const BASE: ScaffoldInputs = {
  devServerPort: 5173,
  devCommand: 'pnpm dev',
  packageManager: 'pnpm',
  baseURL: 'http://localhost:5173',
  router: 'react-router',
  reactVersion: '^18',
  testDir: 'e2e/specs',
  componentGlobs: ['src/components/**/*.tsx'],
};

const BASE_EXPECTED = `// User-facing reactlens config. Validated by Zod via src/config/schema.ts.
// Anything you change here is the contract between your app and reactlens.
import { defineConfig } from '@reynsu/reactlens/config';

export default defineConfig({
  // Glob of components reactlens analyzes for visual states. Seeded from the
  // component directories detected at init time (ADR-0010).
  componentGlobs: ['src/components/**/*.tsx'],

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

describe('renderReactlensConfig', () => {
  it('renders a single-glob input byte-for-byte', () => {
    expect(renderReactlensConfig(BASE)).toBe(BASE_EXPECTED);
  });

  it('bakes in multiple seeded globs', () => {
    const out = renderReactlensConfig({
      ...BASE,
      componentGlobs: ['app/**/*.tsx', 'src/components/**/*.tsx'],
    });
    expect(out).toContain(`componentGlobs: ['app/**/*.tsx', 'src/components/**/*.tsx'],`);
  });

  it('renders the default globs when nothing else is seeded', () => {
    const out = renderReactlensConfig({
      ...BASE,
      componentGlobs: ['src/pages/**/*.tsx', 'src/components/**/*.tsx'],
    });
    expect(out).toContain(`componentGlobs: ['src/pages/**/*.tsx', 'src/components/**/*.tsx'],`);
  });

  it('does not emit an msw field (removed by #67)', () => {
    expect(renderReactlensConfig(BASE)).not.toContain('msw');
  });

  it('is deterministic (same input → identical output)', () => {
    expect(renderReactlensConfig(BASE)).toBe(renderReactlensConfig(BASE));
  });
});
