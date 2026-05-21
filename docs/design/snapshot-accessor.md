# SnapshotAccessor — runtime API for the Component-Object Pattern

**Status:** accepted (HITL review — see [issue #10](https://github.com/reynsu/reactlens/issues/10)).
**Date:** 2026-05-21.
**Slice:** v0.3 #5 (HITL spike); unblocks v0.3 #6 ([issue #13](https://github.com/reynsu/reactlens/issues/13)).
**Related:** [ADR-0006 — Component-Object Pattern as opt-in](../adr/0006-component-object-pattern-as-opt-in.md), [ADR-0008 — Moat is defined by serving diagnosis](../adr/0008-moat-is-defined-by-serving-diagnosis.md).

---

## What this document is

A design decision, not a spec, not an ADR. The Component-Object Pattern (ADR-0006) hinges on a runtime API that a spec can use to assert on component props, state, and hooks — e.g. `await expect.poll(() => Component('LoginForm').props.isPending).toBe(false)`. ADR-0006 deliberately deferred the shape of this API: "the right place to capture it is a v0.3 design note, not this ADR." This is that note.

It records:

1. The four design questions the slice-5 HITL gate had to answer.
2. The alternatives considered for each, with reasoning.
3. The chosen direction, and the error-shape contract slice 6 will implement against.
4. What the throwaway prototype actually surfaced when run on `tests/fixtures/vite-react-router/`.
5. The non-decisions (questions deliberately punted to slice 6 because the spike didn't have enough information to settle them).

The prototype itself is intentionally not merged. Its code lived at `tests/fixtures/vite-react-router/reactlens/snapshot-accessor.ts` and `tests/fixtures/vite-react-router/e2e/specs/eval/snapshot-accessor-spike.spec.ts` during the spike, and was deleted before this commit. Re-recreating it from this doc is a deliberate productive exercise for whoever picks up slice 6 — implementing the API for real, with tests, is half of slice 6's scope.

---

## The four questions

### Q1 — Addressing: how does a spec name a component?

| Alternative | Pros | Cons | Verdict |
|---|---|---|---|
| **Display name** (`Component('LoginForm')`) | Matches the `name` field the probe already emits. Zero extra wire-protocol work. Readable. | Two `<LoginForm />` mounted simultaneously → ambiguous. Minified production builds drop displayName. | **CHOSEN.** |
| `data-testid` (`Component({ testId: 'login-form' })`) | Unique by construction. Reuses the `testIdIndex` (P9) the probe already ships. Aligned with how Playwright addresses DOM. | Forces users to thread test IDs into React components, not just DOM. Reads awkward: "I want to assert on the *component*, not the element" — using a DOM-shaped key blurs that. | Rejected — moves us back toward DOM-shaped APIs. |
| Component import identity (`Component(LoginForm)`) | Type-safe end-to-end. Refactor-rename works through TS. | Probe would need to emit a stable cross-bundle identity per fiber type (source-location hash, not fiber-type reference). Heavier work in the bridge. HMR-fragile. | Rejected for v0.3 — revisit when Vite/Next/TanStack source-map handling is unified. |

**Why display-name wins for v0.3.** The probe already exposes the displayName (see `ComponentNode.name` in CLAUDE.md §9). Slice 6 ships if it accepts the existing wire protocol unchanged. Ambiguity is a real problem we explicitly punt to a `.where()` / `.nth()` chain (see "Non-decisions" below).

**Production-build edge case.** Minification strips displayNames; tests run in dev mode by default (Vite dev server, Next dev, etc.) so this is not a v0.3 blocker. If a user runs E2E against a production build, the accessor will throw `ComponentNotMountedError` for components addressable only by their minified single-letter name, and the error message will explicitly hint at this — see Q4.

### Q2 — Composition: how does the API meet Playwright's `expect()`?

| Alternative | Pros | Cons | Verdict |
|---|---|---|---|
| **Polled promise** (`await expect.poll(() => Component('X').props.y).toBe(z)`) | Reuses Playwright's native retry loop. Handles the snapshot-arrives-late race. Idiomatic for Playwright users. | Slightly verbose. | **CHOSEN.** |
| Direct promise (`await expect(Component('X').props.y).toBe(z)`) | Reads cleaner. | First snapshot may not have arrived → flake or hidden internal polling. Internal polling would hide the timeout knob from the test author. | Rejected. |
| Custom matcher (`await expect(Component('X')).toHaveProp('y', z)`) | Richer failure messages (`LoginForm.props.isPending was true, expected false; last snapshot at step 3`). | Multiplies surface — every assertion shape (prop/state/hook) becomes its own matcher. More prompt-engineering for the generator. | Rejected for v0.3 — revisit once we measure whether `expect.poll` failure messages are actually too thin. |

**Why polled-promise wins.** It's the unique answer to "how do you assert on something that may not have arrived yet?" without hiding that latency in the helper. Slice 6 will document the default poll timeout (Playwright default: 5 s) and recommend users override it for slower interactions.

**Empirical evidence from the spike.** The first `Component('Pagination', testInfo.testId).props.total` call right after `page.getByTestId('pagination')` became visible returned the right value within Playwright's first poll tick (the whole test ran in 414 ms — `await expect.poll(...).toBe(11)` resolves on iteration 1 or 2). Without polling this would have been a race: the DOM was already painted before the `component:snapshot` event arrived at the dashboard WS.

### Q3 — Subscription: how does the helper get the live stream from inside a Playwright fixture?

| Alternative | Pros | Cons | Verdict |
|---|---|---|---|
| **Fixture connects a WS client to the dashboard server** (`/ws/dashboard`) | One source of truth — same channel the dashboard frontend already consumes. Reuses `openFrameSocket` pattern from `templates/fixtures.ts`. Buffered ring of recent events on the server replays on connect, so a late-connecting helper still sees the latest. | Requires the dashboard server to be up. Specs run under `reactlens run --no-dashboard` would fail with a clear error. | **CHOSEN.** |
| Reporter-mediated IPC (custom Playwright reporter caches snapshots; helper reads via `process.send` / unix socket) | Zero extra network. | Breaks in Playwright worker mode — each worker is a separate process. IPC across worker boundaries is awkward and platform-specific. | Rejected. |
| Probe-mediated `window` global (probe writes latest tree to `window.__REACTLENS_LATEST__`; helper reads via `page.evaluate()`) | Simplest mechanically. No extra network. | Every lookup pays a CDP round-trip (~5–10 ms). For a spec with 50 polled asserts that's a 250–500 ms tax. No event history — only the latest snapshot is observable. | Rejected. |

**Why the WS client wins.** Reuses the channel the probe→server→dashboard pipeline already validates in `tests/integration/run-flow.test.ts`. The 500-event ring buffer on the dashboard server (see `src/dashboard/server.ts:131-145`) means a helper connecting one tick after `reactlens run` starts still receives the most recent snapshots, eliminating a startup race the IPC and `window`-global alternatives would have introduced.

**Operational implication for slice 6.** When the user opts in via `pattern: 'component-object'`, the runner MUST keep the dashboard server up even with `--no-dashboard` or `--ci` flags (or change those flags' semantics for COP specs to "no UI, but server stays up for the helper"). Slice 6 picks one. The error message when the server is unreachable must name the flag conflict, not just say "WS closed."

### Q4 — Error contract: what happens on unmounted component / WS disconnect?

| Alternative | Pros | Cons | Verdict |
|---|---|---|---|
| **Typed errors always** (`ComponentNotMountedError`, `SnapshotStreamDisconnectedError`) | Fail-loud. A spec that assumes a mounted component never silently reads stale data. Honors CLAUDE.md Principle 5 ("diagnosis is always actionable" → error message names the component and the cause). | Specs that want optional lookups must `try`/`catch`. | **CHOSEN.** |
| Last-known-value + warning log | Doesn't break specs on transient WS flake. | Silent-failure mode. A spec can pass on stale data without anyone noticing. Violates CLAUDE.md Principle 1 (capture is sacred — if it doesn't reach the assertion fresh, the test should know). | Rejected. |
| Split: typed-error on unmounted, last-known-value on disconnect | Distinguishes "your spec is wrong" from "the network hiccupped." | Two behaviors to remember; runtime complexity. The disconnect case in practice means "we cannot validate this assertion at all" — last-known-value pretends we can. | Rejected. |

**Why typed-errors-always wins.** Component-Object specs exist to surface the moat at assert time. Silently swallowing "the stream died" defeats the purpose. Both errors are designed so the message is the diagnosis — slice 6 doesn't need to add a separate "why did my COP test fail?" path.

---

## The chosen API — surface that slice 6 will implement

```ts
// User import path (will live in the published `reactlens` package, not the
// fixture-copied helper).
import { Component, ComponentNotMountedError, SnapshotStreamDisconnectedError }
  from 'reactlens/component-object';

// Per-test handle (the `testId` is bound automatically by the reactlens
// fixture; users do NOT pass it manually in production — the helper reads
// it from the same test-info global the probe already uses).
test('LoginForm is not pending after success', async ({ page }) => {
  // page interactions ...
  await expect
    .poll(() => Component('LoginForm').props.isPending, { timeout: 5_000 })
    .toBe(false);
});
```

**Slice 6 contract:**

- `Component(name: string)` returns a `ComponentHandle` whose `props` is a typed proxy. Each `props.<key>` read is synchronous and either returns the latest captured value or throws.
- Both error classes export `kind` discriminators (`'ComponentNotMountedError'` / `'SnapshotStreamDisconnectedError'`) so generated tests can `try`/`catch` and re-throw or assert without `instanceof`-across-package-boundary footguns.
- Error message format is locked: `Component(<JSON-quoted-name>) not found in latest snapshot for test <testId>. The component may be unmounted, or the displayName does not match the React fiber name.` and `Snapshot stream disconnected (test <testId>, last snapshot <Δms>ms ago). The dashboard WS closed before a snapshot for the queried component arrived.` Diagnosis-prompts can match against these exact prefixes.
- Helper-side subscription connects on first `Component(...).props.<x>` access (lazy) so specs that don't use the API pay no WS cost.
- `props` only — `state` and `hooks` are NOT in slice 6's surface. The probe captures them, the accessor will expose them in a later slice once we have ergonomic shapes (hooks are indexed by position, not name, which makes the `Component('X').hooks.foo` syntax dishonest).

---

## What the spike actually surfaced

The prototype lived at `tests/fixtures/vite-react-router/reactlens/snapshot-accessor.ts` + `e2e/specs/eval/snapshot-accessor-spike.spec.ts` for the duration of this design pass. It targeted `<Pagination total={11} pageSize={5} />` rendered at `/eval/case-005` (deterministic, prop-rich, already in the eval fixture). Run via:

```bash
REACTLENS_PROBE_PATH=$PWD/dist/probe/probe.global.js \
  node bin/reactlens.js run --cwd tests/fixtures/vite-react-router --no-open --no-analyze
```

All three scenarios passed:

| Scenario | Duration | Result |
|---|---|---|
| Mounted-component prop lookup (`Component('Pagination').props.total` → `11`, `.pageSize` → `5`) | 414 ms | ✓ |
| Unknown display-name lookup throws `ComponentNotMountedError` | 413 ms | ✓ |
| `ws.terminate()` mid-spec → next read throws `SnapshotStreamDisconnectedError` | 475 ms | ✓ |

### Findings worth carrying into slice 6

1. **First-snapshot latency is real but small.** Even with no explicit wait between `page.goto` and the first `Component(...).props.x` read, the snapshot arrived within Playwright's first poll iteration. The polling pattern is sufficient — no need to add an `awaitFirstSnapshot()` helper.

2. **Module-scope state held up.** The prototype used a singleton `state` module-scope object. Playwright workers are per-process; this means singleton state is safe per worker but NOT shared across workers. Slice 6 must either confirm worker-process isolation explicitly or design for it (the WS client per worker is fine; the cache per worker is the right granularity since `testId` is unique within a process).

3. **WS-close detection is async.** `ws.terminate()` in the spike fires the `'close'` handler on the next event-loop tick. The spec needed a `setTimeout(0)`-equivalent wait before the next `Component(...)` read or the read happened before `state.closed` flipped. Slice 6 should make the read itself check the WS readyState before consulting the cached `closed` flag, eliminating the wait.

4. **Dashboard ring buffer saves the startup race.** Connecting the helper *after* `page.goto` worked because the dashboard server's 500-event ring buffer (`src/dashboard/server.ts:131-145`) replays history on connect. If slice 6 ever lowers that buffer or wants to support late-connecting specs in long runs, it must verify the replay still covers the relevant snapshots.

5. **Pre-mount lookup throws the same error as unknown-name.** Both "the component name doesn't exist in this tree" and "the component will mount but hasn't yet" produce `ComponentNotMountedError`. Combined with `expect.poll`, this is the intended behavior — the poller retries until the component mounts or the timeout fires. No need to distinguish "doesn't exist" from "not yet" at the error level.

---

## Non-decisions (deferred to slice 6)

These came up during the spike but lacked enough information to settle now:

- **Disambiguation when two `<LoginForm>` are mounted.** Spike avoided this by picking a single-instance component. Slice 6 needs `Component('LoginForm').nth(0)` or `Component('LoginForm').where({ id: 'primary' })`. Pick after one of these patterns appears in a real generated test.
- **HMR behavior.** The dev server replaces module instances; the probe re-emits the tree on each commit so the cache catches up. Untested under HMR storm conditions.
- **Behavior contract output.** ADR-0006 says the `<Component>.contract.md` generated alongside specs gains a "Component-Object surface" section. The exact shape (one row per asserted prop?) is a slice-6 question.
- **Generator prompt update.** A new `generate-suite-component-object.md` prompt is part of slice 6, not this design.

---

## Acceptance checklist (slice-5 issue #10)

- [x] Working prototype on `vite-react-router` demonstrating mounted lookup, unmounted-component error, and WS-disconnect error.
- [x] Design doc at `docs/design/snapshot-accessor.md` (this file).
- [x] Three addressing alternatives considered (display-name / testid / import identity) with reasoning.
- [x] Three subscription alternatives considered (WS client / IPC / window-global — exceeds the two-minimum).
- [x] `expect()` composition addressed (polled-promise chosen, alternatives recorded).
- [x] Error-shape contract recorded (typed classes, message format, `kind` discriminators).
- [ ] **Maintainer review and accept** — this is the HITL gate. Merging this PR is the accept.
- [x] Prototype NOT merged. The two prototype files were deleted before this commit (reproducible from §"What the spike actually surfaced" above).
