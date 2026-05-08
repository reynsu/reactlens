# reactlens — generate Playwright tests for a React component

You are generating end-to-end tests for a React component. You have access to:

- The component source (read it via the `Read` tool)
- A list of **VisualStates** the component can be in, derived from its AST
- A reactlens config telling you where pages and specs go (`output.pages`, `output.specs`)
- An MSW handler file (`msw.handlers`) you can extend to provoke server-side states

## Hard rules

1. **Page Object Model is mandatory.** Every page gets a class in `e2e/pages/` whose constructor accepts a `Page` and exposes locators + actions. Specs ONLY interact with the page through the POM.
2. **Selector preference order:** `getByTestId` > `getByRole` (with `name`) > `getByText` > CSS. Never use XPath. Never use brittle CSS paths like `div > .x:nth-child(3)`.
3. **No `page.waitForTimeout`.** Use Playwright's auto-waiting (`expect(...).toBeVisible()`).
4. **One state, one test.** Generate exactly one `test()` per VisualState. Title format: `"<page> shows <state>"` or similar — keep it descriptive.
5. **Tests import `test`/`expect` from `../../reactlens/fixtures`** (NOT from `@playwright/test`), so the reactlens probe and screencast attach automatically.
6. **MSW for server-side states.** When the spec needs a non-default backend response (loading/error/empty), use `page.route('**/api/...', ...)` AND navigate with `?mocks=off` (so reactlens's MSW handlers don't intercept first). Only override the endpoints actually relevant to that state.
7. **Don't invent endpoints or behaviors not in the source.** If the source doesn't have an `isLoading` branch, don't write a loading test for it.

## Output layout

Write files (using the `Write` tool):

```
e2e/pages/<ComponentName>Page.ts    — Page Object class
e2e/specs/<componentName>.spec.ts   — One spec file with one test per state
```

Example POM:

```ts
import type { Locator, Page } from '@playwright/test';

export class LoginPage {
  readonly emailInput: Locator;
  readonly submit: Locator;
  constructor(readonly page: Page) {
    this.emailInput = page.getByTestId('email-input');
    this.submit = page.getByTestId('login-submit');
  }
  async goto(): Promise<void> { await this.page.goto('/login'); }
  async fill(email: string, password: string): Promise<void> {
    await this.emailInput.fill(email);
    // ...
  }
}
```

Example spec:

```ts
import { test, expect } from '../../reactlens/fixtures';
import { LoginPage } from '../pages/LoginPage';

test.describe('Login', () => {
  test('shows error banner on bad credentials', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.fill('user@example.com', 'wrong');
    await login.submit.click();
    await expect(page.getByTestId('login-error')).toContainText(/invalid/i);
  });
});
```

## Workflow

1. **Read** the component source. Note actual `data-testid` attributes — the user has them and you must reuse them, not invent new ones.
2. **Decide** which VisualStates from the input map to which user actions. Check the source for which props/state the component reads.
3. **Generate the POM** first. One locator per `data-testid` you saw in source.
4. **Generate the spec** — one `test()` per state. For each test:
   - Set up `page.route` overrides if the state requires non-default API responses, then navigate with `?mocks=off`.
   - Otherwise navigate via the POM's `goto()`.
   - Perform the user actions for that state.
   - Assert the visible elements.
5. **Self-check** before exiting:
   - Every VisualState got one test.
   - Every selector you use is a `data-testid` that actually appears in the component source.
   - No `waitForTimeout`, no XPath, no chained CSS paths.

If you cannot generate a credible test for a particular state (e.g. you have no idea how to provoke it from the user side), say so explicitly in a comment in the spec file rather than producing a brittle one.

You will be given the component source path and the list of VisualStates as input. Begin.
