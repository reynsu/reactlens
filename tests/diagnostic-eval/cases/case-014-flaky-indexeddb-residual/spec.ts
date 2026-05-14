import { expect, test } from '@playwright/test';

test('first-time visitor sees the onboarding card', async ({ page }) => {
  await page.goto('/onboarding');
  await expect(page.getByTestId('onboarding-card')).toBeVisible();
});
