# How the component bridge works

The "moat" of reactlens is the component bridge: a tiny script (~19 KB IIFE) that captures your React component tree at every step of every test. This document explains how it works, in case you want to debug it or contribute.

## Anatomy

```
┌──────────────────────────────────────┐
│  src/component-bridge/probe.ts       │  Bundled to dist/probe/probe.global.js
│   ├── bippy.instrument()             │  Subscribes to React fiber commits
│   ├── serializeFiber(root)           │  → snapshot.ts: walks the tree, sanitizes props/hooks
│   └── transport.send(snapshot)       │  → transport.ts: throttled WS client
└─────────────────┬────────────────────┘
                  │ WebSocket
                  ▼
┌──────────────────────────────────────┐
│  src/dashboard/server.ts             │  Express + ws server on :7777
│   /ws/probe         ← receives       │
│   /ws/dashboard     → broadcasts     │
└─────────────────┬────────────────────┘
                  │ WebSocket
                  ▼
        Dashboard frontend
```

## Where the probe gets injected

`templates/fixtures.ts` (which `init` copies into your project as `reactlens/fixtures.ts`) extends Playwright's `test` with an auto fixture. Before each test, it:

1. Sets `window.__REACTLENS__ = { wsUrl }` and `window.__REACTLENS_TEST__ = { testId, stepId }` via `page.addInitScript`.
2. Loads the probe IIFE source via `page.addInitScript({ content })`.
3. Attaches a CDP `Page.startScreencast` and forwards frames over the same WS.

Result: the probe is loaded BEFORE any user JS runs, so it sees the very first React commit. Your specs don't need to know any of this — just `import { test, expect } from '../../reactlens/fixtures'` instead of from `@playwright/test`.

## What gets captured

For each fiber commit (each render), the probe walks from `FiberRoot.current` and emits a `ComponentNode` tree:

```ts
type ComponentNode = {
  name: string;            // 'App', 'Checkout', 'Context(QueryClient)', …
  key?: string | null;
  props: Record<string, unknown>;  // sanitized: functions become '[Function: name]', etc.
  hooks?: HookSnapshot[];          // count + values; kind classification is approximate
  source?: { file: string; line: number };  // dev-only React build
  children: ComponentNode[];
};
```

Host elements (DOM nodes like `div`) and "passthrough" fibers (Fragment, StrictMode, ContextProvider without a useful name) are flattened so you see your code, not React internals.

## Performance

Snapshots are throttled to ~10/sec. Serialization happens on `setTimeout(0)` after the commit so it doesn't add measurable latency to React's commit phase.

### Measured (2026-05-13)

A React Profiler API benchmark on the Vite fixture (`tests/fixtures/vite-react-router/e2e/specs/eval/probe-benchmark.spec.ts`) drives a deterministic checkout scenario (fill 3 inputs, submit, wait for response) and reads `actualDuration` per React commit. Three runs each, probe ON (`REACTLENS_WS_URL` set, probe IIFE injected and bippy active) vs probe OFF (probe never loaded):

| metric (per commit) | probe OFF | probe ON | delta |
|---|---|---|---|
| mean   | 1.11 ms | 1.00 ms | −0.11 ms |
| max    | 4.47 ms | 4.13 ms | −0.34 ms |
| sum    | 5.57 ms | 5.00 ms | −0.57 ms |
| n      | 5       | 5       | — |

Delta is within measurement noise (probe ON is marginally faster than OFF — consistent with variance, not a real effect). Per-render overhead is well below the DoD #9 threshold of 50 ms — by a factor of roughly 50×.

**What this measures vs. what it doesn't.** `actualDuration` covers React's commit phase, which is the user-perceived render latency. The probe's actual work (fiber walk + prop sanitization + JSON.stringify + WS send) happens *after* commit on `setTimeout(0)`, *outside* this window. So this benchmark validates "the probe does not extend commit-phase latency" — which is what users notice. It does *not* measure post-commit main-thread blocking; if you suspect the probe is starving idle time, run a `PerformanceObserver({entryTypes: ['longtask']})` benchmark instead.

Sample size is intentionally small (5 commits × 3 runs = 15 observations per condition) because the delta is so close to zero that more data wouldn't change the conclusion. If the probe ever shows a non-noise overhead, expand the scenario and rerun.

### Depth limit

The walker bails after `MAX_DEPTH` (currently 200) nested fibers. This is a stack-overflow / runaway-tree guard, not a "reasonable user tree" limit — modern routers wrap user code in 25–40 layers of context/boundary fibers before reaching the page component:

| Stack | Wrapper layers before user code |
|---|---|
| Vite + react-router-dom | ~10 |
| Vite + @tanstack/react-router | ~18 (includes SafeFragment / MatchImpl scaffolding) |
| Next.js 14 App Router | ~28 (RouterContextProvider, Matches, ErrorBoundary, NotFoundBoundary, RedirectBoundary, layout routers, plus per-segment overhead) |

Setting `MAX_DEPTH` too low silently truncates the actual user subtree to empty children. The previous default of 30 was tuned for a flat Vite + react-router app and surfaced the bug on Next/TanStack: the captured snapshot stopped at `QueryClientProvider → Context(?)` with no children, even though `LoginPage` had rendered correctly. See `src/component-bridge/snapshot.ts` header comment for the diagnostic timeline.

If you somehow blow 200 levels, file an issue — your tree is likely pathological or has an unbounded recursive component.

## Why bippy

bippy wraps `__REACT_DEVTOOLS_GLOBAL_HOOK__` in a version-safe API. We never touch the hook directly because:

- It's not part of React's public API.
- React minor versions occasionally rearrange the hook's shape.
- bippy already has the conformance work done.

If you need a feature bippy doesn't expose, please update bippy rather than reaching into the hook.
