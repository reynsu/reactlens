// Byte-stable input → expected-contents tests for `renderPlaywrightConfig`.
// Prior art: ablation-report-formatter.test.ts (a pure formatter). We assert
// the exact rendered string for vite+pnpm and next+npm, plus targeted checks
// that the REACTLENS_* env-override escape hatches survive interpolation
// (issue #66 acceptance).
import { describe, expect, it } from 'vitest';
import { renderPlaywrightConfig } from '../../src/scaffold/render-playwright-config';
import type { ScaffoldInputs } from '../../src/scaffold/detect-scaffold-inputs';

const VITE_PNPM: ScaffoldInputs = {
  devServerPort: 5173,
  devCommand: 'pnpm dev',
  packageManager: 'pnpm',
  baseURL: 'http://localhost:5173',
  router: 'react-router',
  reactVersion: '^18',
  testDir: 'e2e/specs',
  componentGlobs: ['src/pages/**/*.tsx', 'src/components/**/*.tsx'],
};

const NEXT_NPM: ScaffoldInputs = {
  devServerPort: 3000,
  devCommand: 'next dev',
  packageManager: 'npm',
  baseURL: 'http://localhost:3000',
  router: 'next-app',
  reactVersion: '^18',
  testDir: 'e2e/specs',
  componentGlobs: ['app/**/*.tsx'],
};

const VITE_PNPM_EXPECTED = `// Written by \`reactlens init\`. The dev server, port, and baseURL below were
// interpolated from the detected stack (ADR-0010). The REACTLENS_* env vars
// remain as escape hatches: set REACTLENS_BASE_URL / REACTLENS_WEB_SERVER to
// override, or REACTLENS_NO_WEB_SERVER=1 when reactlens manages the server.
import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.REACTLENS_BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './e2e/specs',
  fullyParallel: false,
  workers: 1,
  reporter: [['./reactlens/streaming-reporter.ts']],
  globalSetup: './reactlens/global-setup.ts',
  use: {
    baseURL: BASE_URL,
    trace: 'on',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Skip auto-starting a dev server when REACTLENS_NO_WEB_SERVER is set (eg.
  // when reactlens is driving the run and managing the server itself).
  webServer:
    process.env.REACTLENS_NO_WEB_SERVER === '1'
      ? undefined
      : {
          command: process.env.REACTLENS_WEB_SERVER ?? 'pnpm dev',
          url: BASE_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
});
`;

describe('renderPlaywrightConfig', () => {
  it('renders vite+pnpm byte-for-byte', () => {
    expect(renderPlaywrightConfig(VITE_PNPM)).toBe(VITE_PNPM_EXPECTED);
  });

  it('renders next+npm with port 3000 and `next dev`', () => {
    const out = renderPlaywrightConfig(NEXT_NPM);
    expect(out).toContain(`process.env.REACTLENS_BASE_URL ?? 'http://localhost:3000'`);
    expect(out).toContain(`process.env.REACTLENS_WEB_SERVER ?? 'next dev'`);
  });

  it('is deterministic (same input → identical output)', () => {
    expect(renderPlaywrightConfig(VITE_PNPM)).toBe(renderPlaywrightConfig(VITE_PNPM));
  });

  it('preserves all three REACTLENS_* env override hatches', () => {
    const out = renderPlaywrightConfig(VITE_PNPM);
    expect(out).toContain('process.env.REACTLENS_BASE_URL ??');
    expect(out).toContain('process.env.REACTLENS_WEB_SERVER ??');
    expect(out).toContain(`process.env.REACTLENS_NO_WEB_SERVER === '1'`);
  });
});
