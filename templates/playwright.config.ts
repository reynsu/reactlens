// Copied verbatim into user projects by `reactlens init`. Wires the streaming
// reporter, sets baseURL from REACTLENS_BASE_URL (or a sensible default), and
// declares the global setup file that injects the component bridge.
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
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // CI runners (GitHub Actions, GitLab CI, etc.) are typically
        // unprivileged containers without user namespaces; chromium silently
        // fails to fully render under headless sandboxing in that environment,
        // so the probe's addInitScript never runs against a real page and
        // component:snapshot / frame events stay at zero. Local runs (CI
        // unset) keep the sandbox for safety.
        launchOptions: process.env.CI ? { args: ['--no-sandbox'] } : undefined,
      },
    },
  ],
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
