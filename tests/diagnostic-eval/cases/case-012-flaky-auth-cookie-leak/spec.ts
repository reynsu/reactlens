import { expect, test } from '@playwright/test';

test('landing shows anonymous welcome on a fresh visit', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('landing-sign-in')).toBeVisible();
});
