import { expect, test } from '@playwright/test';

test('checkout shows the correct discount for a 10% coupon on a $50 cart', async ({ page }) => {
  await page.goto('/checkout?cart=item1:50&coupon=ten%25');
  await expect(page.getByTestId('discount-badge')).toHaveText('Saved $5');
});
