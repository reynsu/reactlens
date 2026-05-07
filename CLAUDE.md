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
- **Local-first.** Everything runs on the developer's machine. No cloud.
- **Two questions answered, every time:** Is this a test bug or a real bug? Where exactly?
- **Page Object Model is the only test pattern we generate.** No exceptions.
- **The diagnosis is always actionable.** A diagnosis without a concrete suggested fix is a bug.
- **Zero-config for common React stacks** (Vite + React Router, Next.js App Router, TanStack Router).

### Non-goals

- We do NOT support Vue, Svelte, or Angular. Ever. The component-tree integration is React-specific and that is intentional.
- We do NOT support Cypress, WebdriverIO, or Selenium. Playwright only.
- We do NOT host anything in the cloud.
- We do NOT auto-apply fixes without explicit user confirmation.
- We do NOT replace developer judgment. Generated tests and diagnoses are starting points; humans review and approve.

---

## 4. The five differentiating capabilities

These are the features that justify the project's existence. Every line of code in this repository should ultimately serve one of them.

### 4.1 Component-aware test execution (CORE — v0.1.0)

During every test run, we capture the React component tree at every step:

- Which components are mounted
- What props they received
- What state and hooks they have
- The render path from root to the component being interacted with

We do this by injecting a hook into the running React app that connects to the same protocol React DevTools uses (the `__REACT_DEVTOOLS_GLOBAL_HOOK__` global). Snapshots are emitted as `component:snapshot` events alongside Playwright's normal events and stored with the trace.

This is the foundation everything else depends on.

### 4.2 Component-aware test generation (CORE — v0.1.0)

When generating tests, we don't just look at the rendered DOM. We:

- Parse the component source with `ts-morph` to find all `useState`, `useReducer`, conditional renders, error boundaries, query states (`isLoading`, `isError`, `isSuccess`)
- Enumerate the **set of visual states** the component can be in
- Generate tests that explicitly provoke each state (with MSW mocks for API states)

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
- **Component inspector** showing the React tree at the currently selected step, with props/state expandable per component

The component inspector is the part nobody else has. It looks like React DevTools but synced to the test timeline.

### 4.5 Time-travel debugging (v0.2.0)

Once we have screencast + component snapshots per step, a slider lets the developer scrub through any test and see the DOM, the component tree, and the props/state at every moment. This is roadmap, not v0.1, but the data we capture in v0.1.0 must be sufficient to support it later.

---

## 5. Tech stack (locked decisions)

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript (strict mode) | No `any` unless documented |
| Build | `tsup` | Fast, dual ESM/CJS output |
| CLI parsing | `commander` v12+ | Subcommands per action |
| Config validation | `zod` | Single source of truth |
| AI orchestration | `@anthropic-ai/claude-agent-sdk` | V1 `query()` API |
| Test runner | `@playwright/test` | Peer dependency; user installs |
| **AST parsing** | `ts-morph` | For component-aware generation |
| **React tree capture** | Custom probe + `bippy` lib | `bippy` provides safe access to React internals across versions |
| **API mocking** | `msw` | Generated tests use MSW handlers to provoke component states |
| Dashboard backend | `express` + `ws` | Plain WebSocket; no socket.io |
| Dashboard frontend | React 18 + Vite + Tailwind | Bundled at build time, served as static files |
| Process orchestration | `execa` | Better than child_process |
| Logging | `pino` | JSON logs, pretty in dev |
| Testing this package | `vitest` | Unit + integration |

### Key new dependencies and why

