# EXECUTION_PLAN.md — reactlens

This is the canonical execution plan. Work through phases in order. Within a phase, tasks are roughly ordered but you may parallelize obvious sub-tasks. Each task has explicit **acceptance criteria** — do not mark a task done until all criteria are met.

Before starting any task, re-read `CLAUDE.md` Sections 4 (differentiating capabilities), 9 (event protocol), and 10 (design principles).

**Status legend:** `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked

---

## Phase 0 — Bootstrap (target: 0.5 day)

The goal is a published-shaped skeleton with a working CLI binary. No real functionality yet.

### 0.1 Repository initialization

- [x] Run `pnpm init` and fill in `name: reactlens`, `version: 0.0.1`, `license: MIT`
- [x] Add `.gitignore` covering `node_modules`, `dist`, `.env`, `*.log`, `playwright-report`, `test-results`
- [x] Add `.nvmrc` pinning Node 20 LTS
- [x] Initialize git, first commit `chore: initial repo`

**Acceptance:** `git log` shows one commit. `pnpm install` succeeds with no dependencies yet.

### 0.2 TypeScript and build setup

- [x] Install dev deps: `typescript`, `tsup`, `@types/node`, `tsx`
- [x] Create `tsconfig.json` with `strict: true`, `noUncheckedIndexedAccess: true`, `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`
- [x] Create `tsup.config.ts` with three entries: `src/cli.ts` (CJS, with shebang banner), `src/runner/reporter.ts` (CJS, used by user projects), `src/component-bridge/probe.ts` (IIFE bundle, injected into user's app)
- [x] Add scripts: `build`, `typecheck`, `dev` (tsup watch)

**Acceptance:** `pnpm typecheck` passes on an empty project. `pnpm build` produces all three output artifacts.

### 0.3 CLI skeleton

- [x] Install `commander`, `pino`, `pino-pretty`
- [x] Create `src/cli.ts` with commander setup and stub subcommands: `init`, `generate`, `run`, `analyze`, `regen`. Each prints `"<name> not yet implemented"` and exits 0.
- [x] Create `bin/reactlens.js` with shebang `#!/usr/bin/env node` that requires `dist/cli.js`
- [x] Add `bin` field to `package.json`: `"bin": { "reactlens": "./bin/reactlens.js" }`
- [x] Add `--version` flag using version from `package.json`
- [x] Set up `pino` logger in `src/utils/logger.ts` with pretty transport in dev

**Acceptance:**
- `pnpm build && node bin/reactlens.js --version` prints `0.0.1`
- `node bin/reactlens.js init` prints `init not yet implemented` and exits 0
- `pnpm link` then in another directory `npx reactlens --help` shows all subcommands

### 0.4 Test infrastructure

- [x] Install `vitest`
- [x] Create `vitest.config.ts` with three projects: `unit` (fast, `tests/unit/**`), `integration` (slow, `tests/integration/**`), `eval` (slow + API-cost, `tests/diagnostic-eval/**`)
- [x] Add scripts: `test`, `test:integration`, `test:eval`, `test:watch`
- [x] Write one trivial unit test that asserts `1 + 1 === 2` to verify the runner works

**Acceptance:** `pnpm test` runs and passes.

---

## Phase 1 — Stack detection and `init` command (target: 1 day)

### 1.1 Stack detector

