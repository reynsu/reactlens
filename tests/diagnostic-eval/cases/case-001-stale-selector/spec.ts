// Failing spec: data-testid does not exist in the component source.
// The probe snapshot will show the page rendered correctly with the canonical
// 'login-error' element — the spec is the broken artifact.
import { expect, test } from '@playwright/test';

test('login error', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('email-input').fill('user@example.com');
  await page.getByTestId('password-input').fill('wrong');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('login-fail')).toBeVisible();
});
