import { expect, test } from '@playwright/test';

test('login error', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('email-input').fill('user@example.com');
  await page.getByTestId('password-input').fill('wrong');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('login-fail')).toBeVisible();
});
