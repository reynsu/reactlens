import { expect, test } from '@playwright/test';

// Happy path: a 10% coupon on a $50 cart should render a $5 discount.
// The coupon code in this test is literal text "ten%" — the product
// SHOULD reject unparseable codes, but instead the calc returns NaN
// and the badge silently shows "$0". The spec is correct; the bug is
// in the component logic (calculation + fallback together hide it).
test('checkout shows the correct discount for a parseable percent coupon', async ({ page }) => {
  await page.goto('/checkout?cart=item1:50&coupon=ten%25');
  await expect(page.getByTestId('discount-badge')).toHaveText('Saved $5');
});
