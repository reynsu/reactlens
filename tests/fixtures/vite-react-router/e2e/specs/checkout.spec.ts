import { expect, test } from '../../reactlens/fixtures';
import { CheckoutPage } from '../pages/CheckoutPage';

test.describe('Checkout', () => {
  test('shows per-field validation errors on empty/invalid input', async ({ page }) => {
    const checkout = new CheckoutPage(page);
    await checkout.goto();
    await checkout.fill('', '', '0');
    await checkout.pay();
    await expect(checkout.cardError).toContainText(/16 digits/);
    await expect(checkout.cvvError).toContainText(/3 or 4/);
    await expect(checkout.amountError).toContainText(/greater than 0/);
  });

  test('shows declined banner for cards starting with 4000', async ({ page }) => {
    const checkout = new CheckoutPage(page);
    await checkout.goto();
    await checkout.fill('4000123412341234', '123', '50');
    await checkout.pay();
    await expect(checkout.declined).toBeVisible();
  });

  test('shows network-error banner when the API rejects with non-402', async ({ page }) => {
    await page.route('**/api/checkout', (route) =>
      route.fulfill({ status: 500, body: 'boom' }),
    );
    const checkout = new CheckoutPage(page);
    await checkout.goto({ mocks: 'off' });
    await checkout.fill('1234123412341234', '123', '25');
    await checkout.pay();
    await expect(checkout.networkError).toBeVisible();
  });

  test('shows success banner with confirmation id on accepted payment', async ({ page }) => {
    const checkout = new CheckoutPage(page);
    await checkout.goto();
    await checkout.fill('1234123412341234', '123', '25');
    await checkout.pay();
    await expect(checkout.success).toBeVisible();
    await expect(checkout.success).toContainText(/CONF-/);
  });
});
