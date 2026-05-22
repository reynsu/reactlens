// Component-Object Pattern spec (v0.3 slice 6). Reads the `total` and
// `pageSize` props from the rendered <Pagination /> via the Component()
// helper. The first assertion (props.total === 11) succeeds — the prop
// reaches the component fine — but the spec also expects the rendered
// DOM to show 2 page buttons (Math.floor(11/5) === 2). The component's
// inverted division collapses that to 0 buttons, so the toBeVisible
// assertion on page-1 fails.
//
// Why this is a CO-shaped real-bug case:
//   - The CO assertion (props.total === 11) PASSES, proving the prop
//     was wired correctly and the diagnosis agent sees that signal.
//   - The DOM assertion FAILS, and the gap between "prop is right" and
//     "DOM is wrong" is the exact diagnosis-relevant evidence the
//     component snapshot makes legible.
//   - Classification: `real-bug` with high confidence. Spec is correct.
import { test, expect, Component } from '../../reactlens/fixtures';

test('Pagination renders one button per page based on total/pageSize', async ({ page }) => {
  await page.goto('/eval/case-005');
  await expect(page.getByTestId('pagination')).toBeVisible();

  // CO assertion: the component received total=11. This passes — the prop
  // is being threaded correctly.
  await expect
    .poll(() => Component('Pagination').props.total, { timeout: 5_000 })
    .toBe(11);

  // DOM assertion: with total=11 and pageSize=5, we expect 2 page buttons.
  // Fails on the planted bug (inverted division → 0 buttons rendered).
  await expect(page.getByTestId('page-1')).toBeVisible();
});
