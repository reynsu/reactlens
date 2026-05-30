import { expect, test } from '@playwright/test';

test('two counters with different ids keep independent counts', async ({ page }) => {
  await page.goto('/counters');
  for (let i = 0; i < 5; i++) {
    await page.getByTestId('increment-a').click();
  }
  await expect(page.getByTestId('count-a')).toHaveText('5');
  await expect(page.getByTestId('count-b')).toHaveText('0');
});
