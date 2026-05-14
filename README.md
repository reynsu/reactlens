# reactlens

**The first E2E testing tool that understands your React code, not just your DOM.**

Every existing E2E tool — Playwright, Cypress, QA Wolf — treats your app as a black box. They see HTML, accessibility trees, pixels. They never see what your code actually does: a tree of `<Component>`s with props, state, hooks, and a known relationship to your source files.

reactlens runs alongside Playwright and captures the React component tree, the accessibility tree, and axe-core findings at every test — and persists the whole run timeline so you can replay it offline. That changes what you can do:

- **Generate tests** that exercise every render branch — loading, error, empty, success — by reading your source via AST, not guessing from one DOM snapshot. Each component gets a `<Component>.contract.md` next to its spec, documenting the visual-state set reactlens enumerated.
- **Diagnose failures** by reading the actual prop that was wrong, the hook that returned bad data, the recent commit that touched the relevant file. Each diagnosis is classified `real-bug | test-bug | flaky | env-issue` with calibrated confidence (100% accuracy on the 16-case eval set).
- **Inspect** any test step in a live dashboard — DOM preview alongside the React tree at that moment, with all props and hook values visible. The active step highlights the exact fiber Playwright is interacting with, resolved via the probe-built testid → fiber map.
- **Replay past runs** offline. Every run writes its events + per-step frames to `.reactlens/runs/<id>/`; the dashboard picks them up from a dropdown and scrubs through with a timeline slider — no re-run needed.
- **Watch mode** (`--watch`): editing a file under `src/` or `e2e/` triggers an automatic re-run, debounced so two rapid saves yield one run.
- **Semantic diff** (`reactlens diff <runA> <runB>`): structural changes in the component tree AND the accessibility tree, not pixel-level noise. Catches regressions pixel diffing misses.
- **Built-in a11y**: axe-core runs against every test; violations land in the run timeline so the dashboard (and your CI) can surface them as first-class evidence.

## Status

reactlens is at **v0.2** — 7 of 9 v0.2 phases shipped (P8 → P13). The moat (component-tree integration) works end-to-end on **four fixture stacks**: Vite + React Router (React 18 and 19), Next.js 14 App Router, and TanStack Router. Time-travel replay, watch mode, behavior contracts, semantic diff (component + a11y), and per-test axe-core are all live. AI-driven generation and diagnosis are wired to the Anthropic API and ready for your `ANTHROPIC_API_KEY`. 137/137 unit + 8/8 integration green; 16/16 diagnostic-eval cases at 100% accuracy.

Remaining v0.2 work: P14 (CI Auto-PR mode, deferred), P15/P16 stretch (multi-user flows, opt-in telemetry).

## Install

```bash
pnpm add -D reactlens
npx reactlens init           # one-time setup: copies templates, installs Playwright + MSW
npx reactlens generate       # AI writes tests, reading your component tree + DOM
npx reactlens run            # opens the dashboard, runs tests, diagnoses failures
```

reactlens supports React 18 and React 19 projects on **Vite + React Router**, **Next.js 14 App Router**, and **TanStack Router** — full templates + integration coverage on all four stacks.

## Commands

| Command | What it does |
|---|---|
| `reactlens init` | Detects your stack, copies `playwright.config.ts`, `reactlens/fixtures.ts`, `reactlens/global-setup.ts`, `reactlens/streaming-reporter.ts`, `reactlens.config.ts` into your project. Installs `@playwright/test` and `msw`. |
| `reactlens generate` | For each component matching `componentGlobs`, AST-analyzes its visual states, then asks Claude to write a Page Object + spec covering all of them. Writes `<ComponentName>.contract.md` alongside each spec. Runs `tsc --noEmit` on output. Requires `ANTHROPIC_API_KEY`. |
| `reactlens run` | Starts the dashboard at `localhost:7777`, runs Playwright with the streaming reporter, captures component snapshots + CDP screencast frames + accessibility tree + axe-core violations, persists everything to `.reactlens/runs/<id>/`, and (when `ANTHROPIC_API_KEY` is set) diagnoses each failure with classification + confidence + suggested patch. Add `--watch` to re-run on file changes. |
| `reactlens diff <runIdA> <runIdB>` | Semantic diff between two persisted runs — component-tree changes (props, additions, removals) plus accessibility-tree changes (role/name/attr) per test. Exit code mirrors `git diff` (0 identical, 1 differences). `--json` for tooling. |
| `reactlens regen` | Hashes each component source, regenerates only those whose hash changed. Cache lives at `.reactlens/cache.json`. |
| `reactlens analyze <report>` | Reads a Playwright JSON report and writes a Markdown diagnostic summary for failed tests. Useful for CI artifacts. |

