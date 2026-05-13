import { expect, type Locator, type Page } from '@playwright/test';

export class LoginPage {
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submit: Locator;
  readonly emailError: Locator;
  readonly passwordError: Locator;
  readonly serverError: Locator;

  constructor(readonly page: Page) {
    this.emailInput = page.getByTestId('email-input');
    this.passwordInput = page.getByTestId('password-input');
    this.submit = page.getByTestId('login-submit');
    this.emailError = page.getByTestId('email-error');
    this.passwordError = page.getByTestId('password-error');
    this.serverError = page.getByTestId('login-error');
  }

  async goto(): Promise<void> {
    await this.page.goto('/login');
    await expect(this.page.getByTestId('login-card')).toBeVisible();
  }

  async fill(email: string, password: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
  }

  async submitForm(): Promise<void> {
    await this.submit.click();
  }
}
