import { expect, type Locator, type Page } from '@playwright/test';

export class CheckoutPage {
  readonly card: Locator;
  readonly cvv: Locator;
  readonly amount: Locator;
  readonly submit: Locator;
  readonly cardError: Locator;
  readonly cvvError: Locator;
  readonly amountError: Locator;
  readonly declined: Locator;
  readonly networkError: Locator;
  readonly success: Locator;

  constructor(readonly page: Page) {
    this.card = page.getByTestId('card-input');
    this.cvv = page.getByTestId('cvv-input');
    this.amount = page.getByTestId('amount-input');
    this.submit = page.getByTestId('checkout-submit');
    this.cardError = page.getByTestId('card-error');
    this.cvvError = page.getByTestId('cvv-error');
    this.amountError = page.getByTestId('amount-error');
    this.declined = page.getByTestId('checkout-declined');
    this.networkError = page.getByTestId('checkout-network-error');
    this.success = page.getByTestId('checkout-success');
  }

  async goto(opts: { mocks?: 'on' | 'off' } = {}): Promise<void> {
    const url = opts.mocks === 'off' ? '/checkout?mocks=off' : '/checkout';
    await this.page.goto(url);
    await expect(this.page.getByTestId('checkout-card')).toBeVisible();
  }

  async fill(card: string, cvv: string, amount: string): Promise<void> {
    await this.card.fill(card);
    await this.cvv.fill(cvv);
    await this.amount.fill(amount);
  }

  async pay(): Promise<void> {
    await this.submit.click();
  }
}
