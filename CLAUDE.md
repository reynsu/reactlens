# CLAUDE.md — reactlens

This file is the persistent context for Claude Code working on this project. Read it fully at the start of every session before making changes.

---

## 1. What this project is

`reactlens` is **the first E2E testing tool that understands your React code, not just your DOM**.

Every existing E2E tool — Playwright, Cypress, QA Wolf, Octomind, Mabl — treats the application as a black box. They see HTML, accessibility trees, and pixels. They never see what your tool sees: a tree of `<Component>`s with props, state, hooks, and a known relationship to your source files.

That is our entire moat. Everything we build flows from it.

The end-user experience is:

```bash
npm i -D reactlens
npx reactlens init       # one-time setup
npx reactlens generate   # AI writes tests by reading your component tree + DOM
npx reactlens run        # opens dashboard, runs tests, diagnoses failures
                         # with awareness of which props/state caused them
```

---

## 2. The thesis (read this twice)

A failing E2E test is, today, a stack trace and a screenshot. The developer must then answer two expensive questions:

1. **Is this a test bug or a real bug?** (90% of triage time)
2. **If it's a real bug, where in my code?** (the other 10%)

Existing tools cannot answer either question because they do not see the code. They guess from the DOM.

We see the code AND the DOM AND the component tree at every step of the test. That changes everything:

- We can generate tests that exercise **all branches** of a component, not just the one the LLM saw rendered when it loaded the page.
- We can diagnose failures by reading the actual prop that was wrong, the hook that returned bad data, the reducer action that was missed.
- We can tell you with high confidence whether the spec is broken or your code is broken — by cross-referencing git blame on both.

This is not "AI-powered Playwright with a nicer UI". This is a fundamentally different category of tool: one that has access to information competitors structurally cannot obtain.

---

## 3. Goals and non-goals

### Goals

- **React-only, deeply.** The component-tree integration is the moat. Don't dilute it.
- **Sovereignty-first.** No SaaS, no telemetry, no cloud sync — these are hard invariants. Offline operation is preserved for non-LLM commands (`run`, dashboard, replay, `diff`); LLM-backed features (`generate`, `diagnose`) require network and that is acknowledged, not hidden. See [ADR-0003](docs/adr/0003-sovereignty-first-not-offline-first.md).
- **Two questions answered, every time:** Is this a test bug or a real bug? Where exactly?
- **The moat is defined by serving diagnosis.** Every capability is evaluated by whether it makes diagnosis measurably better under the ablation methodology of [ADR-0001](docs/adr/0001-ablation-as-moat-metric.md). See [ADR-0008](docs/adr/0008-moat-is-defined-by-serving-diagnosis.md).
- **POM is the default test pattern; Component-Object Pattern is opt-in** for teams committed to reactlens. See [ADR-0006](docs/adr/0006-component-object-pattern-as-opt-in.md).
- **The diagnosis is always actionable.** A diagnosis without a concrete suggested fix is a bug. v0.3 closes the loop with apply-fix; see [ADR-0007](docs/adr/0007-close-the-diagnosis-loop-in-v0.3.md).
- **Zero-config for common React stacks** (Vite + React Router, Next.js App Router, TanStack Router).

### Non-goals

- We do NOT support Vue, Svelte, or Angular. Ever. The component-tree integration is React-specific and that is intentional.
- We do NOT support Cypress, WebdriverIO, or Selenium. Playwright only.
- We do NOT host anything in the cloud.
- We do NOT auto-apply fixes without explicit user confirmation.
- We do NOT replace developer judgment. Generated tests and diagnoses are starting points; humans review and approve.

---

## 4. Capabilities

The moat is not the list below. The moat is **work that makes diagnosis measurably better** — see [ADR-0008](docs/adr/0008-moat-is-defined-by-serving-diagnosis.md). Each capability below is tagged with its current classification:

- **[moat]** — directly serves diagnosis under the ablation methodology of [ADR-0001](docs/adr/0001-ablation-as-moat-metric.md).
- **[moat-adjacent]** — indirectly serves diagnosis (e.g. richer specs feed richer snapshots; replay surfaces past diagnoses).
- **[gray-zone]** — claim of moat status is unverified; current ablation may demote it to built-in.
- **[built-in convenience]** — useful, shipped, but does not differentiate. Not sold as a moat capability. See [ADR-0002](docs/adr/0002-table-stakes-vs-moat-capabilities.md).

Current classification (re-evaluated whenever the ablation methodology of ADR-0001 produces fresh evidence):

| Capability | Classification | Notes |
|---|---|---|
| 4.1 Component-aware execution | moat | Captures the signal diagnosis consumes |
| 4.2 Component-aware generation | moat-adjacent | Better tests → richer snapshots → better diagnosis |
| 4.3 Test-bug vs real-bug classification | moat | The diagnosis itself |
| 4.4 Dashboard with component inspector | moat-adjacent | Makes the diagnosed snapshot legible to the user |
| 4.5 Time-travel debugging | moat-adjacent | Replay surfaces past diagnoses without re-running |
| 4.6 Watch mode | built-in convenience | Any test runner has this |
| 4.7 Behavior contracts | moat-adjacent | Living doc of the AST→spec mapping; feeds generation, not diagnosis directly |
| 4.8 Semantic visual regression | mixed | Component-tree diff is moat; a11y-tree diff is gray-zone pending ablation |
| 4.9 Built-in accessibility (axe) | built-in convenience | `@axe-core/playwright` exists |

### 4.1 Component-aware test execution (CORE — v0.1.0) **[moat]**

During every test run, we capture the React component tree at every step:

- Which components are mounted
- What props they received
- What state and hooks they have
- The render path from root to the component being interacted with

We do this by injecting a hook into the running React app that connects to the same protocol React DevTools uses (the `__REACT_DEVTOOLS_GLOBAL_HOOK__` global). Snapshots are emitted as `component:snapshot` events alongside Playwright's normal events and stored with the trace.

