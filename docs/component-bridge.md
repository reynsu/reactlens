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

Snapshots are throttled to ~10/sec. Serialization happens on `setTimeout(0)` after the commit so it doesn't add measurable latency to React's commit phase. Empirically the probe adds well under 50ms per render on the fixture app.

If a particular component blows the depth limit (default 30), the walk is cut and a placeholder is emitted. We don't have a knob to raise the limit yet — file an issue if your tree legitimately needs more.

## Why bippy

bippy wraps `__REACT_DEVTOOLS_GLOBAL_HOOK__` in a version-safe API. We never touch the hook directly because:

- It's not part of React's public API.
- React minor versions occasionally rearrange the hook's shape.
- bippy already has the conformance work done.

If you need a feature bippy doesn't expose, please update bippy rather than reaching into the hook.
