import type { Page, Locator } from '@playwright/test';

export class LoginPage {
  readonly page: Page;
  readonly card: Locator;
  readonly email: Locator;
  readonly password: Locator;
  readonly submit: Locator;
  readonly serverError: Locator;
  readonly emailError: Locator;
  readonly passwordError: Locator;

  constructor(page: Page) {
    this.page = page;
    this.card = page.getByTestId('login-card');
    this.email = page.getByTestId('email-input');
    this.password = page.getByTestId('password-input');
    this.submit = page.getByTestId('login-submit');
    this.serverError = page.getByTestId('login-error');
    this.emailError = page.getByTestId('email-error');
    this.passwordError = page.getByTestId('password-error');
  }

  async goto(): Promise<void> {
    await this.page.goto('/login');
    await this.card.waitFor();
  }

  async fill(email: string, password: string): Promise<void> {
    await this.email.fill(email);
    await this.password.fill(password);
  }

  async submitForm(): Promise<void> {
    await this.submit.click();
  }
}
