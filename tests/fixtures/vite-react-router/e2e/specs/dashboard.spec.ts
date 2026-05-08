import { expect, test } from '../../reactlens/fixtures';
import { DashboardPage } from '../pages/DashboardPage';

test.describe('Dashboard', () => {
  test('shows loading state while orders fetch is pending', async ({ page }) => {
    // Hold the response open to keep the loading state visible long enough
    // to assert against. Resolved at end of test so React Query unsubscribes
    // cleanly.
    let release: (() => void) | undefined;
    await page.route('**/api/orders', async (route) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.fulfill({ status: 200, body: '[]' });
    });

    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await expect(dashboard.loading).toBeVisible();
    release?.();
  });

  test('shows the empty state when there are no orders', async ({ page }) => {
    await page.route('**/api/orders', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await expect(dashboard.empty).toBeVisible();
  });

  test('shows the error state with a retry button when fetch fails', async ({ page }) => {
    await page.route('**/api/orders', (route) =>
      route.fulfill({ status: 500, body: 'boom' }),
    );
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await expect(dashboard.error).toBeVisible();
    await expect(dashboard.retry).toBeVisible();
  });

  test('renders orders in the success state', async ({ page }) => {
    await page.route('**/api/orders', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: 'X1', total: 9.5, status: 'pending' }]),
      }),
    );
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await expect(dashboard.success).toBeVisible();
    await expect(page.getByTestId('order-X1')).toBeVisible();
  });
});