This is the foundation everything else depends on.

### 4.2 Component-aware test generation (CORE — v0.1.0) **[moat-adjacent]**

When generating tests, we don't just look at the rendered DOM. We:

- Parse the component source with `ts-morph` to find all `useState`, `useReducer`, conditional renders, error boundaries, query states (`isLoading`, `isError`, `isSuccess`)
- Enumerate the **set of visual states** the component can be in
- Generate tests that explicitly provoke each state (with Playwright `page.route` mocks for API states)

A `<Checkout>` component yields tests for: empty cart, loading, success, network error, validation error per field, payment declined. Not just the happy path.

### 4.3 Test-bug vs real-bug classification (CORE — v0.1.0)

When a test fails, the diagnosis agent has access to:

- The component tree at the moment of failure
- The git history of both the component and the spec
- The component's source code

It produces a diagnosis with three possible classifications:

- **`real-bug`** — code regressed; spec is correct. Includes commit, author, and proposed code patch.
- **`test-bug`** — code is fine; spec is stale. Includes proposed spec patch.
- **`flaky`** — neither code nor spec changed; the failure is non-deterministic. Includes hypotheses (timing, data, ordering).

Confidence is `high | medium | low` and is calibrated against ground truth in `tests/diagnostic-eval/`. We never claim high confidence without evidence.

### 4.4 Live dashboard with component inspector (v0.1.0)

The dashboard runs at `localhost:7777` and shows three live panels:

- **Test list** with status (passed / failed / running) and duration
- **Browser preview** via CDP screencast (~30 fps)
- **Component inspector** showing the React tree at the currently selected step, with props/state expandable per component. The active step highlights the **exact owning fiber** (not a name heuristic) — the probe attributes every `data-testid` to its enclosing component fiber and ships a `testIdIndex` alongside each snapshot (P9, shipped v0.2).

The component inspector is the part nobody else has. It looks like React DevTools but synced to the test timeline.

### 4.5 Time-travel debugging (v0.2.0 — shipped)

A slider lets the developer scrub through any past test and see the DOM, the component tree, and the props/state at every step. Implementation (P8, 7 sub-tasks): every run gets a sortable `runId` and writes its full event stream + per-step JPEGs to `.reactlens/runs/<runId>/`. The dashboard exposes `GET /api/runs` + `/events` + `/frames/...` for past-run replay; a `RunPicker` in the header switches the reducer to replay mode (single-render hydration, WS gated). The `TimelineSlider` rewires head-of-test maps so existing rendering stays unchanged. A self-defensive `.reactlens/.gitignore` keeps run artifacts out of user repos regardless of upstream config.

### 4.6 Watch mode (v0.2.0 — shipped)

`reactlens run --watch` (P10): after the initial run, chokidar watches `<cwd>/src` and `<cwd>/e2e` and re-runs on any change (debounced 250 ms; `isRunning`/`pendingRerun` flags serialize re-runs). Dashboard + bus + cost tracker persist across iterations; each iteration rotates the persistor for a fresh `runs/<id>/` directory.

### 4.7 Behavior contracts (v0.2.0 — shipped)

Every `reactlens generate` (P11) writes `<ComponentName>.contract.md` next to the spec, documenting the visual-state set the AST analyzer enumerated — conditions, hooks, discovered endpoints. Living documentation of the AST→test mapping, legible to humans, not just the agent.

### 4.8 Semantic visual regression (v0.2.0 — shipped)

`reactlens diff <runIdA> <runIdB>` (P12): structural changes in the component tree (alignment by React key, ordinal fallback) AND the accessibility tree (alignment by role+name; reorders ignored). The fixture captures the a11y tree at end-of-test via CDP `Accessibility.getRootAXNode` + recursive `getChildAXNodes` and emits `a11y:snapshot`. Lower flake rate than pixel diffing because it ignores subpixel rendering, animation timing, and framework-internal object identity at non-semantic boundaries.

### 4.9 Built-in accessibility (v0.2.0 — shipped)

axe-core runs against the rendered DOM at end-of-test (P13). Each `result.violations[]` entry becomes one `a11y:violation` event (ruleId, impact, help, helpUrl, flattened CSS-selector targets) persisted alongside snapshots so dashboard + diff tooling can light up on regressions without a separate pipeline.

---

## 5. Tech stack (locked decisions)

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript (strict mode) | No `any` unless documented |
| Build | `tsup` | Fast, dual ESM/CJS output |
| CLI parsing | `commander` v12+ | Subcommands per action |
| Config validation | `zod` | Single source of truth |
| AI orchestration | `@anthropic-ai/claude-agent-sdk` | V1 `query()` API |
| Test runner | `@playwright/test` | Declared `peerDependency`; `reactlens init` installs it + the chromium browser (see [ADR-0010](docs/adr/0010-interpolate-detected-stack-into-scaffold-at-init.md)) |
| **AST parsing** | `ts-morph` | For component-aware generation |
| **React tree capture** | Custom probe + `bippy` lib | `bippy` provides safe access to React internals across versions |
| **API mocking** | Playwright `page.route` | Generated tests provoke component states via per-test route overrides. MSW removed from the out-of-the-box path — see [ADR-0011](docs/adr/0011-page-route-over-msw-for-state-provocation.md) |
| **File watching** | `chokidar` v5+ | Watch mode (capability 4.6); only cross-platform recursive watcher (`fs.watch` lacks recursive on Linux) |
| **Accessibility audit** | `axe-core` | Injected into the page at end-of-test for capability 4.9 |
| Dashboard backend | `express` + `ws` | Plain WebSocket; no socket.io |
| Dashboard frontend | React 18 + Vite + Tailwind | Bundled at build time, served as static files |
| Process orchestration | `execa` | Better than child_process |
| Logging | `pino` | JSON logs, pretty in dev |
| Testing this package | `vitest` | Unit + integration |