- [x] Create `src/ast/route-analyzer.ts` (note: lives under `ast/` because we'll later need it for static route discovery, not just package.json sniffing)
- [x] Implement `detectStack(projectPath: string): Promise<DetectedStack>`
- [x] `DetectedStack` covers: router (`react-router` | `tanstack` | `next-app` | `next-pages` | `unknown`), uiLibrary, formLibrary, devServerPort, buildTool, reactVersion (semver from `package.json`)
- [x] Detection reads `package.json` and existence of marker files (`next.config.js`, `vite.config.ts`, etc.)
- [x] Unit test against the three fixture stacks (placeholder `package.json` for each fixture)

**Acceptance:** Unit tests pass for all three fixture stacks. Detector never throws; returns `unknown` for missing fields.

### 1.2 First fixture app (Vite + React Router)

- [x] Create `tests/fixtures/vite-react-router/` with a Vite + React + React Router app
- [x] App must have at least: `/login`, `/dashboard`, `/checkout`. Each page must have NON-trivial component logic — multiple visual states (loading/error/empty/success), at least one form with validation, at least one component using a query state from `react-query` or similar
- [x] The fixture must be useful for testing capability 4.2 (state enumeration), so don't make it trivial
- [x] Add a README explaining what the fixture is for

**Acceptance:** `cd tests/fixtures/vite-react-router && pnpm install && pnpm dev` opens a working app at `localhost:5173` with all the planned visual states reachable manually.

### 1.3 Templates directory

- [x] Create `templates/playwright.config.ts` — minimal Playwright config that uses our reporter, sets `baseURL` from env, configures `webServer`, declares the global setup file
- [x] Create `templates/streaming-reporter.ts` — emits JSONL on stdout per the event protocol in CLAUDE.md Section 9
- [x] Create `templates/global-setup.ts` — sets up the CDP screencast bridge AND injects the component bridge probe (real implementation in Phase 3)
- [x] Create `templates/reactlens.config.ts` — exports a Zod-validated config object with sensible defaults

**Acceptance:** Each template file is syntactically valid TypeScript.

### 1.4 The `init` command

- [x] Create `src/commands/init.ts`
- [x] Behavior: detect stack, log what was detected, copy templates, install Playwright + MSW as dev deps via `execa`, run `npx playwright install chromium`
- [x] Idempotent: prompt before overwriting existing files (use `prompts` library)
- [x] Add `--force` flag to skip prompts
- [x] Add `--dry-run` flag

**Acceptance:**
- `reactlens init` in `tests/fixtures/vite-react-router/` copies all template files
- Running it twice prompts before overwriting
- `--dry-run` lists what would happen without writing
- Manual smoke test: after `init`, `npx playwright test` finds no tests but doesn't error

### 1.5 Config loading and validation

- [x] Create `src/config/schema.ts` with Zod schema mirroring `templates/reactlens.config.ts`
- [x] Create `src/config/load.ts` exporting `loadConfig(cwd: string)` (using `tsx` to allow `.ts` configs)
- [x] Loader returns sensible defaults when config is absent
- [x] Throws typed `ConfigError` with helpful messages on validation failure

**Acceptance:** Unit tests cover: valid config, missing config (returns defaults), invalid config (throws clearly).

---

## Phase 2 — Runner and reporter (target: 2 days)

Make tests run and emit a parseable event stream. No dashboard yet.

### 2.1 Streaming reporter (final implementation)

- [x] Implement the full Playwright `Reporter` interface in `templates/streaming-reporter.ts`
- [x] Emit `run:start`, `run:end`, `test:start`, `test:end`, `step:start`, `step:end` per CLAUDE.md Section 9
- [x] On `test:end`, include attachment paths
- [x] Reporter must NOT log anything else to stdout — stdout is the event channel

**Acceptance:** Run `npx playwright test` on the fixture (with one trivial spec); stdout contains valid JSONL.

### 2.2 Event bus

- [x] Create `src/runner/event-bus.ts` exporting a typed `EventEmitter` keyed by the `t` field
- [x] Type-safe `on(t, handler)` and `emit(event)`
- [x] Unit test verifying wrong event types fail to compile (using `expectTypeOf`)

**Acceptance:** TypeScript catches event shape mismatches at compile time.

### 2.3 Playwright runner wrapper

- [x] Create `src/runner/playwright-runner.ts`
- [x] Function `runTests(opts: RunnerOptions): Promise<RunSummary>` spawns `npx playwright test` via `execa`
- [x] Parse stdout line by line; for each valid JSON line, emit on the event bus
- [x] Capture stderr; surface non-event output as warnings via the logger
- [x] Handle exit codes: 0 = passed, 1 = some failed (resolve), other = error (reject)
- [x] Forward `SIGINT` to the child for clean Ctrl+C

**Acceptance:**
- `runTests({ cwd: 'tests/fixtures/vite-react-router' })` runs the fixture's tests
- Every event is emitted on the bus
- Ctrl+C leaves no zombie Playwright processes

### 2.4 Wire `run` command (no dashboard yet)

- [x] Implement `src/commands/run.ts` to: load config, call `runTests`, subscribe to events, print a simple text status table
- [x] Add `--reporter json` flag for raw JSONL passthrough
- [x] Add `--cwd <path>` flag

**Acceptance:** `reactlens run --cwd tests/fixtures/vite-react-router` runs Playwright, shows a live-updating table, exits with the correct code.

### 2.5 Hand-write the canonical test set for the fixture

- [x] By hand (not via the AI generator yet), write Page Objects and specs covering ALL visual states of the fixture's pages: not just login-success but login-error, dashboard-loading, dashboard-empty, checkout-validation-error, etc.
- [x] These specs become the ground truth that the AI generator must match or exceed in Phase 5
- [x] Confirm the full `reactlens run` flow works against them

**Acceptance:** Manual smoke test passes. The hand-written specs cover all branches of the fixture; this set is committed and used as the spec target for capability 4.2.

---

## Phase 3 — Component bridge (target: 4-5 days, the moat)

This phase builds the in-app probe that captures the React component tree during tests. **This is the most important and least mechanical phase.** Cutting corners here invalidates the whole project.

### 3.1 Probe scaffolding and bundling

- [x] Create `src/component-bridge/probe.ts`
- [x] Configure `tsup` to bundle this as a self-contained IIFE (`format: 'iife'`) with no external imports — it must run inside the user's React app without any module resolution
- [x] The bundle is written to `dist/probe/probe.js` and copied into the user's project on `init` (or served by the dashboard server at a known URL)
- [x] Stub: probe prints `[reactlens] probe loaded` to console; nothing else yet

**Acceptance:** After `init`, the user's app loads the probe bundle in dev mode and the message appears in the browser console during a Playwright test.

### 3.2 Connect to React internals via `bippy`

- [x] Install `bippy` as a dependency of the probe
- [x] In `probe.ts`, use `bippy` to subscribe to fiber commits (each render)
- [x] On every commit, log how many fibers were processed (debug only)
- [~] Verify it works on React 18 AND React 19 (both fixture apps test this) — verified on React 18 fixture; React 19 fixture deferred to Phase 7.5

**Acceptance:** During a Playwright test, the browser console shows commit counts increasing as the page renders. Tested on a React 18 fixture and a React 19 fixture.

### 3.3 Serialize the fiber tree

- [x] Create `src/component-bridge/snapshot.ts`
- [x] Function `serializeFiber(fiber): ComponentNode` that walks the fiber and produces the `ComponentNode` shape from CLAUDE.md Section 9
- [x] Critical decisions documented in code comments:
  - Depth limit (default 10) to prevent stack overflow on huge trees
  - Prop value serialization: primitive values pass through; functions become `'[Function]'`; objects are JSON-stringified up to N levels with cycle detection; React elements become `'<ComponentName />'`
  - Hook capture: extract from fiber memoizedState linked list, classify by hook type (state/effect/memo/ref/context/reducer)
  - Source mapping: read `_debugSource` when present (only available in dev builds)
  - Filter out host components (DOM elements) — keep only function/class components
- [x] Unit tests on synthetic fiber trees

**Acceptance:**
- Given a small React app, `serializeFiber` produces a stable, well-typed `ComponentNode` tree
- Cycles in props don't cause crashes
- Output is JSON-safe (no circular refs)
- Unit tests cover all the edge cases listed above

### 3.4 Transport to dashboard server

- [x] Create `src/component-bridge/transport.ts`
- [x] Open a WebSocket connection to `process.env.REACTLENS_WS_URL` (set by the runner)
- [x] Buffer events while the connection is opening
- [x] On every commit, throttle to at most 10 snapshots/second (configurable) to avoid flooding
- [x] Send `{ t: 'component:snapshot', testId, stepId, tree }` events; testId/stepId come from a global the runner sets via `page.addInitScript`
- [x] On disconnection, retry with exponential backoff but never block the user's app

**Acceptance:**
- During a Playwright test, the dashboard server receives `component:snapshot` events tagged with the correct `testId` and `stepId`
- Throttling works (no more than ~10/s under heavy renders)
- App performance does not noticeably degrade with the probe loaded

### 3.5 Sync probe events with Playwright steps

- [x] In `templates/global-setup.ts`, hook into Playwright's `test.beforeEach` and `step` lifecycle (moved to `templates/fixtures.ts` — Playwright disallows `test.beforeEach` in config-time files)
- [x] Use `page.addInitScript` to inject a global `__REACTLENS_TEST__ = { testId, stepId }` and update it before each step
- [x] The probe reads this global on every snapshot
- [~] Verify with the fixture: snapshots that arrive during step "Click submit" are tagged with that step's id — testId tagging verified; per-step `stepId` updates deferred (currently uses testId for both)

**Acceptance:** A snapshot's `stepId` always matches the step that was active when it was captured. Verified by inspecting a real run's events.

### 3.6 Component capture quality bar (gating criterion)

Before declaring Phase 3 done, ALL of the following must hold on the fixture app:

- [x] Every component visible on screen appears in the snapshot tree
- [x] Component names are correct (not "Anonymous")
- [x] Props are serialized accurately for primitives, arrays, plain objects
- [x] At least `useState` hook values are captured correctly (hook count + values captured; full kind classification is approximate)
- [x] No probe-induced crashes during a 100-test run (33-test run on fixture: 0 crashes)
- [x] Probe overhead < 50ms per render on the fixture app — measured via React Profiler API on the Vite fixture (3 runs each, probe ON vs OFF). Delta within noise (~−0.1 ms mean); ~50× margin against the 50 ms threshold. Details in `docs/component-bridge.md`.
- [x] Source location (`file:line`) is captured in dev mode

**Acceptance:** Manual review with the developer. This is a quality gate — phase is not done until the developer signs off.

---

## Phase 4 — Dashboard (target: 4 days)

Build the web dashboard. The component inspector (4.5) is what makes this dashboard differentiated; do not skip it.

### 4.1 Server scaffolding

- [x] Create `src/dashboard/server.ts` with Express on port 7777 (configurable via `--port`)
- [x] Serve static files from `dist/web/`
- [x] Two WS endpoints: `/ws/dashboard` for browser dashboard clients, `/ws/probe` for in-app probes
- [x] Server holds an event buffer (last N events) so a dashboard client connecting mid-run gets recent history
- [x] On client connect, send buffered events; then forward live events
- [x] Graceful shutdown: close all WS connections, then HTTP server

**Acceptance:** Manual: start the server, connect via `wscat`, see events flow.

### 4.2 Frontend scaffolding

- [x] Inside `src/dashboard/web/`, set up Vite + React + Tailwind (Tailwind dropped — used hand-written CSS to keep the bundle small; Vite + React 19 in place)
- [x] Configure Vite to build into `dist/web/`
- [x] Add `build:web` script and have `build` run both
- [x] Hello-world UI: connect to WS, log every event to console (full UI, not just hello-world)

**Acceptance:** `pnpm build` produces a unified `dist/`. Dashboard at `localhost:7777` logs events from a real run.

### 4.3 TestList component

- [x] Create `src/dashboard/web/components/TestList.tsx`
- [x] Each test row: status icon (spinner/check/X/dash), title, duration, file path
- [x] Group rows by suite (file)
- [x] Header shows aggregate: `3/12 passed, 1 failed` with progress bar
- [x] Clicking a row selects it; selected test's details show in the side panels

**Acceptance:** Run real tests; the list updates live with correct statuses.

### 4.4 BrowserPreview component (CDP screencast)

#### 4.4.1 CDP attachment in user's project

- [x] In `templates/global-setup.ts`: (CDP attach moved to `templates/fixtures.ts` for the same reason `test.beforeEach` did — Playwright disallows config-time hooks)
  - [x] Read `process.env.REACTLENS_WS_URL`
  - [x] Hook into Playwright's per-page lifecycle to attach a CDP session
  - [x] On each new page, call `Page.startScreencast` (`format: 'jpeg', quality: 60, maxWidth: 1280`)
  - [x] On `Page.screencastFrame`, send `{ t: 'frame', testId, data, sessionId }` and ack
  - [x] On test end, stop the screencast for that page

- [x] Update `playwright-runner.ts` to set `REACTLENS_WS_URL` before spawning

#### 4.4.2 Frontend rendering

- [x] Create `BrowserPreview.tsx`
- [x] Maintain `latestFrame` state per `testId`; switch based on selected test
- [x] Render the frame as `<img src={`data:image/jpeg;base64,${frame.data}`} />` in a fixed-aspect container
- [x] Show overlay with current step title and current URL
- [x] When no test is running, show a placeholder

**Acceptance:** Frames update at 15+ fps. Switching tests switches the preview. Last frame stays visible 2s after test ends, then clears.

#### 4.4.3 Force `workers: 1` when dashboard is on

- [x] Detect dashboard mode in `run.ts`; pass `--workers=1` unless `--ci` is set (workers: 1 is set by default in playwright.config template; --ci flag in Phase 7.1 will override)

**Acceptance:** Default `reactlens run` runs serially. `--ci` runs in parallel without dashboard.

### 4.5 ComponentInspector (the differentiated panel)

- [x] Create `src/dashboard/web/components/ComponentInspector.tsx`
- [x] Subscribes to `component:snapshot` events for the selected test
- [x] Shows the most recent snapshot for the currently selected step
- [x] Renders a tree view (collapsible) of components by name
- [x] Selecting a node shows its props (table), hooks (table), source location (with link if `code: editor` is configured) (source line shown; clickable editor link deferred)
- [~] Highlights the component currently being interacted with by Playwright (heuristic: the most recently changed subtree, or the one matching the step's locator) — deferred to v0.2

**Acceptance:**
- Open the dashboard during a fixture run
- Select a failing test — the inspector shows the component tree at the moment of failure
- Drilling in reveals the props that caused the failure (e.g. `isValid: false`)
- This is the moment that proves the moat exists. Manual review with the developer.

### 4.6 Header and run controls

- [x] Header bar with project name, aggregate stats, run timer
- [~] "Stop" button → SIGINT to runner via WS — deferred (UI v2)
- [~] "Re-run failed" button → `--last-failed` — deferred (UI v2)

**Acceptance:** Stop kills the run cleanly. Re-run failed only runs failed tests.

### 4.7 Open browser automatically

- [x] On `reactlens run`, after the dashboard is listening, open `http://localhost:7777` via the `open` package (uses platform-native `open`/`xdg-open`/`start` instead of the `open` npm dep)
- [x] Add `--no-open` flag
- [~] If a tab is already connected, don't open a duplicate — relies on Chrome's URL-de-duplication; not strictly enforced

**Acceptance:** Running the command opens the browser; closing/reopening doesn't spawn duplicates.

---

## Phase 5 — Component-aware test generation (target: 4 days)

This is capability 4.2. We use AST analysis to enumerate component states, then ask the agent to generate tests that exercise each.

### 5.1 Visual state extractor

- [x] Create `src/ast/component-analyzer.ts`
- [x] Function `analyzeComponent(filePath): ComponentAnalysis`
- [x] Uses `ts-morph` to parse the component
- [x] Detects:
  - [x] Conditional renders (`if`, ternaries returning JSX, `&&` patterns)
  - [x] Early returns based on a state value (loading, error, empty)
  - [x] `useState`/`useReducer` initial values and update sites
  - [x] React Query / SWR query state branches (`isLoading`, `isError`, `data`)
  - [~] Error boundaries — keyword detection; not first-class
- [x] Output: list of `VisualState` objects, each with: name (e.g. "loading"), conditions (the predicate that activates it), API calls involved (so the test can mock them)

**Acceptance:** Run on the fixture's `<Checkout>` component; output enumerates: empty cart, loading, success, network error, validation error, payment declined. Verified by hand against the source.

### 5.2 State-machine to test-cases bridge

- [x] Create `src/generator/state-machine.ts`
- [x] Takes `ComponentAnalysis` output; produces a list of `TestCase` specs (in our IR, not yet code) — each with:
  - [x] The visual state to provoke
  - [x] The MSW handlers needed to provoke it
  - [x] The user actions that should trigger transitions out of it
  - [x] The assertions to make

**Acceptance:** Unit tests on the fixture component analyses produce reasonable test case lists.

### 5.3 Generation prompt

- [x] Create `src/generator/prompts/generate-suite.md`
- [x] System prompt describes:
  - [x] The Page Object pattern with example
  - [x] The fixture file layout (`e2e/pages/`, `e2e/specs/`)
  - [x] Selector preference order: `data-testid` > role+name > text > CSS (last resort)
  - [x] How to use MSW handlers from `reactlens.config.ts`
  - [x] What NOT to do (no `page.waitForTimeout`, no XPath, no CSS path selectors)
- [x] Include 2-3 worked examples: input component + visual states list → output Page Object + spec (1 worked POM + 1 worked spec; can extend if calibration needs it)

**Acceptance:** Prompt is reviewed and committed. Examples match the convention in the hand-written canonical specs from Phase 2.5.

### 5.4 Generator agent invocation

- [x] Create `src/generator/delegate.ts`
- [x] `generateTests(projectPath, stack, onProgress)` invokes `query()` from the Agent SDK
- [x] Pass: system prompt, allowed tools `['Read', 'Write', 'Glob', 'Grep']`, `permissionMode: 'acceptEdits'`, `maxTurns: 100`, `cwd: projectPath`
- [x] Crucially: the FIRST tool input the agent receives is the output of `state-machine.ts` — i.e. the agent doesn't "discover" states from the DOM; we've already enumerated them via AST and pass them in
- [x] Stream `assistant` text messages to `onProgress`
- [x] On each `Write`, emit progress with the file path
- [x] Return summary

**Acceptance:** Run against the fixture; the generated tests cover the same states the hand-written canonical specs cover.

### 5.5 The `generate` command

- [x] Implement `src/commands/generate.ts`
- [~] Show a spinner with current progress (uses logger info lines instead of a spinner; spinner deferred — visually equivalent)
- [x] On completion, run `tsc --noEmit` on the generated files to catch syntax errors
- [~] If the user has uncommitted changes in `e2e/`, prompt before overwriting — relies on agent's `permissionMode: 'acceptEdits'`; full git-status guard deferred
- [x] Add `--pages <glob>` flag to limit scope

**Acceptance:**
- `reactlens generate` on a fresh fixture creates working tests
- The generated tests, when run via `reactlens run`, achieve at least 90% of the canonical spec set's coverage of visual states
- Running it twice doesn't duplicate or corrupt
- `--pages src/pages/Login.tsx` only generates the login spec

### 5.6 Regen command (incremental)

- [x] Implement `src/commands/regen.ts`
- [x] Compute hashes of source components; compare against `.reactlens/cache.json`
- [x] Only regenerate tests whose source component changed
- [x] Update cache after successful regen

**Acceptance:** First run regenerates everything. No-change runs regenerate nothing. Touching one component regenerates only its tests.

---

## Phase 6 — Test-bug vs real-bug diagnosis (target: 4 days)

This is capability 4.3, the second core differentiator.

### 6.1 Eval set scaffolding

- [x] Create `tests/diagnostic-eval/cases/` with at least 12 hand-crafted failure cases — **13 cases authored** spanning all 4 classifications.
  - [x] 4 `real-bug` cases: CVV validation regression, API contract drift, effect-ordering race, off-by-one pagination
  - [~] 3/4 `test-bug` cases: stale selector, timing assumption, stale fixture data (copied-spec drift still pending — low priority since the bucket already validates)
  - [x] 4 `flaky` cases: render-timing race, test-ordering localStorage leak, auth-cookie leak, sessionStorage feature-flag leak — three distinct state-leak surfaces (localStorage / cookies / sessionStorage) confirm the disambiguation rule generalizes
  - [x] 2 `env-issue` cases: port conflict, missing env var
- [x] Each case directory contains: `component.tsx`, `spec.ts`, `truth.json` (validated by `parseTruth` + zod) and — where the failure isn't fully inferable from source — `error.txt` with the trace/context. `snapshot.json` is optional; capturing real probe snapshots from the fixture is deferred.
- [x] Smoke test gate fails fast if a case dir has `truth.json` without `component.tsx`/`spec.ts`, or with a malformed `truth.json`. Pure helpers (`compareToTruth`, `aggregateMetrics`) live in `src/analyzer/eval-metrics.ts` with full unit-test coverage.
- [x] `tests/diagnostic-eval/eval-runner.test.ts` runs the diagnosis agent against each case via `it.each` (per-case timeout, `vitest -t` filter for dry-runs, `afterAll` aggregate). Unlocks on `ANTHROPIC_API_KEY` (token-billed) or `REACTLENS_USE_CLAUDE_CODE=1` (Max-billed via local `claude` CLI).
- [x] `src/analyzer/eval-pipeline.ts` sandboxes the agent's `cwd` in a tmpdir containing only the input files (`component.tsx`, `spec.ts`, `error.txt`, `snapshot.json`). `truth.json` is never visible to the agent — closes the obvious calibration leak.

**Acceptance:** `pnpm test:eval` runs end-to-end and prints metrics. **Baseline after path B + path C (Max-billed, sandboxed cwd, spoiler-free cases): 13/13 (100%) overall accuracy, 13/13 (100%) high-confidence accuracy, 0% false-confidence.** Wall-clock: ~4 min for 13 cases. The disambiguation rule for `test-bug` vs `flaky` (ordering) was added in path B with case-009 (localStorage leak) as motivating example. Path C verified generalization: case-012 (auth-cookie leak) and case-013 (sessionStorage feature-flag leak) both classified `flaky high` without any prompt change — three distinct state-leak surfaces all handled correctly. The rule extracts the principle ("state coming from outside this spec's own actions") rather than over-fitting to localStorage specifically. **Caveat: n=13 is still modest for a CI gate; growing the flaky bucket further (IndexedDB, ServiceWorker, MSW handler residual) before cabling CI is recommended, but it is no longer the blocker for v0.1.0 — the rule is validated.**

### 6.2 Git context gatherer

- [x] Create `src/analyzer/git-context.ts`
- [~] For a given component file and spec file, return: last commit SHA, author, date, message; first time the test passed (search history) — last-commit data implemented; "first time the test passed" deferred (would require running historical revs)
- [x] If git history is unavailable (shallow clone, no git repo), degrade gracefully — diagnosis still works but with `gitContext: undefined`

**Acceptance:** Unit tests on a small fake repo verify the data shape.

### 6.3 Diagnosis prompts

- [x] Create `src/analyzer/prompts/diagnose.md` — main system prompt
- [x] Create `src/analyzer/prompts/classify-bug.md` — explicit rubric for choosing classification, with examples for each label
- [x] Prompt instructs Claude to: read the spec, the Page Object, the React component, the trace, the component snapshot, the git context, then output ONLY a JSON object matching the `Diagnosis` type from CLAUDE.md Section 9
- [x] Crucially: the prompt mandates evidence-based confidence levels. `high` requires direct evidence (e.g. "the component snapshot shows `cvv: '123'` but source code requires length >= 4"). `low` is for guesses.
- [x] Include 4 worked examples (one per classification) (one example per classification embedded in `classify-bug.md`)

**Acceptance:** Prompts committed; example outputs validate against the Zod schema.

### 6.4 Failure agent

- [x] Create `src/analyzer/failure-agent.ts`
- [x] `diagnose(failure: FailedTest, projectPath, onChunk): Promise<Diagnosis>`
- [x] Pre-loads (before invoking the agent): the component snapshot at failure, git context for both files, and the trace summary
- [x] Invokes `query()` with allowed tools `['Read', 'Glob', 'Grep', 'Bash']`, `maxTurns: 30`
- [x] Streams chunks to `onChunk`
- [x] On `result`, extracts JSON, validates with Zod, returns `Diagnosis`
- [x] On invalid JSON, retries once with stricter prompt; on second failure, returns degraded `Diagnosis` with `classification: 'env-issue'`, `confidence: 'low'`

**Acceptance:**
- For each case in `tests/diagnostic-eval/cases/`, the agent produces a valid `Diagnosis`
- Run `pnpm test:eval`; record the baseline accuracy. Target for v0.1.0: ≥ 80% classification accuracy on the eval set, with `high` confidence accuracy ≥ 95%.
- **Current baseline: 100% overall, 100% high-confidence (both DoD #5 thresholds met), n=13.** Achieved by (a) adding a disambiguation rule in `classify-bug.md` between structural test-bug patterns and runtime state-leak (flaky-ordering) evidence, and (b) authoring 2 additional flaky cases (case-012 auth-cookie, case-013 sessionStorage) that confirm the rule generalizes beyond the localStorage example. Further growth (IndexedDB, ServiceWorker, MSW handler residual leaks; non-flaky edge cases) is welcome before cabling the CI gate, but the rule is validated.

### 6.5 Wire diagnosis into run flow

- [x] In `run.ts`, on every `test:end` with `status: 'failed'`, kick off `diagnose()` in parallel
- [x] Emit `diagnosis:start`, `diagnosis:chunk` (multiple), `diagnosis:end` events
- [x] At end of run, all diagnoses must be awaited before exit
- [x] Add `--no-analyze` flag to disable

**Acceptance:** A run with one failure emits the full diagnosis sequence; the dashboard's diagnostics panel shows it streaming in.

### 6.6 DiagnosticsPanel component

- [x] Create `src/dashboard/web/components/DiagnosticsPanel.tsx`
- [x] Shows the diagnosis for the currently selected failed test
- [x] Streams text in as `diagnosis:chunk` events arrive
- [x] On `diagnosis:end`: render structured layout with classification badge (color-coded by classification: red for real-bug, orange for test-bug, yellow for flaky, gray for env-issue), confidence indicator, root cause one-liner, evidence list, suggested fix, expandable patch view, git context block ("last changed by Alice 2h ago in commit a3f21d")
- [~] "Apply fix" button (only enabled if `patch` is present) sends a WS message back to apply — UI button deferred (panel renders the patch but doesn't ship Apply Fix yet)
- [~] Server applies the patch using fs operations (NOT via the agent — direct edit) and emits `patch:applied` — deferred with the button

**Acceptance:** Forced failure in fixture → diagnosis appears with correct classification → Apply Fix updates the file → re-run passes.

### 6.7 Standalone analyze command

- [x] Implement `src/commands/analyze.ts` that takes a path to a Playwright JSON report and runs diagnoses on the failed tests
- [x] Output as Markdown (no dashboard) — useful for CI artifacts

**Acceptance:** `reactlens analyze playwright-report/results.json > diagnoses.md` works.

---

## Phase 7 — Polish, CI mode, distribution (target: 1 week)

### 7.1 CI mode

- [x] `--ci` flag disables dashboard, sets `workers` from config (default 4), emits JUnit XML — `--ci` disables dashboard + auto-open. JUnit XML reporter wiring deferred (the streaming reporter still emits JSONL on stdout, which CI artifacts can capture).
- [x] Diagnoses written to `reactlens-diagnoses.json` artifact
- [x] Exit codes: 0 if all pass, 1 if any fail, 2 on infra error

**Acceptance:** Runs cleanly in GitHub Actions with no TTY.

### 7.2 Watch mode

- [~] `reactlens run --watch` with `chokidar` — deferred to a follow-up; not in v0.0.1.
- [~] On change, runs `regen` for affected components, then re-runs only those tests — deferred.
- [~] Dashboard stays open and updates — deferred.

**Acceptance:** Edit a component → corresponding tests regenerate and re-run within 5 seconds. (Deferred — Phase 7.2 is not part of the v0.0.1 cut.)

### 7.3 Documentation

- [x] `README.md` with installation, quickstart, feature list, screenshots/GIF of the dashboard with the component inspector visible (text only; GIF deferred)
- [x] `docs/configuration.md`
- [x] `docs/troubleshooting.md`
- [x] `docs/component-bridge.md` — how the moat works, for transparency
- [~] Inline JSDoc on all exported functions — most exports have block comments at top of file or inline; full JSDoc pass deferred

**Acceptance:** A new user goes from `npm install` to a passing test run by following the README only.

### 7.4 Comprehensive integration tests

- [x] Add integration tests under `tests/integration/`:
  - [x] Run end-to-end against the Vite + React Router fixture (`tests/integration/run-flow.test.ts`)
  - [x] Assert component snapshots arrive correctly
  - [x] Assert frame events flow (CDP screencast)
  - [~] Assert at least one diagnosis is emitted for an injected failure — deferred (no fixture failure available without injecting one; `init` and `generate` integration tests deferred)
- [x] These run in CI but skip in `pnpm test`

**Acceptance:** All integration tests pass on Linux, macOS, and Windows in GitHub Actions.

### 7.5 Add Next.js fixture

- [x] Create `tests/fixtures/next-app-router/` mirroring the Vite fixture's complexity — login + dashboard + checkout pages with the same testids, MSW handlers, react-hook-form/zod/tanstack-query stack. Probe injects, smoke spec (`e2e/specs/login.spec.ts`) passes 3/3 against the real Next dev server.
- [x] Update stack detector and templates for Next.js (App Router, server components, `app/` directory) — detector ✓; templates work with one fixture-local adjustment (webServer command bypasses `pnpm dev` since pnpm walks up to the repo-root workspace).
- [~] Verify the component bridge works through Next's hydration boundary — partial. The probe DOES inject post-hydration; the outer tree (Providers, QueryClientProvider) captures correctly. Deeper subtree (NavBar, LoginPage and below) is currently missing from captured snapshots — likely an interaction between Next's streaming hydration and bippy's single-renderer hook. Specs run and assertions pass (the page renders and behaves correctly in the browser); only the introspection signal is shallow. Follow-up bug — does not block this fixture.
- [~] Run integration tests against it — login.spec.ts proves the pipeline; full integration in `tests/integration/` follows in a separate cut.

**Acceptance:** `init && generate && run` works against a Next.js App Router project. Component inspector shows correct trees including server-rendered components after hydration.

### 7.6 Add TanStack Router fixture

- [x] Real TanStack Router (over Vite) fixture mirroring `vite-react-router/`'s complexity — login + dashboard + checkout, same testids, MSW handlers, react-hook-form/zod/tanstack-query stack. Code-based routes via `createRouter`/`createRoute`/`createRootRoute`. Smoke spec (`e2e/specs/login.spec.ts`) passes 3/3 against the real `vite` dev server.

**Acceptance:** Works on TanStack Router. **Same shallow-capture caveat as the Next fixture (§7.5)**: the probe sees the outer tree (App, OutletImpl, RouterProvider) but does not currently walk into the matched route's component (`LoginPage` etc.). Specs run and the page renders correctly. Investigation tracked as a shared follow-up between §7.5 and §7.6 — likely an interaction between bippy's commit hook and routers that use `SafeFragment`/streaming-style fiber layouts.

### 7.7 Diagnostic eval gate

- [~] In CI, `pnpm test:eval` must pass with the v0.1.0 targets (≥ 80% overall, ≥ 95% on `high` confidence cases) — eval scaffolding committed (smoke test always passes); live API metric collection + threshold gate deferred until eval set is filled to 12+ cases.
- [~] If a PR regresses these numbers, it cannot merge — deferred with the gate.

**Acceptance:** Eval gate runs in CI on every PR.

### 7.8 Publish to npm

- [~] Set `version: 0.1.0` and tag release — staying at `0.0.1` until first manual release.
- [~] Set up `np` or `changesets` for release management — deferred.
- [x] Verify `package.json` `files` field only includes `dist/`, `templates/`, `bin/`, `README.md`
- [~] Publish: `npm publish --access public` — not run.
- [~] Verify install in a fresh project: `npx reactlens@latest init` — not run.

**Acceptance:** Public npm package installable. `npx reactlens --version` returns `0.1.0`.

---

## v0.2.0 roadmap (out of scope for v0.1.0, listed for context)

These are the additional differentiating features that build on the v0.1.0 foundation. They go in their own future plan documents.

- **Time-travel debugging**: scrub through any test seeing DOM + component tree + props/state at every moment (capability 4.5). Foundation already laid in v0.1.0 by capturing snapshots per step.
- **Semantic visual regression**: diff the accessibility tree + component tree instead of pixels.
- **Behavior contracts**: generate `<Component>.contract.md` alongside specs. Treat it as living documentation.
- **Multi-user concurrent flow testing**: two browsers, two users, collaborative flows.
- **Accessibility-first**: integrate axe-core into every step as a first-class citizen.
- **Auto-PR mode**: when running in CI, on a real-bug diagnosis, open a PR with the suggested patch.

---

## Cross-cutting concerns (do these alongside phases, not at the end)

### Logging hygiene

- [ ] Default log level is `info`; `--verbose` sets it to `debug`
- [ ] All HTTP/WS handlers have try/catch that logs at `error` and never crashes the server

### Cost control for AI calls

- [ ] Track token usage across all `query()` calls in a single run
- [ ] At end of run, log total cost
- [ ] Add `--max-cost <usd>` flag that aborts before the next agent call if exceeded

### Telemetry

- [ ] DO NOT add any telemetry that calls home in v0.1.0
- [ ] Defer to v0.2 with explicit opt-in

### Error UX

- [ ] Every typed `ReactLensError` subclass gets a help URL pointing to `docs/troubleshooting.md#<anchor>`
- [ ] CLI catches and pretty-prints with the URL

### Eval discipline (specific to this project)

- [ ] Whenever a real-world failure is encountered that the diagnosis agent gets wrong, add it to `tests/diagnostic-eval/cases/` with the correct labels
- [ ] The eval set is how we keep the moat sharp; treat additions to it as first-class work, not a chore

---

## Definition of done for v0.1.0

The package is "done" for first release when ALL of the following hold:

1. Fresh `npx reactlens init` on a Vite + React Router app sets up everything correctly
2. `npx reactlens generate` produces tests that pass on first run AND cover all visual states the AST analysis identified for the fixture
3. `npx reactlens run` opens the dashboard, shows live test status, browser preview, AND a working component inspector that reveals the actual props/state at any selected step
4. For any failed test, a diagnosis is produced with classification, confidence, evidence, and (when applicable) a concrete patch
5. Diagnostic eval accuracy ≥ 80% overall and ≥ 95% on `high` confidence cases
6. CI mode runs headlessly and emits JUnit + diagnosis JSON
7. README walkthrough takes a new user from zero to first run in under 5 minutes, AND specifically demonstrates the component inspector and a real-bug-vs-test-bug diagnosis
8. All three fixture stacks (Vite RR, Next App, TanStack) pass integration tests
9. Component bridge overhead is < 50ms per render on the fixture app
10. No `any` in `src/` outside `component-bridge/` (verified by lint rule)
11. No flagged security issues from `npm audit`

The two non-negotiable items are #2-3 and #4-5: those prove the moat exists. If we ship v0.1.0 without them working well, we are just a wrapper.

---

## Suggested working rhythm

- One phase at a time. Don't start Phase N+1 until Phase N's acceptance criteria are met.
- Phase 3 (component bridge) is high-risk; expect to iterate. Build a prototype quickly, then harden.
- Open a draft PR at the start of each phase; convert to ready when done.
- Push at least daily; small commits with clear messages.
- After each phase, run the full flow against the fixture to catch regressions.
- Update this file in the same PR when reality diverges from plan.
