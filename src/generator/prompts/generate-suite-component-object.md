# reactlens — generate Component-Object Pattern tests for a React component

You are generating end-to-end tests for a React component using the **Component-Object Pattern** (CO). Unlike POM specs, CO specs assert directly on React component props/state via the `Component()` runtime helper — making the moat visible at spec-authoring time.

You have access to:

- The component source (read it via the `Read` tool)
- A list of **VisualStates** the component can be in, derived from its AST
- A reactlens config telling you where specs go (`output.specs`)

## Hard rules

1. **Component-Object Pattern is mandatory (when `pattern: 'component-object'`).** This prompt runs specifically when the project's `reactlens.config.ts` sets `pattern: 'component-object'`. Specs MUST assert on component props via the `Component()` helper from `'@reynsu/reactlens/component-object'`. There is NO separate Page Object class — the spec is self-contained.
2. **DOM assertions are still allowed and encouraged** for things that aren't visible in props (e.g. "the error banner is on screen"). The differentiator is that prop-level state (e.g. `isPending`, `serverError`) gets asserted at the component level, not by inferring from the rendered button text.
3. **Use `await expect.poll(() => Component('X').props.foo, { timeout: 5_000 }).toBe(...)`** for component-level assertions. NEVER use `await expect(Component('X').props.foo).toBe(...)` directly — the snapshot may not have arrived yet, the test will flake. Polled-promise composition is locked in `docs/design/snapshot-accessor.md`.
4. **Selector preference order for DOM (unchanged):** `getByTestId` > `getByRole` (with `name`) > `getByText` > CSS. Never XPath. Never brittle nth-child chains.
5. **No `page.waitForTimeout`.** Playwright auto-wait + `expect.poll` for component state.
6. **One state, one test.** One `test()` per VisualState. Title format: `"<page> shows <state>"` or similar.
7. **Tests import `test`, `expect`, and `Component` from `../../reactlens/fixtures`** (NOT from `@playwright/test` and NOT directly from `@reynsu/reactlens/component-object`). The reactlens fixture binds the testId and wires the live snapshot stream; importing through the fixture is the contract.
8. **`page.route` for server-side states.** Same convention as the POM prompt — use `page.route('**/api/...', (route) => route.fulfill({ ... }))` overrides for non-default backend responses. There is no MSW layer.
9. **Don't invent props or hooks that aren't in the source.** Read the source first. If a component has no `isPending` prop, don't write an assertion against it. CO specs assert on what the AST analysis already found.
10. **CO specs require reactlens at runtime.** This is intentional. Add a top-of-file comment noting it: `// Requires reactlens at runtime — uses Component() helper.`

## What `Component()` gives you

```ts
import { Component } from '../../reactlens/fixtures';

// Component is addressed by React display name (the component function/class name).
// Reads return the latest captured prop value or throw a typed error:
//   ComponentNotMountedError       — component not in the latest snapshot
//   SnapshotStreamDisconnectedError — the WS that delivers snapshots is down
//
// Both errors have a `kind` discriminator and a locked message prefix.

await expect
  .poll(() => Component('LoginForm').props.isPending, { timeout: 5_000 })
  .toBe(false);
```

## Output layout

Write ONE file (using the `Write` tool):

```
e2e/specs/<componentName>.spec.ts   — One spec file with one test per state
```

There is NO `e2e/pages/<ComponentName>Page.ts` for CO specs — the spec is self-contained.

## Example spec

```ts
// Requires reactlens at runtime — uses Component() helper.
import { test, expect, Component } from '../../reactlens/fixtures';

test.describe('LoginPage', () => {
  test('login button is not pending after submit success', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('email-input').fill('user@example.com');
    await page.getByTestId('password-input').fill('password123');
    await page.getByTestId('login-submit').click();

    // Component-level assertion: the spec reads the actual React state.
    await expect
      .poll(() => Component('LoginPage').props.submitting, { timeout: 5_000 })
      .toBe(false);

    // DOM assertion still useful for visible side-effects.
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('serverError prop populates when credentials are bad', async ({ page }) => {
    await page.route('**/api/login', (route) =>
      route.fulfill({ status: 401, body: JSON.stringify({ message: 'invalid credentials' }) }),
    );
    await page.goto('/login');
    await page.getByTestId('email-input').fill('user@example.com');
    await page.getByTestId('password-input').fill('wrong');
    await page.getByTestId('login-submit').click();

    await expect
      .poll(() => Component('LoginPage').props.serverError, { timeout: 5_000 })
      .toMatch(/invalid credentials/i);
  });
});
```

## Workflow

1. **Read** the component source. Identify which props/state are interesting to assert on per VisualState.
2. **For each VisualState**, decide which props (and how to provoke them) are the assertion target.
3. **Generate the spec** — one `test()` per state. For each:
   - Set up `page.route` overrides if the state requires non-default API responses, then navigate.
   - Perform the user actions.
   - Assert via `expect.poll(() => Component('<Name>').props.<key>)` on the relevant prop. Combine with DOM assertions where helpful.
4. **Self-check before exit:**
   - Every VisualState got one test.
   - Every `Component('<Name>')` call references a component name that actually appears in the source.
   - Every `.props.<key>` read references a prop the AST analysis confirmed exists (don't read invented props).
   - `expect.poll` is used for every component-level read.
   - Top-of-file comment is present.

If you cannot generate a credible CO test for a particular state (e.g. the state isn't reflected in any prop, only in DOM), say so explicitly in a comment and either fall back to a DOM-only test or skip that state — don't invent a fake prop.

You will be given the component source path and the list of VisualStates as input. Begin.
