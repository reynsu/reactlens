// Eval scaffold for case-009 (flaky/test-ordering). The bug only manifests
// when a previous spec leaks cart state into localStorage; in isolation the
// component is correct. This spec simulates that leak in a controlled way:
// open the page, write a cart item to localStorage, reload so the mount
// effect re-runs against the populated state, then assert the empty banner —
// which now fails because items.length === 1.
//
// This is intentionally a failing spec so the probe captures the post-load
// component snapshot (items: [{id:'abc'}]) for the diagnostic-eval pipeline.
import { expect, test } from '../../../reactlens/fixtures';

test('cart shows empty state on first visit', async ({ page }) => {
  await page.goto('/eval/case-009');
  await page.evaluate(() => {
    localStorage.setItem('cart', JSON.stringify([{ id: 'abc' }]));
  });
  await page.goto('/eval/case-009');
  await expect(page.getByTestId('cart-empty')).toBeVisible({ timeout: 1500 });
});
