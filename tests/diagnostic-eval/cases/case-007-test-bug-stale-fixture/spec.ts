import { expect, test } from '@playwright/test';

test('product card shows the price', async ({ page }) => {
  await page.goto('/products/abc');
  await expect(page.getByTestId('product-price')).toHaveText('USD 12');
});
