import { expect, test } from '@playwright/test';

test('pagination renders the last partial page', async ({ page }) => {
  await page.goto('/items?total=11&pageSize=5');
  await expect(page.getByTestId('page-3')).toBeVisible();
});
