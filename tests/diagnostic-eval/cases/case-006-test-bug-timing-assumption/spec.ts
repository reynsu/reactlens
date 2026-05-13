import { expect, test } from '@playwright/test';

test('user list shows ada', async ({ page }) => {
  await page.goto('/users');
  expect(await page.getByTestId('user-ada').isVisible()).toBe(true);
});
