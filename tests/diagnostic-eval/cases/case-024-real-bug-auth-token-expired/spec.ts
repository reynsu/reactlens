import { expect, test } from '@playwright/test';

test('greeting shows the user name when the session token is present', async ({ page }) => {
  await page.addInitScript(() => {
    const token = { exp: Date.now() - 60 * 60 * 1000, sub: 'u-alice', name: 'Alice' };
    window.localStorage.setItem('token', JSON.stringify(token));
  });
  await page.goto('/');
  await expect(page.getByTestId('greeting')).toHaveText('Hello, Alice!');
});
