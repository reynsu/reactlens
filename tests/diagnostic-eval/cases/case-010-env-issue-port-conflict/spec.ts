import { expect, test } from '@playwright/test';

test('home heading renders', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('home-heading')).toBeVisible();
});
