/// <reference lib="dom" />
// In-app probe injected into the user's React application. Bundled as a
// self-contained IIFE; no module resolution at runtime. Subscribes to React
// fiber commits via bippy, serializes the tree, and ships snapshots over WS
// to the reactlens dashboard. Heavily defensive — must never crash the host
// app. Any thrown error is swallowed and surfaced to the dashboard via a
// console warning.
import { instrument } from 'bippy';
import { serializeFiber } from './snapshot';
import { Transport } from './transport';

type TestContext = { testId: string; stepId: string };

declare global {
  interface Window {
    __REACTLENS__?: { wsUrl?: string };
    __REACTLENS_TEST__?: TestContext;
  }
}

(() => {
  if (typeof window === 'undefined') return;

  const config = window.__REACTLENS__ ?? {};
  const wsUrl = config.wsUrl;
  if (typeof wsUrl !== 'string' || wsUrl.length === 0) {
    // eslint-disable-next-line no-console
    console.info('[reactlens] probe loaded but no WS url; idle');
    return;
  }

  const transport = new Transport(wsUrl);
  transport.start();

  function currentTest(): TestContext | null {
    const ctx = window.__REACTLENS_TEST__;
    if (ctx === undefined || typeof ctx.testId !== 'string') return null;
    return ctx;
  }

  function captureFromRoot(fiberRoot: unknown): void {
    const ctx = currentTest();
    if (ctx === null) return;
    try {
      // FiberRoot has a `current` field that points at the root HostRoot fiber.
      const root = (fiberRoot as { current?: unknown }).current ?? fiberRoot;
      const { tree, testIdIndex } = serializeFiber(root as never);
      transport.send({
        t: 'component:snapshot',
        testId: ctx.testId,
        stepId: ctx.stepId,
        tree,
        testIdIndex,
      });
    } catch (err) {
      // Don't let probe errors break the host app.
      // eslint-disable-next-line no-console
      console.warn('[reactlens] snapshot failed', err);
    }
  }

  try {
    instrument({
      onCommitFiberRoot: (_rendererId: number, root: unknown) => {
        // Defer so we don't add measurable cost inside React's commit phase.
        // setTimeout(0) yields to the browser; serialization happens after
        // React has finished committing and the DOM is settled.
        setTimeout(() => captureFromRoot(root), 0);
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[reactlens] failed to instrument React; probe inactive', err);
  }
})();