## Useful flags

- `reactlens run --watch` — after the initial run, re-run on changes under `<cwd>/src` and `<cwd>/e2e`. Debounced; Ctrl-C to exit.
- `reactlens run --ci` — no dashboard, no auto-open, writes diagnoses to `reactlens-diagnoses.json`.
- `reactlens run --no-analyze` — skip Claude diagnoses (and avoid API costs).
- `reactlens run --no-open` — keep the dashboard server alive but don't open a browser.
- `reactlens run --reporter json` — emit raw JSONL events on stdout (for piping).
- `reactlens run --max-cost <usd>` — hard cap on aggregate diagnosis spend; aborts at the next message boundary once exceeded. Same flag on `generate`/`analyze`/`regen`.
- `reactlens generate --pages 'src/pages/Login.tsx'` — limit generation to one component.
- `reactlens init --dry-run` — list what `init` would do without writing.
- `reactlens generate --use-claude-code` (and the same flag on `run`/`regen`/`analyze`) — route through your local `claude` CLI binary instead of the API. Bills against your Claude.ai/Max subscription; **local development only** — Anthropic's TOS prohibits this for distributed tools. See [docs/troubleshooting.md](docs/troubleshooting.md#use-claude-code).

## How the moat works

A small probe is bundled as an IIFE (`dist/probe/probe.global.js`, ~19 KB) and injected into every page during a test. It uses [`bippy`](https://github.com/aidenybai/bippy) to subscribe to React fiber commits, walks the tree on each render, sanitizes props/hooks, attributes every `data-testid` to its owning component fiber, and ships `component:snapshot` events over WebSocket to the dashboard server.

The Playwright fixture opens a CDP session at end-of-test to walk the accessibility tree (via `Accessibility.getRootAXNode` + recursive `getChildAXNodes`) and runs axe-core against the rendered DOM. Both feed the same event bus, so every persisted run carries: per-step component trees + DOM frames, an end-of-test a11y tree, and one event per axe violation. Time-travel replay reads it back from `.reactlens/runs/<id>/events.jsonl` without re-running Playwright.

Failure diagnosis pre-loads the latest snapshot for the failing test and hands it to the agent alongside the spec, the component source, and recent git history. The agent's classification is grounded in evidence visible in the snapshot — that's how it can tell `cvv: '12'` violates `min(3)` rather than guessing from the rendered DOM.

For full architecture, see [CLAUDE.md](./CLAUDE.md). For phase-by-phase progress and architecture diagrams, see the [project portal](./docs/portal/index.html).

## Visual overview

For a navigable bird's-eye view of the project — philosophy, architecture diagrams, current state across all phases (flowchart / kanban / timeline), animated dashboard mockup, usage scenarios — open the **[project portal](./docs/portal/index.html)** in your browser:

```bash
open docs/portal/index.html        # macOS
xdg-open docs/portal/index.html    # Linux
```

The portal is a static HTML doc with diagrams via Mermaid. No build step.

## Configuration

Create `reactlens.config.ts` (auto-generated by `init`):

```ts
import { defineConfig } from 'reactlens/config';

export default defineConfig({
  componentGlobs: ['src/pages/**/*.tsx', 'src/components/**/*.tsx'],
  output: { pages: 'e2e/pages', specs: 'e2e/specs' },
  msw: { handlers: 'src/mocks/handlers.ts' },
  dashboard: { port: 7777, open: true },
});
```

## Goals and non-goals

**Goals**
- React-only, deeply. The component-tree integration is the moat.
- Local-first. Everything runs on your machine. No telemetry.
- Two questions answered for every failure: is this a test bug or a real bug? Where exactly?
- Page Object Model is the only test pattern we generate.
- Zero-config for common React stacks.

**Non-goals**
- We do NOT support Vue, Svelte, or Angular.
- We do NOT support Cypress, WebdriverIO, or Selenium. Playwright only.
- We do NOT host anything in the cloud.
- We do NOT auto-apply fixes without explicit user confirmation.

## License

MIT
