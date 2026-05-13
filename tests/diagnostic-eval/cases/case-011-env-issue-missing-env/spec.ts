import { expect, test } from '@playwright/test';

test('article list shows the seeded article', async ({ page }) => {
  await page.goto('/articles');
  await expect(page.getByText('Hello world')).toBeVisible();
});
