// Probe overhead benchmark. Drives a known render-heavy scenario (fill the
// checkout form across many fields + submit), then reads the React Profiler
// timings (`actualDuration` per commit) that fixture/main.tsx records into
// window.__rlProfile__. Emits stats on stdout via console.log so an external
// harness can compare probe-on vs probe-off runs.
//
// Run modes:
//   probe ON:  REACTLENS_USE_CLAUDE_CODE never matters; only REACTLENS_WS_URL
//              must be set, which `reactlens run` does automatically.
//   probe OFF: run via `npx playwright test` directly; the fixture skips
//              probe injection when REACTLENS_WS_URL is unset (see
//              reactlens/fixtures.ts:140-144).
import { expect, test } from '../../../reactlens/fixtures';

type ProfileEntry = { phase: string; actualDuration: number; baseDuration: number; commitTime: number };

function summarize(entries: ProfileEntry[]): {
  n: number;
  mean: number;
  median: number;
  p95: number;
  max: number;
  sum: number;
} {
  if (entries.length === 0) return { n: 0, mean: 0, median: 0, p95: 0, max: 0, sum: 0 };
  const durs = entries.map((e) => e.actualDuration).sort((a, b) => a - b);
  const sum = durs.reduce((a, b) => a + b, 0);
  const idx = (p: number): number => Math.min(durs.length - 1, Math.floor((durs.length * p) / 100));
  return {
    n: durs.length,
    mean: sum / durs.length,
    median: durs[idx(50)] ?? 0,
    p95: durs[idx(95)] ?? 0,
    max: durs[durs.length - 1] ?? 0,
    sum,
  };
}

test('probe overhead benchmark — checkout interactions', async ({ page }) => {
  await page.goto('/checkout');
  await page.waitForLoadState('domcontentloaded');

  // Reset the profile buffer just before the scenario so we measure only the
  // interactive renders, not initial mount + MSW startup.
  await page.evaluate(() => {
    window.__rlProfile__ = [];
  });

  const card = page.getByTestId('card-input');
  const cvv = page.getByTestId('cvv-input');
  const amount = page.getByTestId('amount-input');

  // Drive a deterministic number of render-causing interactions. Each fill is
  // multiple keystrokes; each press triggers a controlled-input re-render.
  await card.fill('4242424242424242');
  await cvv.fill('123');
  await amount.fill('99.99');
  await page.getByTestId('checkout-submit').click();

  await expect(
    page
      .getByTestId('checkout-success')
      .or(page.getByTestId('checkout-declined'))
      .or(page.getByTestId('checkout-network-error')),
  ).toBeVisible({ timeout: 5000 });

  // Give post-commit work (probe serialization) a chance to settle so we
  // include any deferred cost in the measurement window.
  await page.waitForTimeout(200);

  const entries: ProfileEntry[] = await page.evaluate(() => window.__rlProfile__ ?? []);
  const probeActive = await page.evaluate(() => '__REACTLENS__' in window);
  const stats = summarize(entries);

  // Single line of structured output the external harness greps for.
  console.log(
    `PROBE_BENCHMARK ${JSON.stringify({
      probeActive,
      ...stats,
    })}`,
  );

  // Sanity gate — if we recorded nothing, the Profiler instrumentation is
  // broken and the harness comparison would be meaningless.
  expect(stats.n).toBeGreaterThan(0);
});
