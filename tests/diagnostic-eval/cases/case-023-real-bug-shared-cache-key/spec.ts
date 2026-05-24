import { expect, test } from '@playwright/test';

// Two counters mounted side-by-side. Incrementing Counter A five times
// must NOT change Counter B — independent UI elements with independent
// state. Spec is correct (this is a basic isolation contract); the bug
// is in the hook's cache key (shares state across instances).
test('two counters with different ids keep independent counts', async ({ page }) => {
  await page.goto('/counters');
  for (let i = 0; i < 5; i++) {
    await page.getByTestId('increment-a').click();
  }
  await expect(page.getByTestId('count-a')).toHaveText('5');
  await expect(page.getByTestId('count-b')).toHaveText('0');
});
