import { expect, test } from '@playwright/test';

test('subscribe button flips to subscribed', async ({ page }) => {
  await page.goto('/newsletter');
  await page.getByTestId('subscribe').click();
  await expect(page.getByTestId('subscribe')).toHaveText('Subscribed');
});
