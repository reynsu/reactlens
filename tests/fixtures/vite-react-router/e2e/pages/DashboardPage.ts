import type { Locator, Page } from '@playwright/test';

export class DashboardPage {
  readonly loading: Locator;
  readonly error: Locator;
  readonly empty: Locator;
  readonly success: Locator;
  readonly retry: Locator;

  constructor(readonly page: Page) {
    this.loading = page.getByTestId('dashboard-loading');
    this.error = page.getByTestId('dashboard-error');
    this.empty = page.getByTestId('dashboard-empty');
    this.success = page.getByTestId('dashboard-success');
    this.retry = page.getByTestId('dashboard-retry');
  }

  async goto(): Promise<void> {
    // ?mocks=off bypasses MSW so tests can install Playwright route handlers.
    await this.page.goto('/dashboard?mocks=off');
  }
}
