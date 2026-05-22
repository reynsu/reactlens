import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('Navigating to an invoice shows its body', async ({ page }) => {
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click()
  await page.getByRole('link', { name: 'Invoices', exact: true }).click()
  await page.getByRole('link', { name: /#1 - Invoice 1/ }).click()
  await expect(page.getByText('Body of invoice 1')).toBeVisible()
})
