// Copied from the Vite fixture, adjusted for Next.js (port 3000, no extra
// dev-server arg). The streaming-reporter and global-setup are identical.
import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.REACTLENS_BASE_URL ?? 'http://localhost:3000';

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
  // We invoke `next dev` directly (not via `pnpm dev`) because pnpm walks up
  // to the repo root for its workspace context, and the root's `dev` script
  // is `tsup --watch`, not next. The direct binary path avoids the lookup.
  webServer:
    process.env.REACTLENS_NO_WEB_SERVER === '1'
      ? undefined
      : {
          command: process.env.REACTLENS_WEB_SERVER ?? 'node node_modules/next/dist/bin/next dev',
          url: BASE_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
});
