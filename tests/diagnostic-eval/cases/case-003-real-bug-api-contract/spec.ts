import { expect, test } from '@playwright/test';

test('welcome banner shows the user display name', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('welcome-banner')).toHaveText(/Welcome, Ada!/);
});
