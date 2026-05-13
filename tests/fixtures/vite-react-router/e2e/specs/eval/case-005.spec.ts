// Eval scaffold: reproduces case-005-real-bug-off-by-one against the real
// Pagination component mounted in the fixture. This spec is INTENTIONALLY
// failing — the bug (Math.floor instead of Math.ceil) means page-3 is never
// rendered. The probe captures a component snapshot while the test runs;
// scripts/capture-eval-snapshots harvests it for the eval set.
import { expect, test } from '../../../reactlens/fixtures';

test('pagination renders the last partial page', async ({ page }) => {
  await page.goto('/eval/case-005?total=11&pageSize=5');
  await expect(page.getByTestId('pagination')).toBeVisible();
  // The bug: only 2 buttons render, so page-3 never appears. Test fails
  // by design — we want the failure so the agent diagnoses it.
  await expect(page.getByTestId('page-3')).toBeVisible({ timeout: 1500 });
});