- **`ts-morph`**: stable AST API over TypeScript. Needed for capability 4.2 (enumerating component states from source). Lower-level alternatives like `@babel/parser` force walking untyped trees.
- **`bippy`**: small library that wraps React's internal fiber access in a version-safe way. Without it, every React minor version risks breaking our component tree capture. Use this rather than touching `__REACT_DEVTOOLS_GLOBAL_HOOK__` directly.
- **`msw`**: necessary because our generated tests need to mock APIs to provoke loading/error states. Generating tests that depend on a real backend would make them flaky and useless.

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
│   │   ├── run.ts
│   │   ├── analyze.ts
│   │   └── regen.ts
│   ├── runner/
│   │   ├── playwright-runner.ts
│   │   ├── reporter.ts
│   │   └── event-bus.ts
│   ├── component-bridge/         ← NEW: in-app probe
│   │   ├── probe.ts              ← injected into user's app
│   │   ├── snapshot.ts           ← serializes fiber tree
│   │   └── transport.ts          ← WS back to dashboard server
│   ├── ast/                      ← NEW: component analysis
│   │   ├── component-analyzer.ts ← extracts state machine from source
│   │   ├── route-analyzer.ts     ← finds routes per stack
│   │   └── visual-states.ts      ← enumerates render branches
│   ├── dashboard/
│   │   ├── server.ts
│   │   ├── web/
│   │   │   ├── index.html
│   │   │   ├── App.tsx
│   │   │   ├── components/
│   │   │   │   ├── TestList.tsx
│   │   │   │   ├── BrowserPreview.tsx
│   │   │   │   ├── ComponentInspector.tsx  ← NEW
│   │   │   │   ├── DiagnosticsPanel.tsx
│   │   │   │   └── TimelineSlider.tsx       ← v0.2.0 stub
│   │   │   └── main.tsx
│   │   └── terminal.tsx
│   ├── analyzer/
│   │   ├── failure-agent.ts
│   │   ├── git-context.ts        ← NEW: git blame & diff for diagnosis
│   │   └── prompts/
│   │       ├── diagnose.md
│   │       └── classify-bug.md   ← NEW: test-bug vs real-bug rubric
│   ├── generator/
│   │   ├── delegate.ts
│   │   ├── stack-detector.ts
│   │   ├── state-machine.ts      ← NEW: bridges AST → test cases
│   │   └── prompts/
│   │       └── generate-suite.md
│   ├── cdp/
│   │   └── screencast.ts
│   ├── config/
│   │   ├── schema.ts
│   │   └── load.ts
│   └── utils/
│       ├── logger.ts
│       └── paths.ts
├── templates/
│   ├── playwright.config.ts
│   ├── streaming-reporter.ts
│   ├── global-setup.ts            ← injects component bridge
│   └── reactlens.config.ts
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── diagnostic-eval/           ← NEW: ground-truth eval set
│   │   ├── cases/
│   │   │   ├── case-001-stale-selector/
│   │   │   ├── case-002-real-bug-validation/
│   │   │   └── ...
│   │   └── eval-runner.ts
│   └── fixtures/
│       ├── vite-react-router/
│       ├── next-app-router/
│       └── tanstack-router/
└── dist/
```

The two new directories beyond a traditional E2E tool layout are `src/component-bridge/` and `src/ast/`. These are where the moat lives. Treat them with extra care.

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
  // Run lifecycle
  | { t: 'run:start'; totalTests: number; timestamp: number }
  | { t: 'run:end'; passed: number; failed: number; skipped: number; duration: number }

  // Test lifecycle
  | { t: 'test:start'; id: string; title: string; file: string; suite: string }
  | { t: 'test:end'; id: string; status: 'passed' | 'failed' | 'skipped' | 'timedOut'; duration: number; error?: string; attachments?: Attachment[] }

  // Step lifecycle (within a test)
  | { t: 'step:start'; testId: string; stepId: string; title: string }
  | { t: 'step:end'; testId: string; stepId: string; status: 'passed' | 'failed' }

  // Browser preview
  | { t: 'frame'; testId: string; data: string /* base64 jpeg */; sessionId: string }

  // Component bridge — NEW for v0.1.0
  | { t: 'component:snapshot'; testId: string; stepId: string; tree: ComponentNode }
  | { t: 'component:event'; testId: string; stepId: string; kind: 'mount' | 'unmount' | 'update'; componentName: string; props?: Record<string, unknown> }

  // Diagnosis
  | { t: 'diagnosis:start'; testId: string }
  | { t: 'diagnosis:chunk'; testId: string; text: string }
  | { t: 'diagnosis:end'; testId: string; result: Diagnosis };

type ComponentNode = {
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

The `component:snapshot` data we capture during a test run is the foundation of everything. If our capture is incomplete or wrong, no amount of clever AI prompting will save us. If our capture is rich and accurate, even mediocre prompts produce useful results.

**Implication:** spend disproportionate engineering effort on the component bridge. Cut corners on the dashboard CSS first; on capture, last.

### Principle 2: Confidence must be calibrated, not asserted

A diagnosis that says "high confidence" must actually be right at high frequency. We maintain `tests/diagnostic-eval/` with hand-labeled failure cases. Before any release, we run the diagnosis agent against this set and measure accuracy per confidence level.

**Implication:** if we degrade calibration, we don't ship.

### Principle 3: Local-first, always

Everything runs on the developer's machine. The Anthropic API is the only network call we make, and only when the developer explicitly invokes generation or diagnosis. No telemetry. No cloud sync.

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
pnpm test:integration   # against fixtures (slow)
pnpm test:eval          # diagnostic accuracy eval (slow, costs API tokens)
pnpm build
pnpm build && cd ../some-react-app && pnpm link ../reactlens
pnpm build && node bin/reactlens.js run --cwd tests/fixtures/vite-react-router
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
- Do NOT touch `__REACT_DEVTOOLS_GLOBAL_HOOK__` directly. Use `bippy`.
- Do NOT change the event protocol (Section 9) without updating the runner, the bridge, the server, and the frontend in the same commit.
- Do NOT call `process.exit()` outside of `cli.ts`.
- Do NOT introduce barrel `index.ts` files.
- Do NOT auto-apply patches without explicit user confirmation.
- Do NOT hardcode model names outside of `src/config/`.
- Do NOT log API keys, file contents, or trace contents at `info` level.
- Do NOT ship a release with regressed diagnostic eval accuracy.
- Do NOT commit `dist/`, `node_modules/`, `.env`, or fixture playwright reports.

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
