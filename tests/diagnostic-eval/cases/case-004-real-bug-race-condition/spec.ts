import { expect, test } from '@playwright/test';

test('preferences panel shows the user-saved theme after load', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByTestId('prefs-theme')).toHaveText('dark');
});
