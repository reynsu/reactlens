import { expect, test } from '@playwright/test';

test('checkout succeeds with a 3-digit cvv', async ({ page }) => {
  await page.goto('/checkout');
  await page.getByTestId('cvv-input').fill('123');
  await page.getByTestId('checkout-submit').click();
  await expect(page.getByTestId('checkout-success')).toBeVisible();
});
