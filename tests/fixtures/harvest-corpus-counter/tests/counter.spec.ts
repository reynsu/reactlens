import { expect, test } from '@playwright/test';

test('counter increments to 1 on click', async ({ page }) => {
  await page.goto('/counter');
  await page.getByTestId('increment').click();
  await expect(page.getByTestId('count')).toHaveText('1');
});
