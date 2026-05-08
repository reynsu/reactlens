// Playwright global setup — Phase 1 stub.
// Phase 3.4/4.4 will inject the component bridge probe and attach the CDP
// screencast here. For now this is a placeholder so `playwright test` can
// load the config without errors.
import type { FullConfig } from '@playwright/test';

export default async function globalSetup(_config: FullConfig): Promise<void> {
  // Future: page.addInitScript(loadProbe()) + Page.startScreencast.
}
