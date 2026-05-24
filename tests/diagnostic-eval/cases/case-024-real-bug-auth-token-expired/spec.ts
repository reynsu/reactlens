import { expect, test } from '@playwright/test';

// Setup primes localStorage with a token that is structurally valid but
// already expired. The product is supposed to detect this and show a
// re-login prompt (a different UI than "Hello, Guest"). The spec
// asserts the user's name appears — which would be true IF token
// refresh worked OR if the expired-state surfaced an error properly.
// The bug swallows the error and the page renders the "no session"
// branch.
test('greeting shows the user name when an expired-but-refreshable session is present', async ({ page }) => {
  await page.addInitScript(() => {
    // Token expired one hour ago. A correctly-implemented auth would
    // either auto-refresh and proceed, or surface the expiry so the UI
    // can prompt re-login. Today the catch block swallows it.
    const expired = { exp: Date.now() - 60 * 60 * 1000, sub: 'u-alice', name: 'Alice' };
    window.localStorage.setItem('token', JSON.stringify(expired));
  });
  await page.goto('/');
  await expect(page.getByTestId('greeting')).toHaveText('Hello, Alice!');
});
