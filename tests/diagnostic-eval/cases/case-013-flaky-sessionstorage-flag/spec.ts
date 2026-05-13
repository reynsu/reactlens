import { expect, test } from '@playwright/test';

test('promo banner shows the legacy copy by default', async ({ page }) => {
  await page.goto('/promo');
  await expect(page.getByTestId('banner-legacy')).toBeVisible();
});
