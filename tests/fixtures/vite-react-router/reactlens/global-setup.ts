// Playwright global setup. Runs once before the test suite. The probe
// injection and CDP screencast both happen per-test in `reactlens/fixtures.ts`
// (Playwright disallows `test.beforeEach` calls in config-time files), so
// this file only exists to satisfy `playwright.config.ts`'s globalSetup
// reference and to provide a hook for users who want to run pre-suite work.
import type { FullConfig } from '@playwright/test';

export default async function globalSetup(_config: FullConfig): Promise<void> {
  // Intentional no-op. Add your own pre-suite setup here if needed.
}