### Key new dependencies and why

- **`ts-morph`**: stable AST API over TypeScript. Needed for capability 4.2 (enumerating component states from source). Lower-level alternatives like `@babel/parser` force walking untyped trees.
- **`bippy`**: small library that wraps React's internal fiber access in a version-safe way. Without it, every React minor version risks breaking our component tree capture. Use this rather than touching `__REACT_DEVTOOLS_GLOBAL_HOOK__` directly.
- **Playwright `page.route`** (not `msw`): generated tests provoke loading/error/empty states with per-test route overrides. `page.route` is Playwright-native, needs no service worker, and requires zero wiring in the user's app — so it never has to touch a user-owned file. The earlier MSW plan was never implemented (no worker, no app bootstrap, no `?mocks=off` gate) and is removed from the out-of-the-box path. See [ADR-0011](docs/adr/0011-page-route-over-msw-for-state-provocation.md).
- **`chokidar`**: capability 4.6 (watch mode). `fs.watch({ recursive: true })` is unsupported on Linux, so the built-in API can't drive a portable watch loop. chokidar normalizes macOS FSEvents, Linux inotify, and Windows watchers under one event surface and handles debouncing + symlink edge cases.
- **`axe-core`**: capability 4.9 (a11y violations). Source bundled and injected into the page via `page.evaluate(axeSource)` at end-of-test — no separate runner. The fixture reads `REACTLENS_AXE_PATH` first (set by the runner for dev with pnpm strict isolation), then falls back to `require.resolve('axe-core/axe.min.js')` in user installs.

---

## 6. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  CLI: reactlens run                         │
└────────────────────────┬────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────────┐
        ▼                ▼                    ▼
┌──────────────┐  ┌──────────────┐  ┌────────────────────┐
│ Playwright   │  │ Dashboard    │  │ Component Bridge   │
│ Runner       │─▶│ (Express+WS) │◀─│ (in-app probe)     │
│              │  │              │  │                    │
│ + custom     │  │ React UI     │  │ Hooks into React   │
│   reporter   │  │  - Tests     │  │ DevTools protocol  │
│ + CDP        │  │  - Preview   │  │ Emits tree         │
│   screencast │  │  - Inspector │  │  snapshots per     │
│              │  │              │  │  test step         │
└──────┬───────┘  └──────┬───────┘  └─────────┬──────────┘
       │                 ▲                    │
       │                 │                    │
       └─────────────────┴────────────────────┘
                         │
                  Event bus (typed)
                         │
                         ▼
       ┌──────────────────────────────────────┐
       │ On failure: Diagnosis Agent          │
       │  - reads component source            │
       │  - reads spec                        │
       │  - reads git history of both         │
       │  - reads component snapshot at fail  │
       │  - reads trace                       │
       │  → outputs Diagnosis (typed)         │
       └──────────────────────────────────────┘
