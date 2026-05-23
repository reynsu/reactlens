// Mirrors the Vite + React Router fixture. Uses `node_modules/.bin/vite`
// directly to bypass pnpm's workspace lookup (the repo root has a
// pnpm-workspace.yaml whose `dev` script is `tsup --watch`, not vite).
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
        // GitHub Actions runners are unprivileged containers without user
        // namespaces; chromium silently fails to fully render under headless
        // sandboxing, the probe's addInitScript never runs against a real
        // page, and component:snapshot / frame events stay at zero (#40).
        // Local runs (CI unset) keep the sandbox for safety.
        launchOptions: process.env.CI ? { args: ['--no-sandbox'] } : undefined,
      },
    },
  ],
  webServer:
    process.env.REACTLENS_NO_WEB_SERVER === '1'
      ? undefined
      : {
          command: process.env.REACTLENS_WEB_SERVER ?? 'node_modules/.bin/vite',
          url: BASE_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
});
