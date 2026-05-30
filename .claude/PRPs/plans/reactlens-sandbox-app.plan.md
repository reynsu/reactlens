# Plan: reactlens Sandbox App — end-to-end flow validation

## Summary
Create a small standalone Vite + React Router app (sibling directory, npm-managed) that consumes the **local `feat/ootb-init` build** of reactlens, with several routes exercising different React element types plus a few anonymous (no leaking comments) planted bugs. The goal is to manually drive the *entire* reactlens flow — `init → generate → run → diagnose → diff → dashboard` — and confirm the just-landed out-of-the-box-init changes work against a real, non-reference stack.

## User Story
As the reactlens maintainer, I want a small, realistic React app I can run reactlens against end-to-end, so that I can confirm every capability (component-aware generation, component-tree capture, test-bug/real-bug diagnosis, dashboard inspector, semantic diff, a11y) works after the `feat/ootb-init` changes.

## Problem → Solution
Today the only React apps reactlens runs against are `tests/fixtures/*`, which are wired as pnpm-workspace members with MSW scaffolding and are tuned for the integration test harness — not a clean "install reactlens as a user and run the flow" dogfood. → A purpose-built sandbox app, installed via a local file link exactly as an external user would, on a Vite + React Router + **npm** stack (which stresses the new `npm run dev` interpolation), covering all capabilities in one small codebase.