```

The new piece compared to a traditional architecture is the **Component Bridge**. It is a small JS file we inject into the user's app at test time. It hooks into the React DevTools protocol via `bippy`, captures component tree snapshots, and emits them on a WebSocket back to our dashboard server. Snapshots are tagged with the current test ID and step ID so they line up with Playwright events.

---

## 7. Repository layout

```
reactlens/
├── CLAUDE.md
├── EXECUTION_PLAN.md
├── package.json
├── tsup.config.ts
├── tsconfig.json
├── bin/
│   └── reactlens.js
├── src/
│   ├── cli.ts
│   ├── commands/
│   │   ├── init.ts
│   │   ├── generate.ts
│   │   ├── run.ts                ← watch loop + per-iteration persistor (P10)
│   │   ├── diff.ts                ← P12: reactlens diff <runA> <runB>
│   │   ├── analyze.ts
│   │   └── regen.ts
│   ├── agent/                    ← Claude orchestration layer
│   │   ├── runner.ts             ← AgentRunner interface (vendor-agnostic)
│   │   ├── sdk-runner.ts         ← SDK backend (per-token API billing)
│   │   ├── cli-runner.ts         ← CLI backend (subscription billing)
│   │   ├── select.ts             ← subscription-first selection + resolveAgentForCommand
│   │   ├── cost.ts               ← CostTracker + withCostTracking decorator
│   │   └── prompt-loader.ts      ← loadPromptSource: dual-layout dev/bundled prompt-file resolver (generator + internal-probe-bundle)
│   ├── diagnosis-run/              ← v0.3 #43-#47: deep Module owning the diagnosis pipeline (CONTEXT.md)
│   │   ├── run.ts                  ← createDiagnosisRun factory + DiagnosisIntent discriminated union (4 kinds)
│   │   ├── execute.ts              ← shared execute core: git-context + stream + JSON extract + Zod + retry; exports extractFinalJson
│   │   ├── prepare-post-mortem.ts  ← post-mortem intent prepare (commands/analyze.ts)
│   │   ├── prepare-live.ts         ← live intent prepare (commands/run.ts on-failure)
│   │   ├── prepare-eval-case.ts    ← eval-case intent: §13 Calibration fence (sandbox via sandboxDir, no truth.json)
│   │   └── prepare-ablation.ts     ← ablation intent: fence + Variant transform (generateVariant for without-snapshot)
│   ├── runner/
│   │   ├── playwright-runner.ts  ← stdin events validated via parseRunEvent
│   │   ├── reporter.ts
│   │   ├── event-bus.ts
│   │   ├── events.ts             ← canonical RunEvent + Zod runtime validation
│   │   ├── event-persistor.ts    ← P8.2: writes .reactlens/runs/<id>/ via RunPath
│   │   └── snapshot-sink.ts       ← --save-snapshots-to harvest
│   ├── runs/                     ← on-disk runs layout owner (write + read)
│   │   └── run-paths.ts          ← RunsArea + RunPath value objects
│   ├── component-bridge/         ← in-app probe
│   │   ├── probe.ts              ← injected into user's app
│   │   ├── snapshot.ts           ← serializes fiber tree + testIdIndex (P9)
│   │   └── transport.ts          ← WS back to dashboard server
│   ├── ast/                      ← component analysis
│   │   ├── component-analyzer.ts ← extracts state machine from source
│   │   └── route-analyzer.ts     ← finds routes per stack
│   ├── visual-states/            ← canonical visual-state catalog
│   │   └── visual-states.ts      ← single source: matchers + page.route recipe + assertions
│   ├── dashboard/
│   │   ├── server.ts             ← past-runs API routes via RunsArea
│   │   ├── web/
│   │   │   ├── index.html
│   │   │   ├── App.tsx           ← + replay mode, RunPicker wiring (P8.5)
│   │   │   ├── replay-timeline.ts ← P8.6: pure JSONL → TimelineStep[]
│   │   │   ├── components/
│   │   │   │   ├── TestList.tsx
│   │   │   │   ├── BrowserPreview.tsx ← FrameSource (base64 | url)
│   │   │   │   ├── ComponentInspector.tsx ← + exact testid match (P9)
│   │   │   │   ├── DiagnosticsPanel.tsx
│   │   │   │   ├── RunPicker.tsx          ← P8.5: past-run dropdown
│   │   │   │   └── TimelineSlider.tsx     ← P8.6: scrub replay steps
│   │   │   └── main.tsx
│   │   └── terminal.tsx
│   ├── analyzer/                   ← thin wrappers around diagnosis-run
│   │   ├── git-context.ts          ← git blame & diff for diagnosis (consumed by diagnosis-run/execute)
│   │   └── eval-pipeline.ts        ← runEvalCase: createDiagnosisRun + compareToTruth (~5 lines post-#45)
│   │   # tree-diff.ts, a11y-diff.ts → @reynsu/reactlens-diff-core (extracted, see §15)
│   │   # eval-metrics.ts → @reynsu/reactlens-diagnosis-prompts (extracted)
│   │   # prompts/diagnose.md, prompts/classify-bug.md → @reynsu/reactlens-diagnosis-prompts (extracted)
│   ├── eval/                     ← v0.3 #8: ablation harness + moat-contribution measurement
│   │   ├── eval-case-loader.ts          ← loadEvalCases: recursive walk; curated/uncurated tagging via `synthetic-from-corpus/` convention
│   │   ├── ablation-variant-generator.ts ← generateVariant: marker-driven strip for `without-snapshot` variant; throws on missing markers
│   │   ├── ablation-harness.ts          ← runAblation: (cases × variants) → AblationReport with per-class + per-confidence breakdowns
│   │   ├── ablation-cache.ts            ← createFileCache: sha256(component+spec+truth+variant) → `<root>/<hash>.json`
│   │   ├── case-sandbox.ts              ← sandboxDir / sandboxCase: §13 leak-fence used by diagnosis-run/prepare-{eval-case,ablation} (truth.json never copied)
│   │   ├── sandboxed-failure.ts         ← readSandboxedFailure: sandbox tmpdir → PublishedFailedTest; peer of sandboxDir, shared by both prepare-{eval-case,ablation}
│   │   └── ablation-report-formatter.ts ← formatAblationReport: pure byte-stable stdout transform
│   ├── generator/
│   │   ├── delegate.ts
│   │   ├── stack-detector.ts
│   │   ├── state-machine.ts      ← bridges AST → test cases
│   │   ├── contract.ts            ← P11: renders <Component>.contract.md
│   │   └── prompts/
│   │       └── generate-suite.md
│   ├── cdp/
│   │   └── screencast.ts
│   ├── config/
│   │   ├── schema.ts
│   │   └── load.ts
│   └── utils/
│       ├── logger.ts
│       ├── paths.ts              ← + ensureGitignore (P8.4)
│       └── run-id.ts             ← P8.1: generateRunId()
├── templates/
│   ├── playwright.config.ts
│   ├── streaming-reporter.ts
│   ├── global-setup.ts            ← injects component bridge
│   ├── fixtures.ts                ← + a11y tree capture (P12.2) + axe (P13)
│   └── reactlens.config.ts
├── tests/
│   ├── unit/
│   ├── helpers/
│   │   └── fake-agent.ts          ← scripted AgentRunner for boundary-parser tests
│   ├── integration/
│   │   ├── run-flow.test.ts       ← live WS protocol across 4 stacks
│   │   ├── replay-from-disk.test.ts ← P8.7: cold-open replay
│   │   └── watch-mode.test.ts     ← P10: re-run on file change
│   ├── diagnostic-eval/           ← ground-truth eval set (16 cases)
│   │   ├── cases/
│   │   │   ├── case-001-stale-selector/
│   │   │   ├── case-002-real-bug-validation/
│   │   │   └── ...
│   │   └── eval-runner.test.ts    ← live block gated via canResolveAgent
│   └── fixtures/
│       ├── vite-react-router/      ← React 18
│       ├── vite-react-router-19/   ← React 19 (Gap 6)
│       ├── next-app-router/
│       └── tanstack-router/
└── dist/
```

The directories beyond a traditional E2E tool layout where the moat lives: `src/component-bridge/`, `src/ast/`, `src/eval/` (the ablation harness — the rubric every v0.3 change is measured against per ADR-0001 / ADR-0008), the persistence layer in `src/runner/event-persistor.ts` + `src/runs/run-paths.ts`, and the runtime event-protocol enforcement in `src/runner/events.ts` (`runEventSchema` + `parseRunEvent`). Treat them with extra care.

**Runtime data layout**: every run writes to `<cwd>/.reactlens/runs/<runId>/` (per-run directory with `events.jsonl` + `frames/<testId>/<stepId>.jpg`). Auto-gitignored via a self-defensive `.reactlens/.gitignore` that ships `*` on first run.

---

## 8. Code conventions

### TypeScript

- `strict: true`. `noUncheckedIndexedAccess: true`. No `any` outside of the React-internals shim layer (`component-bridge/`).
- Prefer `type` over `interface` unless declaration merging is needed.
- Discriminated unions for events. Every event has a literal `t` field.
- No default exports except for the Playwright reporter (Playwright requires it).
- No barrel `index.ts` files.

### Naming

- Files: `kebab-case.ts`
- Types and components: `PascalCase`
- Functions and variables: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE` only for true constants

### Error handling

- Throw typed errors that extend `ReactLensError`. Never plain `Error`.
- At the CLI boundary, catch all errors, pretty-print, exit code accordingly.
- Inside agent calls, never let an unhandled rejection kill the run.

### Commits

- Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`
- Scope when meaningful: `feat(component-bridge): capture hooks state`
- One logical change per commit.

---

## 9. The event protocol (critical, do not change casually)

Everything that flows between the runner, the dashboard server, the dashboard frontend, and the component bridge uses this exact shape.

```ts
type RunEvent =
  // Run lifecycle. runId added v0.2 (P8.1) — sortable ISO+hex string,
  // doubles as the directory key for .reactlens/runs/<runId>/.
  | { t: 'run:start'; runId: string; totalTests: number; timestamp: number }
  | { t: 'run:end'; passed: number; failed: number; skipped: number; duration: number }

  // Test lifecycle
  | { t: 'test:start'; id: string; title: string; file: string; suite: string }
  | { t: 'test:end'; id: string; status: 'passed' | 'failed' | 'skipped' | 'timedOut'; duration: number; error?: string; attachments?: Attachment[] }

  // Step lifecycle (within a test)
  | { t: 'step:start'; testId: string; stepId: string; title: string }
  | { t: 'step:end'; testId: string; stepId: string; status: 'passed' | 'failed' }

  // Browser preview
  | { t: 'frame'; testId: string; data: string /* base64 jpeg */; sessionId: string }

  // Component bridge — v0.1.0. testIdIndex added v0.2 (P9): probe-built
  // map of data-testid → ComponentNode.id of the nearest enclosing
  // component fiber. Optional for back-compat with pre-P9 persisted runs.
  | {
      t: 'component:snapshot';
      testId: string;
      stepId: string;
      tree: ComponentNode;
      testIdIndex?: Record<string, string>;
    }
  | { t: 'component:event'; testId: string; stepId: string; kind: 'mount' | 'unmount' | 'update'; componentName: string; props?: Record<string, unknown> }

  // Accessibility — v0.2 (P12.2 + P13). a11y:snapshot is the end-of-test
  // ax tree captured via CDP Accessibility.getRootAXNode + recursive
  // getChildAXNodes; a11y:violation is one event per axe-core finding.
  | { t: 'a11y:snapshot'; testId: string; stepId: string; tree: AxNode }
  | {
      t: 'a11y:violation';
      testId: string;
      stepId: string;
      ruleId: string;
      impact: 'minor' | 'moderate' | 'serious' | 'critical' | null;
      description: string;
      help: string;
      helpUrl: string;
      targets: string[];  // flattened CSS selector paths
    }

  // Diagnosis
  | { t: 'diagnosis:start'; testId: string }
  | { t: 'diagnosis:chunk'; testId: string; text: string }
  | { t: 'diagnosis:end'; testId: string; result: Diagnosis };

type ComponentNode = {
  // Per-snapshot stable id assigned by the probe (P9). Optional on the
  // wire so older persisted runs still parse. Used by testIdIndex.
  id?: string;
  name: string;            // component display name
  key?: string | null;
  props: Record<string, unknown>;  // serialized, depth-limited
  hooks?: HookSnapshot[];          // captured via React DevTools protocol
  source?: { file: string; line: number };  // when available
  children: ComponentNode[];
};

type HookSnapshot = {
  kind: 'state' | 'effect' | 'memo' | 'ref' | 'context' | 'reducer' | 'other';
  value?: unknown;
  name?: string;  // when source-mapped (e.g. "useAuthStatus")
};

// Accessibility tree node — mirrors Playwright's a11y snapshot shape
// (subset of the W3C ARIA tree). Captured at end-of-test via CDP because
// page.accessibility.snapshot() was removed in Playwright 1.45+.
type AxNode = {
  role: string;
  name?: string;
  value?: string | number;
  description?: string;
  // … 20 standard ARIA attrs: disabled, expanded, focused, checked,
  // pressed, level, valuemin/max, autocomplete, haspopup, invalid,
  // orientation, etc. See src/runner/events.ts for the full list.
  children: AxNode[];
};

type Diagnosis = {
  classification: 'real-bug' | 'test-bug' | 'flaky' | 'env-issue';
  confidence: 'high' | 'medium' | 'low';
  rootCause: string;            // one-sentence summary
  evidence: string[];           // bullet points, what we actually saw
  suggestedFix: string;         // human-readable description
  patch?: {
    file: string;
    oldStr: string;
    newStr: string;
    rationale: string;
  }[];
  gitContext?: {
    componentLastChanged?: { sha: string; author: string; date: string; message: string };
    specLastChanged?: { sha: string; author: string; date: string; message: string };
  };
};
```

Discriminate on `t`. Every frontend handler MUST use exhaustive switch.

---

## 10. Design principles (the rules that guide every decision)

### Principle 1: Capture is sacred, processing is replaceable

The `component:snapshot` data we capture during a test run is the foundation of everything *as long as it reaches diagnosis*. If our capture is incomplete or wrong, no amount of clever AI prompting will save us. If our capture is rich and accurate but never makes it into the diagnosis prompt, it is not actually sacred — it is dead weight that we keep capturing out of habit. Per [ADR-0008](docs/adr/0008-moat-is-defined-by-serving-diagnosis.md), the test for whether a capture signal is sacred is whether removing it from the diagnosis prompt degrades accuracy under the ablation methodology of [ADR-0001](docs/adr/0001-ablation-as-moat-metric.md).

**Implication:** spend disproportionate engineering effort on the component bridge *and* on the diagnosis prompt that consumes it. Cut corners on the dashboard CSS first; on the capture → diagnosis pipeline, last.

### Principle 2: Confidence must be calibrated, not asserted

A diagnosis that says "high confidence" must actually be right at high frequency. We maintain `tests/diagnostic-eval/` with labeled failure cases (grown via dogfooding and corpus harvest per [ADR-0004](docs/adr/0004-eval-growth-via-dogfooding-and-corpus-harvest.md)). Before any release, we run the diagnosis agent against this set in both `with-snapshot` and `without-snapshot` modes and measure accuracy per confidence level **and the moat-contribution delta**.

**Implication:** if we degrade calibration, we don't ship. If a change does not move the moat-contribution delta in the intended direction, it is not moat work even if it touches the probe.

### Principle 3: Sovereignty-first (not necessarily offline-first)

Three properties, in priority order:

1. **No SaaS, no proprietary lock-in.** The repository the developer runs is complete. There is no backend that could be shut down. This is a hard invariant.
2. **No telemetry, no data egress without explicit invocation.** The developer's code is not uploaded to any service unless they explicitly run an LLM-backed command. This is a hard invariant.
3. **Offline operation is preserved for non-LLM commands.** `run`, dashboard, replay, `diff`, and reading existing contracts work without network. `generate` and `diagnose` require an LLM (Anthropic API by default, or the user's local `claude` CLI via `--use-claude-code`) and may therefore require network. This is acknowledged, not hidden — it is *not* a violation of the philosophy.

The `--use-claude-code` flag is part of the sovereignty story, not a developer-convenience footnote: if the user already pays for Claude Max, reactlens uses that session instead of double-billing. See [ADR-0003](docs/adr/0003-sovereignty-first-not-offline-first.md).

### Principle 4: One framework, deeply

Every time we are tempted to "make it work for Vue too", we lose part of our moat. The component bridge depends on React-specific internals and that is the entire point.

### Principle 5: The diagnosis is always actionable

A diagnosis without a concrete suggested fix is a bug in our system. If we cannot produce a patch, we say so explicitly and explain what additional information would let us produce one — never a wishy-washy "it might be a timing issue, try adding waits".

---

## 11. Common commands while developing

```bash
pnpm install
pnpm dev                # rebuild on save
pnpm typecheck
pnpm test               # unit
pnpm test:integration   # against fixtures (slow ~60 s; serial — fileParallelism: false)
pnpm test:eval          # diagnostic accuracy eval (slow, costs API tokens)
pnpm build
pnpm build && cd ../some-react-app && pnpm link ../reactlens
pnpm build && node bin/reactlens.js run --cwd tests/fixtures/vite-react-router

# v0.2 capabilities (P8 — P13)
pnpm build && node bin/reactlens.js run --cwd <app> --watch          # re-run on src/ + e2e/ changes
pnpm build && node bin/reactlens.js diff <runIdA> <runIdB> --cwd <app>  # semantic diff (component + a11y)
```

---

## 12. What to do when stuck

1. Read `EXECUTION_PLAN.md` — every task has acceptance criteria.
2. Read the templates — they are the contract with the user's project.
3. Check `tests/fixtures/` — the canonical test subjects.
4. Check `tests/diagnostic-eval/cases/` — for diagnosis-related work, these labeled cases are the spec.
5. Search recent commits — `git log --oneline -20` often reveals prior attempts.
6. Ask the developer.

---

## 13. Things you must not do

- Do NOT broaden scope beyond React. Reject "what about Vue?" with a pointer to Section 3.
- Do NOT label work as moat / differentiator unless it makes diagnosis measurably better under the ablation methodology of [ADR-0001](docs/adr/0001-ablation-as-moat-metric.md). The rubric is: *does this work make diagnosis better?* See [ADR-0008](docs/adr/0008-moat-is-defined-by-serving-diagnosis.md).
- Do NOT market as a differentiator anything a competitor with Playwright + npm can replicate in under a day. Such features ship as "Built-in conveniences" in §4, not as moat. See [ADR-0002](docs/adr/0002-table-stakes-vs-moat-capabilities.md).
- Do NOT touch `__REACT_DEVTOOLS_GLOBAL_HOOK__` directly. Use `bippy`.
- Do NOT change the event protocol (Section 9) without updating the runner, the bridge, the server, and the frontend in the same commit.
- Do NOT bypass `parseRunEvent` at any ingestion point that converts untyped JSON into a `RunEvent`. The boundary parser is the single source of runtime validation; new ingestion points (CI artifact upload, future probes) MUST go through it.
- Do NOT let ANTHROPIC_API_KEY presence in the environment force API billing. Subscription (Claude Code CLI) is the default. API billing requires explicit opt-in via `--force-api` or `REACTLENS_FORCE_API=1` per Anthropic's documented pitfall.
- Do NOT call `process.exit()` outside of `cli.ts`.
- Do NOT introduce barrel `index.ts` files.
- Do NOT auto-apply patches without explicit user confirmation.
- Do NOT hardcode model names outside of `src/config/`.
- Do NOT log API keys, file contents, or trace contents at `info` level.
- Do NOT ship a release with regressed diagnostic eval accuracy.
- Do NOT commit `dist/`, `node_modules/`, `.env`, or fixture playwright reports.
- Do NOT add `truth.json` to `SANDBOX_INPUTS` in `src/eval/case-sandbox.ts`, nor build a separate code path that copies it into the agent-visible cwd. The diagnosis agent has `Read` in its allowedTools; making truth.json reachable trivially leaks the expected answer and the eval becomes a calibration disaster (Principle 2 / ADR-0008). The single test that locks this is `tests/unit/case-sandbox.test.ts` — never relax that assertion.

---

## 14. Glossary

- **Spec** — a Playwright test file (`*.spec.ts`)
- **POM** / **Page Object** — class encapsulating a screen's selectors and actions
- **Fixture** (in this codebase) — sample React app under `tests/fixtures/`
- **Component bridge** — the in-app probe that captures the React tree
- **Snapshot** — one capture of the component tree at a specific test step
- **Visual state** — one possible render branch of a component (loading, error, empty, etc.)
- **State machine** — the enumerated set of visual states for a component, derived by AST analysis
- **Diagnosis** — Claude's classified analysis of one failure
- **Classification** — `real-bug | test-bug | flaky | env-issue`
- **Eval set** — `tests/diagnostic-eval/cases/`, hand-labeled failures used to measure diagnosis accuracy
- **Run id** — sortable ISO-timestamp + 8-hex suffix; doubles as the directory key for `.reactlens/runs/<runId>/` (v0.2 / P8.1).
- **Persisted run** — the on-disk artifact for a single Playwright invocation: `events.jsonl` + `frames/<testId>/<stepId>.jpg`. Source of truth for time-travel replay.
- **Replay mode** — dashboard mode where the reducer hydrates from a past run's JSONL instead of the live WS. Activated by selecting a run in the `RunPicker`.
- **testIdIndex** — probe-built `Record<testid, fiberId>` shipped with each `component:snapshot`; lets the inspector resolve a Playwright locator to the exact owning fiber (v0.2 / P9).
- **Behavior contract** — `<ComponentName>.contract.md` written next to each generated spec, documenting the visual-state set the analyzer enumerated (v0.2 / P11).
- **Semantic diff** — structural difference between two persisted runs over the component tree AND the a11y tree, exposed by `reactlens diff`. Not pixel-level (v0.2 / P12).
- **A11y violation** — one axe-core finding emitted per test as an `a11y:violation` event (v0.2 / P13).
- **DiagnosisRun** — `src/diagnosis-run/`. The deep Module owning the diagnosis pipeline; see [CONTEXT.md](CONTEXT.md) for the domain vocabulary (`DiagnosisRun`, `DiagnosisIntent`, `Variant`, `FailedTest` internal, `Calibration fence`). External Interface: `createDiagnosisRun({ agent }).run(intent, { onChunk? })`. Four intent kinds (`post-mortem`, `live`, `eval-case`, `ablation`) share an execute core (folded from the pre-#47 `runAgentJson` + `diagnose()`).
- **loadPromptSource** — `src/agent/prompt-loader.ts`. Dual-layout (bundled CLI / dev tsx) prompt-file resolver. Consumed by `src/generator/delegate.ts` and `src/commands/internal-probe-bundle.ts`. NOT used by DiagnosisRun — its system prompts ship as plain text constants from `@reynsu/reactlens-diagnosis-prompts`.
- **RunsArea / RunPath** — `src/runs/run-paths.ts`. Per-cwd / per-run value objects that own the `.reactlens/runs/<id>/` layout. Single source for ID validation (read-side `assertSafeId` + write-side `sanitizeSegment`), eager `.gitignore` write, and the runs-listing API.
- **runEventSchema / parseRunEvent** — `src/runner/events.ts`. Runtime Zod validator for the canonical `RunEvent` union. Enforced at every untyped ingestion point (Playwright stdin, WS probe, persisted JSONL replay). Bidirectional compile-time guard keeps the schema and the TS union aligned.
- **VISUAL_STATES catalog** — `src/visual-states/visual-states.ts`. Single source for per-visual-state data: matcher regex, description, `page.route` recipe, assertions. Adding a state is one row; component-analyzer and state-machine import from it as peers.
- **AblationHarness** — `src/eval/ablation-harness.ts`. The moat-contribution measurement. `runAblation({cases, agent, cache?})` loops every (case × variant) tuple, optionally short-circuits through `AblationCache`, and emits an `AblationReport` with overall + per-classification + per-confidence breakdowns. Post-#46 the harness owns DiagnosisRun construction internally; the pre-#47 `DiagnoseFn` injection seam is gone. The single number reactlens claims publicly (per ADR-0008) — its accuracy delta with vs without the component snapshot.
- **AblationCache** — `src/eval/ablation-cache.ts`. `createFileCache({root})` returns an `AblationCache` keyed by `sha256(component.tsx + spec.ts + truth.json + variant)`. Content-hashing means automatic invalidation when a case input changes; persists at `<root>/<hash>.json` (production: `<cwd>/.reactlens/eval-cache/`). Issue #8 acceptance: re-running with no input changes does not re-invoke the agent.
- **Calibration (AblationReport field)** — `src/eval/ablation-harness.ts`. Optional secondary metric on `AblationReport` (NOT in headline, NOT in CI gate — ADR-0001 intentionally unchanged). Three counts over paired curated cases: `speculativeHighCount` (without-snapshot emits 'high' while with-snapshot emits less), `confidenceBoostCount` (with-snapshot strictly exceeds without-snapshot), `confidenceMatchCount` (both equal). Plus rates derived from paired-case denominator. Catches the moat signal `accuracy + falseConfidenceRate` is structurally blind to: cases where both variants classify correctly but the snapshotless agent is over-confident (case-020 in `finding_ablation_delta_zero.md`). Old baselines without this field are tolerated — `compareToBaseline` ignores it. Graduates to headline + ADR-0001 amendment when enough datapoints accumulate (deferred to operator judgment).
- **sandboxDir / sandboxCase** — `src/eval/case-sandbox.ts`. The §13 Calibration fence used by `diagnosis-run/prepare-{eval-case,ablation}`. Copies `SANDBOX_INPUTS` (component.tsx, spec.ts, error.txt?, snapshot.json?) from `srcDir` into a fresh mkdtempSync dir; CRITICALLY excludes `truth.json` so the diagnosis agent's Read tool can't trivially copy the expected answer. Adding to `SANDBOX_INPUTS` is a calibration-surface change. `sandboxDir(srcDir)` is the path-only variant DiagnosisRun uses; `sandboxCase(EvalCase)` wraps it for legacy EvalCase-shaped callers (currently none in production).
- **readSandboxedFailure** — `src/eval/sandboxed-failure.ts`. Peer of `sandboxDir`: reads a sandbox tmpdir (component.tsx / spec.ts / error.txt? / snapshot.json?) into a `PublishedFailedTest`. Shared by both `diagnosis-run/prepare-eval-case` and `diagnosis-run/prepare-ablation` — previously lived inside `prepare-eval-case` and prepare-ablation imported across the sibling seam, which was a leak between two DiagnosisRun-internal peer modules. The §13 fence is enforced one level up by `case-sandbox.ts` (truth.json is not in `SANDBOX_INPUTS`, so it is never present in the sandbox), so this module has no way to read it even accidentally.
- **formatAblationReport** — `src/eval/ablation-report-formatter.ts`. Pure byte-stable `AblationReport → string` transform that produces the stdout output issue #8 specifies (overall accuracy delta, false-confidence delta, per-classification, per-confidence). Empty buckets render as `— (no cases)` not `0%` to avoid phantom-regression-chasing.
- **REACTLENS_ABLATION / REACTLENS_ABLATION_UPDATE_BASELINE** — env flags that gate the ablation block in `tests/diagnostic-eval/eval-runner.test.ts`. `REACTLENS_ABLATION=1` unlocks the block (loads cases, runs harness, prints `formatAblationReport`). `REACTLENS_ABLATION_UPDATE_BASELINE=1` additionally rewrites `tests/diagnostic-eval/ablation-baseline.json` (use once per intentional recalibration; NEVER in CI — slice #14 compares against the checked-in baseline).

---

## 15. Ecosystem packages — 2026-05 amendment

Pieces of this repo that two consumers needed (reactlens itself + the nativelens sibling) have been lifted to standalone published packages. The cross-repo decision lives in the nativelens ADR-0002 (`docs/adr/0002-selective-extraction-from-reactlens.md` in that repo). Reactlens-side notes:

- **`@reynsu/reactlens-diagnosis-prompts`** — prompts + `DiagnosisSchema` + classification rubric + eval scoring. Consumed since the swap PR; previously lived at `src/analyzer/prompts/` + `src/analyzer/eval-metrics.ts`. Repo: [github.com/reynsu/reactlens-prompts](https://github.com/reynsu/reactlens-prompts).
- **`@reynsu/reactlens-diff-core`** — `diffComponentTree` + `diffA11yTree` + their `SemanticDiff` types. Previously lived at `src/analyzer/{tree,a11y}-diff.ts`. Repo: [github.com/reynsu/reactlens-diff-core](https://github.com/reynsu/reactlens-diff-core).
- **`@reynsu/nativelens-event-protocol`** — sibling repo's protocol package; not yet consumed by reactlens. Reactlens' `src/runner/events.ts` is currently a superset (adds `ComponentNode`, `AxNode`, frame, a11y-violation, etc.) and will migrate once the published surface covers those shapes via a coordinated bump.

**Why `@reynsu/` scope, not `@reactlens/`.** The `@reactlens` npm scope is unclaimed and creating an npm org for tiny packages was more ceremony than warranted; the user already publishes under `@reynsu/`. When the scope is eventually claimed, a coordinated rename bumps the published packages and the workspace deps become one-line changes.

**Why `zod` is a peerDependency on `@reynsu/reactlens-diagnosis-prompts` (0.2.0 vs 0.1.0).** Reactlens uses zod 4; nativelens uses zod 3. The 0.1.0 publish hardcoded zod 3 → two-zod hell with reactlens. 0.2.0 moved zod to `peerDependencies: ">=3.23.8 <5"`. The surface uses only stable zod APIs (`object`, `enum`, `optional`, `infer`, `discriminatedUnion`) verified compatible across majors.

**Dashboard extraction shipped against the original deferral.** The original three-package plan included `@reactlens/dashboard` (Express + ws + React/Vite/Tailwind frontend, per nativelens ADR-0007). The decision recorded earlier in this section was to defer until nativelens P6 started. That deferral was overridden — `@reynsu/reactlens-dashboard-ui` was extracted ahead of schedule (commits `2a1bf68` + `0f811e7`) and is consumed by reactlens via the `feature/consume-dashboard-ui` branch. Nativelens P6/P7 has not started, so the package still has only one production consumer. This is documented as a known disonance, not endorsed — see [ADR-0005](docs/adr/0005-pause-package-extractions.md), which both captures the lesson and pauses further extractions.

**Soft guideline: pause new `@reynsu/*` extractions until existing packages prove their reuse claim.** No new code is extracted from reactlens into a published `@reynsu/*` package until at least two production consumers — or one production consumer with a written commitment to ship within 60 days — have validated the existing API surface of the previously-extracted packages (`diagnosis-prompts`, `diff-core`, `dashboard-ui`). This is a guideline in this section, not an invariant in §13: a PR that violates the rule is *discussed* with a recorded justification, not auto-rejected. See [ADR-0005](docs/adr/0005-pause-package-extractions.md) for rationale and the open `feature/consume-dashboard-ui` branch as a symptom of the cost of ignoring it.
