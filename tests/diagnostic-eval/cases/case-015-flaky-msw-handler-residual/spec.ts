import { expect, test } from '@playwright/test';

test('coupon widget shows the empty state when no coupons are configured', async ({ page }) => {
  await page.goto('/coupons');
  await expect(page.getByTestId('coupons-empty')).toBeVisible();
});
