// Pure, byte-stable renderer: ScaffoldInputs → the concrete
// playwright.config.ts contents written by `reactlens init` (ADR-0010).
//
// This replaces the verbatim `fs.copyFile` of templates/playwright.config.ts
// for that one file. The detected port / command / baseURL / testDir are
// baked in as the concrete defaults, but the `process.env.REACTLENS_* ??
// <concrete>` override pattern from the template is preserved verbatim so the
// REACTLENS_WEB_SERVER / REACTLENS_BASE_URL / REACTLENS_NO_WEB_SERVER escape
// hatches keep working.
//
// Kept as a template string (not an AST transform of the source file) because
// the output must be deterministic to the byte for the formatter-style unit
// tests, and the config shape is small and stable.
import type { ScaffoldInputs } from './detect-scaffold-inputs';

export function renderPlaywrightConfig(inputs: ScaffoldInputs): string {
  const { baseURL, devCommand, testDir } = inputs;
  return `// Written by \`reactlens init\`. The dev server, port, and baseURL below were
// interpolated from the detected stack (ADR-0010). The REACTLENS_* env vars
// remain as escape hatches: set REACTLENS_BASE_URL / REACTLENS_WEB_SERVER to
// override, or REACTLENS_NO_WEB_SERVER=1 when reactlens manages the server.
import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.REACTLENS_BASE_URL ?? '${baseURL}';

export default defineConfig({
  testDir: './${testDir}',
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
          command: process.env.REACTLENS_WEB_SERVER ?? '${devCommand}',
          url: BASE_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
});
`;
}
