import { expect, test } from '@playwright/test';

test('signup form accepts valid credentials and submits', async ({ page }) => {
  await page.goto('/signup');
  await page.getByTestId('email').fill('ada@example.com');
  await page.getByTestId('password').fill('correct-horse-battery-staple');
  await page.getByTestId('submit').click();
  await expect(page).toHaveURL(/\/welcome/);
});
