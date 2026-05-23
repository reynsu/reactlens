// captureSnapshot — drives a Chromium browser via the Playwright API
// against an operator-managed dev server, injects the reactlens probe
// before navigation, and harvests the last `component:snapshot` event
// the probe emits during the wait window.
//
// Designed for the #41 use case: capture a real snapshot.json for
// corpus-harvested cases (e.g. case-021 sibling-cache-leak) where
// modifying the upstream fork to import reactlens fixtures is not
// viable. This is the standalone path — no Playwright test config in
// the fork is touched.
//
// Split in two:
//   - createSnapshotCollector(): spawns a WS server on a free port.
//     Unit-testable in isolation (tests/unit/snapshot-capture-collector.test.ts).
//   - captureSnapshot(opts): orchestrates collector + Playwright launch
//     + addInitScript + navigate + wait. Integration-only because
//     it touches a real chromium.
//
// Per ADR-0003 (sovereignty-first): no telemetry, no network calls
// beyond the configured dev-server URL.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import type { ComponentNode } from '../runner/events';

// ─────────────────────────────────────────────────────────────────────
// Collector — WS server + snapshot accumulator. Unit-testable.
// ─────────────────────────────────────────────────────────────────────

export type SnapshotCollector = {
  // WebSocket URL the probe should connect to. Format
  // `ws://127.0.0.1:<port>`. Pass this verbatim to the page's
  // `__REACTLENS__ = { wsUrl }` global.
  url: string;
  // Returns the LAST `component:snapshot` event received for the given
  // testId, or null if none were received. Probe streams snapshots
  // throughout navigation; the last one is the post-settled tree.
  getLastSnapshot(testId: string): ComponentNode | null;
  // Stops the WS server. Idempotent. Always await before exiting the
  // caller so the port is released cleanly.
  close(): Promise<void>;
};

export async function createSnapshotCollector(): Promise<SnapshotCollector> {
  const lastSnapshots = new Map<string, ComponentNode>();
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });

  await new Promise<void>((resolve) => wss.once('listening', () => resolve()));
  const addr = wss.address() as AddressInfo;
  const url = `ws://127.0.0.1:${addr.port}`;

  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      let event: unknown;
      try {
        event = JSON.parse(data.toString('utf8'));
      } catch {
        // Probe-side bug or partial write — skip silently. The probe
        // is best-effort; one corrupt message must not kill capture.
        return;
      }
      const e = event as { t?: string; testId?: string; tree?: ComponentNode };
      if (e.t !== 'component:snapshot') return;
      if (typeof e.testId !== 'string' || e.tree === undefined) return;
      lastSnapshots.set(e.testId, e.tree);
    });
  });

  return {
    url,
    getLastSnapshot(testId: string): ComponentNode | null {
      return lastSnapshots.get(testId) ?? null;
    },
    close(): Promise<void> {
      return new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// captureSnapshot — full chromium-driver flow. Integration-tested.
// ─────────────────────────────────────────────────────────────────────

export type CaptureSnapshotOpts = {
  // Base URL of the operator's dev server (e.g. "http://localhost:5173").
  // The dev server must already be running — captureSnapshot does NOT
  // spawn it (per design pick: operator-managed). The script CLI
  // surfaces a clear error if baseUrl is unreachable.
  baseUrl: string;
  // Path to navigate to (e.g. "/dashboard/invoices-compare/1/2"). Joined
  // to baseUrl as-is; absolute URLs in `path` override baseUrl, which
  // lets an operator capture cross-origin if needed.
  path: string;
  // Milliseconds to wait after navigation before reading the snapshot.
  // Defaults to 2000ms — long enough for react-query to settle in the
  // case-021 sibling-cache-leak scenario without dragging out short
  // captures.
  waitMs?: number;
  // The testId the probe will use when emitting snapshots. Arbitrary
  // string; the collector keys on it so multiple captures in one
  // process don't collide. Defaults to "capture".
  testId?: string;
  // Override path for the probe bundle. Defaults to
  // `<package>/dist/probe/probe.global.js`. Useful for dev where the
  // built bundle lives elsewhere.
  probeBundlePath?: string;
};

// Resolve the probe IIFE bundle. The dist/probe/probe.global.js is
// produced by `pnpm build` (tsup config has the probe entry).
function resolveProbeBundle(override?: string): string {
  if (override !== undefined) return override;
  // From src/eval/this-file.ts (or dist/eval/this-file.js at runtime)
  // walk up to the package root, then into dist/probe.
  const here = __dirname;
  const candidates = [
    // dev (tsx): src/eval → ../../dist/probe
    join(here, '..', '..', 'dist', 'probe', 'probe.global.js'),
    // bundled: dist/eval → ../probe
    join(here, '..', 'probe', 'probe.global.js'),
    // dirname(__filename) edge case (ESM shim)
    join(dirname(__filename), '..', '..', 'dist', 'probe', 'probe.global.js'),
  ];
  for (const c of candidates) {
    try {
      readFileSync(c);
      return c;
    } catch {
      /* try next */
    }
  }
  throw new Error(
    `captureSnapshot: probe bundle not found. Tried:\n  ${candidates.join('\n  ')}\nRun \`pnpm build\` to produce dist/probe/probe.global.js, or pass probeBundlePath explicitly.`,
  );
}

export async function captureSnapshot(opts: CaptureSnapshotOpts): Promise<ComponentNode | null> {
  const testId = opts.testId ?? 'capture';
  const waitMs = opts.waitMs ?? 2000;

  // Dynamic import so the Playwright dependency stays lazy — unit
  // tests that don't exercise captureSnapshot don't pay the chromium
  // resolution cost.
  const { chromium } = await import('@playwright/test');

  const probeSource = readFileSync(resolveProbeBundle(opts.probeBundlePath), 'utf8');

  const collector = await createSnapshotCollector();
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

  try {
    browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();

    // Init script runs in the page BEFORE any navigation script. We
    // set the probe's two window globals, then inline the probe IIFE.
    // The probe reads `window.__REACTLENS__.wsUrl` and connects, then
    // tags each snapshot with `window.__REACTLENS_TEST__.testId`.
    const initScript = `
      window.__REACTLENS__ = { wsUrl: ${JSON.stringify(collector.url)} };
      window.__REACTLENS_TEST__ = { testId: ${JSON.stringify(testId)}, stepId: 'capture' };
      ${probeSource}
    `;
    await page.addInitScript({ content: initScript });

    const target = opts.path.startsWith('http') ? opts.path : `${opts.baseUrl}${opts.path}`;
    await page.goto(target);

    // Fixed delay window — operator-tunable via waitMs. We don't
    // detect "settled" because react-query's cache state isn't
    // observable from page-level DOM events; a fixed wait is honest.
    await new Promise((r) => setTimeout(r, waitMs));

    return collector.getLastSnapshot(testId);
  } finally {
    if (browser !== null) await browser.close();
    await collector.close();
  }
}
