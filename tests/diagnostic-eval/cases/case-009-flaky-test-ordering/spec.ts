import { expect, test } from '@playwright/test';

test('cart shows empty state on first visit', async ({ page }) => {
  await page.goto('/cart');
  await expect(page.getByTestId('cart-empty')).toBeVisible();
});
