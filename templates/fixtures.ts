// reactlens test fixture — extends Playwright's `test` with per-page
// instrumentation that's a no-op when REACTLENS_WS_URL is unset.
//
// Two things happen automatically per test:
//   1. The component-bridge probe is injected via addInitScript before any
//      page navigation, with __REACTLENS__/__REACTLENS_TEST__ globals so it
//      knows where to send snapshots.
//   2. A CDP screencast is started on the page, forwarding frames over the
//      same dashboard WS as `frame` events.
//
// USAGE in your specs:
//   import { test, expect } from '../reactlens/fixtures';
//
// You don't need to change anything else; `test`/`expect` here are the same
// types as `@playwright/test`, just augmented.
import { test as base, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import WebSocket from 'ws';

let cachedProbeSource: string | null | undefined;

function locateProbeBundle(): string | null {
  const candidates: string[] = [];
  // Highest priority: explicit override from the runner (used during reactlens
  // development when reactlens is not installed into the user's project).
  const override = process.env.REACTLENS_PROBE_PATH;
  if (override !== undefined && override.length > 0) candidates.push(override);
  try {
    const pkg = require.resolve('reactlens/package.json');
    candidates.push(join(dirname(pkg), 'dist', 'probe', 'probe.global.js'));
  } catch {
    /* not installed */
  }
  candidates.push(join(process.cwd(), 'node_modules', 'reactlens', 'dist', 'probe', 'probe.global.js'));
  for (const p of candidates) {
    try {
      readFileSync(p);
      return p;
    } catch {
      /* try next */
    }
  }
  return null;
}

function loadProbeSource(): string | null {
  if (cachedProbeSource !== undefined) return cachedProbeSource;
  const path = locateProbeBundle();
  cachedProbeSource = path !== null ? readFileSync(path, 'utf8') : null;
  return cachedProbeSource;
}

type FrameSocket = { send: (e: unknown) => void; close: () => void };

function openFrameSocket(wsUrl: string): FrameSocket {
  let socket: WebSocket | null = null;
  const buffer: unknown[] = [];

  function connect(): void {
    try {
      socket = new WebSocket(wsUrl);
    } catch {
      return;
    }
    socket.on('open', () => {
      while (buffer.length > 0) {
        const next = buffer.shift();
        if (next !== undefined) {
          try {
            socket?.send(JSON.stringify(next));
          } catch {
            /* ignore */
          }
        }
      }
    });
    socket.on('error', () => undefined);
    socket.on('close', () => {
      socket = null;
    });
  }
  connect();

  return {
    send(e: unknown): void {
      if (socket !== null && socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(JSON.stringify(e));
        } catch {
          /* ignore */
        }
        return;
      }
      buffer.push(e);
    },
    close(): void {
      try {
        socket?.close();
      } catch {
        /* ignore */
      }
      socket = null;
    },
  };
}

async function attachScreencast(page: Page, testId: string, frameSocket: FrameSocket): Promise<() => Promise<void>> {
  const cdp = await page.context().newCDPSession(page);
  cdp.on('Page.screencastFrame', async (params: { data: string; sessionId: number }) => {
    frameSocket.send({ t: 'frame', testId, data: params.data, sessionId: String(params.sessionId) });
    try {
      await cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId });
    } catch {
      /* page closed */
    }
  });
  try {
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: 1280 });
  } catch {
    /* CDP unavailable, continue silently */
  }
  return async () => {
    try {
      await cdp.send('Page.stopScreencast');
    } catch {
      /* already stopped */
    }
    try {
      await cdp.detach();
    } catch {
      /* already detached */
    }
  };
}

export const test = base.extend<{ reactlens: void }>({
  reactlens: [
    async ({ page }, use, testInfo) => {
      const wsUrl = process.env.REACTLENS_WS_URL;
      if (wsUrl === undefined) {
        await use();
        return;
      }
      const probeSource = loadProbeSource();
      if (probeSource !== null) {
        await page.addInitScript(
          ({ wsUrl: url, testId }) => {
            (window as unknown as { __REACTLENS__: { wsUrl: string } }).__REACTLENS__ = { wsUrl: url };
            (window as unknown as { __REACTLENS_TEST__: { testId: string; stepId: string } }).__REACTLENS_TEST__ = {
              testId,
              stepId: testId,
            };
          },
          { wsUrl, testId: testInfo.testId },
        );
        await page.addInitScript({ content: probeSource });
      }
      const frameSocket = openFrameSocket(wsUrl);
      const detach = await attachScreencast(page, testInfo.testId, frameSocket);
      try {
        await use();
      } finally {
        await detach();
        frameSocket.close();
      }
    },
    { auto: true },
  ],
});

export { expect };
