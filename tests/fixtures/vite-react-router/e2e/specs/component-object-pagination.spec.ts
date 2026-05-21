// Requires reactlens at runtime — uses Component() helper.
//
// Hand-written Component-Object Pattern spec used by the integration test
// to verify the full pipeline (fixture re-export → bindTestId →
// connectAccessor → Component(name).props.<x>) works against a live
// React render. The generator-produced equivalent is validated by the
// prompt-resolver unit tests; running `reactlens generate
// --pattern=component-object` end-to-end is gated by agent-cost env.
//
// Targets <Pagination total={11} pageSize={5} /> rendered at
// /eval/case-005 — deterministic, prop-rich, already in the fixture.
import { test, expect, Component, ComponentNotMountedError } from '../../reactlens/fixtures';

test.describe('Component-Object: Pagination', () => {
  test('reads the `total` and `pageSize` props from the rendered component', async ({ page }) => {
    await page.goto('/eval/case-005');
    await expect(page.getByTestId('pagination')).toBeVisible();

    await expect
      .poll(() => Component('Pagination').props.total, { timeout: 5_000 })
      .toBe(11);
    await expect
      .poll(() => Component('Pagination').props.pageSize, { timeout: 5_000 })
      .toBe(5);
  });

  test('throws ComponentNotMountedError for an unknown display name', async ({ page }) => {
    await page.goto('/eval/case-005');
    await expect(page.getByTestId('pagination')).toBeVisible();
    await expect
      .poll(() => Component('Pagination').props.total, { timeout: 5_000 })
      .toBe(11);

    let caught: unknown = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      Component('DefinitelyNotMounted').props.anything;
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ComponentNotMountedError);
    expect((caught as ComponentNotMountedError).componentName).toBe('DefinitelyNotMounted');
  });
});
