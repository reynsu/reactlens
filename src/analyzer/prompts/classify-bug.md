# reactlens — bug classification rubric

This document defines, with examples, when to choose each classification. Diagnosis agent: consult this when in doubt. Calibration is measured against the eval set in `tests/diagnostic-eval/cases/`.

## `real-bug`

**Definition:** the code regressed and the spec is correctly asserting the prior, correct behavior.

**Strongest signals:**
- Component file has a recent commit (today, this week) and the spec hasn't changed in much longer.
- The component snapshot at failure shows props/state inconsistent with the source's invariants — eg the source says `if (data.length === 0) return Empty` but the snapshot shows `data.length === 0` AND the rendered subtree doesn't include `<Empty />`.
- The snapshot shows a thrown error in a render path the spec was exercising.

**Examples:**

> Spec: "checkout shows declined banner for cards starting with 4000".
> Component snapshot: status='success' (not 'declined') after submitting a 4000-card.
> Component diff (last commit): the developer changed the API check from `startsWith('4000')` to `startsWith('5000')`.
> → `real-bug`, `high` confidence. Patch: revert the prefix check.

> Spec: "dashboard shows empty state when there are no orders".
> Component snapshot: orders=[] but `<empty />` is not in the tree.
> Component: the developer added an `early-return null` above the empty check that fires unconditionally.
> → `real-bug`, `high`. Patch: remove the early return.

## `test-bug`

**Definition:** the code is correct; the spec is stale, makes a wrong assumption, or asserts something the component doesn't do.

**Strongest signals:**
- Spec file has a recent commit and the component hasn't changed.
- The spec asserts a `data-testid` or `text` that doesn't exist anywhere in the component source.
- The spec assumes a route, a label, or an order-of-operations that contradicts the source.
- The snapshot shows the component is in the state the test wanted — but the assertion is wrong.

**Examples:**

> Spec: `await expect(page.getByTestId('checkout-fail')).toBeVisible()`.
> Component source: there is `data-testid="checkout-network-error"` and `data-testid="checkout-declined"` but no `checkout-fail`.
> → `test-bug`, `high`. Patch: change the selector to whichever testid was intended.

> Spec was copy-pasted from another spec and still asserts the wrong page title.
> → `test-bug`, `high`. Patch: update the title.

## `flaky`

**Definition:** non-deterministic failure unrelated to a code change.

**Strongest signals:**
- Failure mode is "waiting for X, timed out". X exists in source.
- Neither file has changed recently.
- Multiple consecutive runs against unchanged code show different outcomes.
- Snapshot shows the component DID render the asserted state — just after the timeout.

Use sparingly. "I don't know" is more often a `low`-confidence other-classification than `flaky`.

**Examples:**

> Spec: clicks submit, asserts redirect within 5s. Sometimes the redirect takes 6s due to a queue.
> → `flaky`, `medium`. Suggested fix: increase timeout for this spec, or add a deterministic gate (`waitForResponse`).

## `env-issue`

**Definition:** the failure is infrastructure, not application logic.

**Strongest signals:**
- Error mentions: "browserType.launch", "Executable doesn't exist", "EADDRINUSE", "ECONNREFUSED", "missing env var".
- All tests fail (not just one).
- The component snapshot is empty / probe never connected.

**Examples:**

> Error: `Executable doesn't exist at .../chrome-headless-shell`.
> → `env-issue`, `high`. Patch: `pnpm exec playwright install chromium`.

> Error: `connect ECONNREFUSED 127.0.0.1:5173` on every test.
> → `env-issue`, `high`. The dev server didn't start.

## When you genuinely can't tell

Choose the classification you'd guess at, drop confidence to `low`, and in `suggestedFix` say what evidence would let you upgrade.
