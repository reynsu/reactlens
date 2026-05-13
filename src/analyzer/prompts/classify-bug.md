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

**Definition:** non-deterministic failure unrelated to a code change. Includes ordering failures — failures that depend on what *other* specs did, not on the code or this spec.

**Strongest signals:**
- Failure mode is "waiting for X, timed out". X exists in source.
- Neither file has changed recently.
- Multiple consecutive runs against unchanged code show different outcomes.
- Snapshot shows the component DID render the asserted state — just after the timeout.
- Snapshot or runtime evidence shows state coming from **outside this spec's own actions** — eg `localStorage` populated with keys this spec never writes, an authenticated session this spec didn't sign in for, a database row another spec inserted. Often paired with an `error.txt` / trace line that says the failure correlates with run order ("passes in isolation, fails after spec X").

Use sparingly. "I don't know" is more often a `low`-confidence other-classification than `flaky`.

**Examples:**

> Spec: clicks submit, asserts redirect within 5s. Sometimes the redirect takes 6s due to a queue.
> → `flaky`, `medium`. Suggested fix: increase timeout for this spec, or add a deterministic gate (`waitForResponse`).

> Spec: `await page.goto('/cart'); await expect(getByTestId('cart-empty')).toBeVisible()`.
> Component snapshot: `hooks.state = [{id: 'abc'}]` (items array populated).
> error.txt: "Browser storage at time of failure: localStorage = {cart: '[{id:abc}]'}. Failure correlates with running after 'adds item to cart' spec. No spec or component change in 60 days."
> Component on disk reads from localStorage on mount; spec doesn't call `localStorage.clear()`.
> → `flaky` (ordering / state leak), `high`. The localStorage state did not come from this spec's actions — it leaked from another spec running first in the same worker. Even though the spec is also structurally fragile, the proximate cause is the order.
> Suggested fix: add `test.beforeEach(({page}) => page.evaluate(() => localStorage.clear()))` to this spec or the file's parent describe. Optionally file an issue against the spec that wrote the leaked data.

## Disambiguating `test-bug` vs `flaky` (ordering) when both fit

Some failures look structurally like test-bugs (the spec doesn't `beforeEach(localStorage.clear())`, doesn't reset a global, doesn't re-seed the database) while *also* having runtime evidence of an ordering issue (snapshot shows state this spec never wrote; trace says the failure correlates with another spec running first). This is the most common false-confidence trap in the eval set, so be explicit.

**Prefer `flaky` when:**
- The component snapshot at failure contains state values this spec's own actions cannot explain. Eg `hooks.state = [{id:'abc'}]` but the spec never wrote that id; `props.user.email = '...'` but the spec didn't log anyone in.
- The error trace or `error.txt` mentions the failure correlates with run order ("passes in isolation, fails after X"), failure rate is below 100%, or no recent changes to either file.
- The same spec passes when run alone (a strong tell — if you only see "fails in suite, passes alone" in the trace, lean `flaky`).

**Prefer `test-bug` when:**
- The state the spec depends on is conventionally set up by the framework (eg `storageState`, fixtures) and *this* spec is the one that should have configured it.
- The spec asserts a `data-testid` / text / route that doesn't exist anywhere in the source — the bug is in the assertion itself, not in the runtime state.
- Multiple specs in the same file fail the same way regardless of order.

The structural shortcoming (no `beforeEach(clear)`) is real and worth fixing in both cases. But if the runtime evidence shows the leak came from *elsewhere*, that's the proximate cause — and the proximate cause is what `flaky` captures. Don't punish the symptom-bearing spec for being the one that exposed the order-dependency.

Confidence in this disambiguation should track the directness of the evidence: snapshot hook values + an error.txt that names the suspected upstream spec is `high`; just "no recent commits + spec doesn't clear state" is `medium`.

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
