// Smoke spec for the Next.js App Router fixture. Proves the full reactlens
// pipeline works against Next: probe injection, post-hydration capture,
// streaming reporter, dashboard server. Same testids as the Vite fixture
// so the spec is structurally identical.
import { expect, test } from '../../reactlens/fixtures';
import { LoginPage } from '../pages/LoginPage';

test.describe('Login (next-app-router)', () => {
  test('shows field validation errors when fields are empty or invalid', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.fill('not-an-email', 'short');
    await login.submitForm();
    await expect(login.emailError).toContainText(/valid email/i);
    await expect(login.passwordError).toContainText(/at least 8/i);
  });

  test('shows server error banner on bad credentials', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.fill('wrong@example.com', 'wrongpass');
    await login.submitForm();
    await expect(login.serverError).toContainText(/invalid credentials/i);
  });

  test('navigates to /dashboard on success', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.fill('user@example.com', 'password123');
    await login.submitForm();
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