## Metadata
- **Complexity**: Medium (new standalone project; ~12-16 small files; no changes to reactlens itself)
- **Source PRD**: N/A (free-form, follow-on to PRD #65 / `feat/ootb-init`)
- **PRD Phase**: N/A
- **Estimated Files**: ~14 created in the sandbox project; 0 changed in reactlens

---

## Key Decisions (confirmed with maintainer)
1. **Location & consumption**: standalone sibling directory (e.g. `../reactlens-sandbox`), consuming the **local `feat/ootb-init` build** of reactlens via a `file:` dependency / link — NOT the published `@reynsu/reactlens@0.3.0` (which lacks the OOTB changes).
2. **Stack**: Vite + React Router + **npm** (npm, not pnpm, so the generated `playwright.config.ts` must come out with `npm run dev` — directly validating slice #66's interpolation vs the old hardcoded `pnpm dev`).
3. **Bugs**: mix — clean routes for generate/run/a11y/diff, plus ~3 anonymous planted failures (1 real-bug, 1 test-bug, 1 flaky) to exercise diagnosis classification. No comments or identifiers that reveal the bug.

---

## UX Design
Internal/dev tooling validation — no end-user UX. The "user" is the maintainer driving the CLI. Flow:

### Before
```
reactlens only runs against tests/fixtures/* (workspace members, MSW-wired,
harness-tuned). No clean external-user dogfood of the OOTB flow.
```
### After
```
../reactlens-sandbox: a real app installed via `file:../reactlens`. Maintainer
runs `npx reactlens init/generate/run/diff` and visually confirms the dashboard
inspector, diagnosis classifications, and a11y output — as an external user would.
```

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `tests/fixtures/vite-react-router/src/main.tsx` | all | Canonical Vite + React Router app entry to mirror (router setup, route table) |
| P0 | `src/generator/prompts/generate-suite.md` | all | The exact spec convention generate emits: POM + `import { test, expect } from '../../reactlens/fixtures'` + `page.route` mocking. Sandbox specs must match. |
| P0 | `docs/adr/0011-page-route-over-msw-for-state-provocation.md` | all | Mocking is `page.route`, NOT MSW. The sandbox must have NO `msw`, no service worker, no `src/mocks/`. |
| P0 | `docs/adr/0010-interpolate-detected-stack-into-scaffold-at-init.md` | all | What `init` should produce for this stack (port, `npm run dev`, baseURL, testDir) — the thing under test. |
| P1 | `templates/playwright.config.ts` + `src/scaffold/render-playwright-config.ts` | all | Expected shape of the generated config after interpolation. |
| P1 | `templates/fixtures.ts` | 1-60, 370-432 | How the probe attaches per-test and how specs import `test`/`expect`/`Component`. |
| P1 | `tests/fixtures/vite-react-router/src/pages/CheckoutPage.tsx` | all | A representative page component (data fetch + visual states) to mirror element style. |
| P2 | `CLAUDE.md` | §4 | The capability list the routes must collectively exercise. |
| P2 | `src/config/schema.ts` | all | `reactlens.config.ts` shape (componentGlobs, pattern, output, dashboard) — post-#67 there is NO `msw` field. |

## External Documentation
No external research needed — Vite + React Router + Playwright are established internal patterns already present in `tests/fixtures/`.

---

## Patterns to Mirror

### APP_ENTRY / ROUTER
// SOURCE: tests/fixtures/vite-react-router/src/main.tsx
A `createBrowserRouter` / `<BrowserRouter>` with a route table; each route renders a page component from `src/pages/`. Mirror the same router library + version (`react-router-dom` ^6) and the `src/pages/**` + `src/components/**` layout so the default/detected `componentGlobs` match.

### SPEC_IMPORT_AND_MOCK
// SOURCE: src/generator/prompts/generate-suite.md:52 + :70-73
Specs import `import { test, expect } from '../../reactlens/fixtures';` (NEVER `@playwright/test`). Non-default backend states are provoked with `await page.route('**/api/...', route => route.fulfill({ ... }))` then navigation. (Post-ADR-0011: no `?mocks=off`, no MSW.)

### DATA_FETCH_VISUAL_STATES
// SOURCE: tests/fixtures/vite-react-router/src/pages/CheckoutPage.tsx
A component that fetches `/api/...`, exposing `isLoading | isError | empty | success` branches with stable `data-testid`s per branch — this is what `reactlens generate` enumerates into one spec per visual state.

### TESTID_CONVENTION
// SOURCE: tests/fixtures/vite-react-router/src/pages/*.tsx
Every interactive/asserted element carries a `data-testid`. The probe's `testIdIndex` maps these to owning fibers — required for the dashboard inspector's exact-fiber highlight.

### CONFIG_SHAPE
// SOURCE: templates/reactlens.config.ts (post-#67)
`defineConfig({ componentGlobs, pattern: 'pom', output: { pages, specs }, dashboard: { port, open } })` — NO `msw` key.

---

## Files to Change (all CREATE, in `../reactlens-sandbox`)

| File | Action | Justification |
|---|---|---|
| `package.json` | CREATE | npm scripts (`dev: vite`), deps (react, react-dom, react-router-dom ^6), `@reynsu/reactlens` via `file:../reactlens` (devDep), `@playwright/test` (installed by init). NO `msw`. |
| `vite.config.ts` | CREATE | `@vitejs/plugin-react`; a tiny dev middleware (or `public/api/*.json`) so `/api/items` returns 200 in `npm run dev` (specs override per-state via `page.route`). |
| `index.html`, `tsconfig.json`, `.gitignore` | CREATE | Standard Vite scaffold; gitignore `node_modules`, `.reactlens`, `dist`, `playwright-report`. |
| `src/main.tsx` | CREATE | Router with the route table below. |
| `src/pages/HomePage.tsx` | CREATE | Static nav + a `useState` counter (simple state for tree inspection). |
| `src/pages/CounterPage.tsx` | CREATE | `useReducer` counter (reducer state visible in the tree). |
| `src/pages/ItemsPage.tsx` | CREATE | `fetch('/api/items')` with loading/error/empty/success branches (visual-state generation showcase). **Houses the flaky bug** (nondeterministic order). |
| `src/pages/LoginPage.tsx` | CREATE | Controlled form, per-field validation states. Button label is the source of the **test-bug** (stale spec). |
| `src/pages/CartPage.tsx` | CREATE | Renders line items + a subtotal. Subtotal computation is the **real-bug**. |
| `src/pages/SettingsPage.tsx` | CREATE | Nested components / 2-3 level prop drilling (tree depth) + one intentional a11y defect (input with no associated label) for axe. |
| `src/components/*` | CREATE | A few shared leaf components used by Settings/Cart to give the tree depth. |
| `e2e/specs/*.spec.ts` (3 planted) | CREATE | Hand-written specs that fail and feed `diagnose`: `cart.spec.ts` (real-bug), `login.spec.ts` (test-bug), `items-order.spec.ts` (flaky). Import from `../../reactlens/fixtures`. |

(The `reactlens/`, `playwright.config.ts`, `reactlens.config.ts` files are produced by `npx reactlens init` — do NOT hand-write them; their correctness is part of what we're testing.)

## NOT Building
- **No MSW / service worker / `src/mocks/`** — mocking is `page.route` (ADR-0011).
- **No backend server / real API / auth** — `/api/*` is a static JSON (or trivial Vite middleware); specs mock per-state.
- **No changes to reactlens itself** — this is a consumer project only.
- **No TanStack Query / react-hook-form** — keep elements "sencillos" with plain `useState`/`useReducer`/`fetch`.
- **No CI wiring for the sandbox** — manual dogfood only.
- **Bugs carry no revealing comments or identifiers** — file/var names are domain-neutral (`CartPage`, not `BuggyCartPage`).

---

## Route Table (the "varias rutas con elementos sencillos")

| Route | Element types exercised | reactlens capability validated | Planted bug |
|---|---|---|---|
| `/` Home | `useState`, links | tree capture, generation happy-path | — |
| `/counter` | `useReducer` | reducer state in inspector | — |
| `/items` | `fetch`, loading/error/empty/success | **component-aware generation** (visual states via `page.route`) | **flaky** (nondeterministic list order) |
| `/login` | controlled inputs, validation states | generation of validation-state specs | **test-bug** (button label changed; old spec asserts stale text) |
| `/cart` | list + computed total | diagnosis | **real-bug** (wrong subtotal computation) |
| `/settings` | nested prop-drilled components + a11y defect | inspector tree depth + **axe a11y violation** | — (a11y finding, not a test failure) |

---

## Step-by-Step Tasks

### Task 1: Build & expose the local reactlens
- **ACTION**: In the reactlens repo on `feat/ootb-init`, run `pnpm build` so `dist/` + `bin/reactlens.js` are current (the bundled CLI resolves prompts/templates from `dist`/`templates`).
- **VALIDATE**: `node bin/reactlens.js --help` prints the command list including `init`, `generate`, `run`, `diff`.
- **GOTCHA**: A `file:` dependency points at the package dir; the CLI only works if `dist/` is built. Rebuild after any reactlens change. `templates/` and `src/generator/prompts/` ship via the `files` array — confirm they're present in the package.

### Task 2: Scaffold the bare Vite + React Router app (npm)
- **ACTION**: Create `../reactlens-sandbox` with `package.json` (npm, `"dev": "vite"`), `vite.config.ts`, `index.html`, `tsconfig.json`, `.gitignore`. Add `"@reynsu/reactlens": "file:../reactlens"` as a devDependency. `npm install`.
- **MIRROR**: `tests/fixtures/vite-react-router/package.json` (deps/versions) — but drop `msw`, `@tanstack/react-query`, `react-hook-form`, `@hookform/resolvers`.
- **GOTCHA**: Use a `pnpm-lock`-free, npm-only project (presence of `package-lock.json`, absence of `pnpm-lock.yaml`/`yarn.lock`) so `detectPackageManager` resolves `npm` → validates the `npm run dev` interpolation.
- **VALIDATE**: `npm run dev` serves the app on `http://localhost:5173`.

### Task 3: Write the routes (clean ones first)
- **ACTION**: Implement Home, Counter, Items, Login, Cart, Settings per the route table, each a `src/pages/*.tsx` registered in `src/main.tsx`. Every asserted element gets a `data-testid`.
- **MIRROR**: `DATA_FETCH_VISUAL_STATES` for `/items`; `TESTID_CONVENTION` everywhere.
- **IMPLEMENT (visual states for `/items`)**: `useState` for `status: 'loading'|'error'|'empty'|'success'`; `fetch('/api/items')`; render a branch per status with testids `items-loading`, `items-error`, `items-empty`, `items-list`.
- **GOTCHA**: For `npm run dev` to show the success branch with no backend, serve `/api/items` from `public/api/items.json` (Vite serves `public/` statically) or a 4-line `vite.config` middleware. Specs override per-state with `page.route`.
- **VALIDATE**: Each route renders in the browser; no console errors.

### Task 4: Plant the three anonymous bugs
- **ACTION**:
  - **real-bug** in `/cart`: `subtotal` sums `item.qty` (or `price+qty`) instead of `price * qty`. The route renders `data-testid="cart-subtotal"`.
  - **test-bug**: `/login`'s submit button reads e.g. `Continue`; write `e2e/specs/login.spec.ts` asserting the old text `Sign in` (component correct, spec stale).
  - **flaky** in `/items`: render the list ordered by a nondeterministic key (e.g. `Math.random()` sort, or resolve two fetches via `Promise.all` and render whichever settles first); `e2e/specs/items-order.spec.ts` asserts a fixed first item.
- **GOTCHA**: NO comment, prop name, file name, or testid may hint at the bug or its class (honest diagnosis test — mirrors the eval-case anonymization convention).
- **VALIDATE**: `cart.spec.ts` and `items-order.spec.ts` fail; `login.spec.ts` fails because the spec is stale (the app is correct).

### Task 5: Run `init` and verify the OOTB interpolation
- **ACTION**: From `../reactlens-sandbox`, run `npx reactlens init`.
- **VALIDATE (this is the core OOTB check)**:
  - `playwright.config.ts` is written with `baseURL` `http://localhost:5173` and `webServer.command` **`npm run dev`** (NOT `pnpm dev`) — confirms slice #66 interpolation + npm detection.
  - `reactlens.config.ts` `componentGlobs` reflect `src/pages` + `src/components` (slice #71 seeding) and the file has **no `msw` field** (slice #67).
  - `@playwright/test` got installed + `npx playwright install chromium` ran (slice #69 peer + init install).
  - Re-running `npx reactlens init` overwrites the scaffold WITHOUT prompting; `npx reactlens init --dry-run` writes nothing (slice #70).
  - `reactlens/{fixtures,global-setup,streaming-reporter,component-object}.ts` present.

### Task 6: `generate` and inspect output
- **ACTION**: `npx reactlens generate`.
- **VALIDATE**: One spec + POM per analyzed component under `e2e/`; for `/items` the generated spec enumerates loading/error/empty/success using `page.route` (no MSW). A `<Component>.contract.md` is written next to each spec. Specs import from `../../reactlens/fixtures`. Run `generate` once against a bogus `--pages 'nope/**'` and confirm it now **throws `GENERATE_NO_COMPONENTS`** instead of silently exiting 0 (slice #68).

### Task 7: `run` + dashboard + diagnosis
- **ACTION**: `npx reactlens run` (opens dashboard at :7777).
- **VALIDATE**: Dashboard shows the test list, browser preview, and the **component inspector** with the React tree + props/state/hooks at each step; the active step highlights the owning fiber. The 3 planted specs fail and produce diagnoses — confirm classifications: `/cart` → **real-bug** (with a patch pointing at the subtotal calc), `/login` → **test-bug** (proposed spec fix), `/items` order → **flaky**. Confirm the axe **a11y violation** from `/settings` surfaces.

### Task 8: time-travel, watch, diff
- **ACTION**: Scrub the `TimelineSlider` on a past run; run `npx reactlens run --watch` and edit a component to confirm re-run; run `npx reactlens run` twice and `npx reactlens diff <runA> <runB>` after a small component change.
- **VALIDATE**: Replay hydrates from disk; watch re-runs on save; `diff` reports a semantic component-tree + a11y-tree delta (not pixels).

---

## Testing Strategy
This plan's "tests" ARE the reactlens flow run manually against the sandbox; there is no unit-test suite for the sandbox itself. The planted specs are the diagnosis fixtures.

### Manual validation matrix
| Capability | Command | Expected |
|---|---|---|
| OOTB init (npm) | `npx reactlens init` | `npm run dev` + port 5173 baked into playwright.config; npm-detected |
| componentGlobs seed | inspect `reactlens.config.ts` | globs match `src/pages` + `src/components`; no `msw` field |
| idempotent re-init | `npx reactlens init` again / `--dry-run` | silent overwrite / writes nothing |
| generation visual states | `npx reactlens generate` | per-state specs for `/items` via `page.route`; contracts written |
| generate fail-loud | `npx reactlens generate --pages 'nope/**'` | throws `GENERATE_NO_COMPONENTS` |
| tree capture / inspector | `npx reactlens run` | inspector shows props/state/hooks + fiber highlight |
| diagnosis | run with planted specs | cart=real-bug, login=test-bug, items=flaky |
| a11y | run | `/settings` axe violation surfaced |
| time-travel / watch / diff | as Task 8 | replay / re-run / semantic diff work |

### Edge Cases Checklist
- [ ] `/items` empty state (mock `[]`) renders the empty branch
- [ ] `/items` error state (mock 500) renders the error branch
- [ ] Re-init after editing the scaffold restores it (overwrite)
- [ ] `generate` with zero matches errors clearly
- [ ] Sandbox has no `pnpm-lock.yaml`/`yarn.lock` (npm detection)

---

## Validation Commands

### Build the local reactlens (prerequisite)
```bash
# in the reactlens repo, on feat/ootb-init
pnpm build && node bin/reactlens.js --help
```
EXPECT: CLI help lists init/generate/run/diff.

### Sandbox flow
```bash
cd ../reactlens-sandbox
npm install
npm run dev            # smoke: app serves on :5173, all routes render
npx reactlens init     # OOTB check (Task 5 acceptance)
npx reactlens generate # visual-state specs + contracts
npx reactlens run      # dashboard + diagnosis + a11y
```
EXPECT: each step matches the manual validation matrix.

### Manual Validation
- [ ] All six routes render under `npm run dev`
- [ ] `playwright.config.ts` shows `npm run dev` (the headline OOTB assertion)
- [ ] Three planted specs classified correctly by diagnose
- [ ] Dashboard component inspector shows the tree with state/hooks

---

## Acceptance Criteria
- [ ] Sandbox app created at `../reactlens-sandbox`, npm-managed, consuming `file:../reactlens`
- [ ] Six routes covering useState, useReducer, fetch-visual-states, form validation, computed totals, nested/a11y
- [ ] Three anonymous planted bugs (real-bug, test-bug, flaky) with no leaking comments/identifiers
- [ ] `npx reactlens init` produces an `npm run dev` + port-5173 config and seeded componentGlobs (OOTB validated)
- [ ] Full flow (init→generate→run→diff) runs and every capability in the matrix is observed working
- [ ] No MSW anywhere in the sandbox

## Completion Checklist
- [ ] App layout matches `src/pages/**` + `src/components/**` so default globs/detection apply
- [ ] Specs import from `../../reactlens/fixtures`, mock via `page.route`
- [ ] Bugs are anonymous (mirrors eval-case convention)
- [ ] Local reactlens rebuilt before linking
- [ ] No changes made to the reactlens repo itself

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `file:` link uses a stale `dist/` (CLI runs old code) | Medium | High | Always `pnpm build` reactlens before testing; document in Task 1 |
| `generate`/`diagnose` need network + Claude subscription; the 5-hour window is depleted (see this session) | Medium | Medium | Run generate/diagnose when the window has headroom; `run`/`diff`/dashboard are offline and can be validated independently |
| npm + `file:` to a pnpm-built package mis-resolves bins | Low | Medium | Verify `npx reactlens --help` resolves before proceeding |
| Making the flaky bug reliably flaky is fiddly | Medium | Low | Use `Math.random()` sort so failure is frequent; acceptable for a manual dogfood |
| The sandbox needs `/api/items` to return data in dev | Low | Low | Serve `public/api/items.json` statically |

## Notes
- This is the dogfood the v0.3 release runbook found valuable (three packaging bugs slipped past unit tests because no always-on E2E exercised the bundled CLI's agent path). This sandbox is exactly that missing exercise for the `feat/ootb-init` changes.
- Keep the sandbox OUT of the reactlens git history (it's a sibling dir); if it should be preserved, it can later become an `examples/` member or its own repo — out of scope here.
- After validation, real bugs found get filed against reactlens; the sandbox itself is a throwaway/keep-around playground, not a shipped artifact.
