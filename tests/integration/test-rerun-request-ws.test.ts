// Integration test: test:rerun-request WS round-trip end-to-end.
//
// Symmetric to patch-apply-ws.test.ts. A dashboard client posts
// `{ kind: 'test:rerun-request', testId }` over /ws/dashboard; the server
// validates the shape and emits `{ t: 'test:rerun-requested', testId }`
// onto the bus, which the broadcaster echoes back to every WS client and
// the persistor writes to events.jsonl.
//
// What this slice OWNS: the wire infrastructure that lets the dashboard
// ask for a re-run and observe acknowledgement (visually + on disk).
// What this slice EXPLICITLY DOES NOT OWN: actually spawning the re-run.
// The runner's process orchestration to relaunch Playwright with
// `--grep <testId>` mid-session is its own slice — punted with a clear
// note in the PR body. A bus subscriber that wants to spawn a re-run
// can do so by listening on `test:rerun-requested`; that subscriber is
// future work.
//
// Not a CLI-subprocess test for the same reason patch-apply-ws.test.ts
// isn't: dist runtime CJS/ESM mismatch is pre-existing and unrelated.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { EventBus } from '../../src/runner/event-bus';
import { EventPersistor } from '../../src/runner/event-persistor';
import { RunsArea } from '../../src/runs/run-paths';
import { startDashboardServer, type DashboardServer } from '../../src/dashboard/server';
import type { RunEvent } from '../../src/runner/events';

type Harness = {
  cwd: string;
  server: DashboardServer;
  bus: EventBus;
  persistor: EventPersistor;
  runId: string;
  close: () => Promise<void>;
};

async function makeHarness(): Promise<Harness> {
  const cwd = await mkdtemp(join(tmpdir(), 'reactlens-rerun-ws-'));
  const area = new RunsArea(cwd);
  await mkdir(area.runsDir, { recursive: true });
  const runPath = area.startRun();
  const bus = new EventBus();
  const persistor = new EventPersistor({ runPath });
  const unsubPersistor = bus.addSink(persistor);
  const server = await startDashboardServer({ port: 0, bus, runsArea: area });
  const close = async (): Promise<void> => {
    await persistor.flush();
    unsubPersistor();
    await server.close();
  };
  return { cwd, server, bus, persistor, runId: runPath.id, close };
}

// Open a WS to /ws/dashboard, send a test:rerun-request, and resolve with
// the test:rerun-requested event whose testId matches the one we sent. We
// match on testId rather than "first such event" because the server's
// ring buffer replays prior history to late-joining clients, so a fresh
// connection sees rerun acknowledgements from earlier in the run too.
// 5s timeout — surfaces hangs loudly without slowing the happy path.
async function rerunOverWs(
  server: DashboardServer,
  testId: string,
): Promise<Extract<RunEvent, { t: 'test:rerun-requested' }>> {
  return new Promise((resolveResult, rejectResult) => {
    const ws = new WebSocket(server.wsUrl);
    const timeout = setTimeout(() => {
      ws.close();
      rejectResult(new Error('timed out waiting for test:rerun-requested'));
    }, 5000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ kind: 'test:rerun-request', testId }));
    });
    ws.on('message', (data) => {
      let event: RunEvent;
      try {
        event = JSON.parse(data.toString()) as RunEvent;
      } catch {
        return;
      }
      if (event.t === 'test:rerun-requested' && event.testId === testId) {
        clearTimeout(timeout);
        ws.close();
        resolveResult(event);
      }
    });
    ws.on('error', (err) => {
      clearTimeout(timeout);
      rejectResult(err);
    });
  });
}

let harness: Harness | null = null;
afterEach(async () => {
  if (harness !== null) {
    await harness.close();
    harness = null;
  }
});

describe('test:rerun-request WS round-trip — happy path', () => {
  it('echoes back a test:rerun-requested event with the requested testId', async () => {
    harness = await makeHarness();
    const event = await rerunOverWs(harness.server, 't-counter-increments');
    expect(event.t).toBe('test:rerun-requested');
    expect(event.testId).toBe('t-counter-increments');
  });

  it('persists the test:rerun-requested event into events.jsonl', async () => {
    harness = await makeHarness();
    await rerunOverWs(harness.server, 't-login-flow');
    // Flush so the writeQueue actually fsyncs before the assertion.
    await harness.persistor.flush();

    const jsonlPath = join(
      harness.cwd,
      '.reactlens',
      'runs',
      harness.runId,
      'events.jsonl',
    );
    const text = await readFile(jsonlPath, 'utf8');
    const lines = text.split('\n').filter((l) => l.length > 0);
    const requested = lines
      .map((l) => JSON.parse(l) as RunEvent)
      .find((e) => e.t === 'test:rerun-requested');
    expect(requested).toBeDefined();
    if (requested?.t !== 'test:rerun-requested') throw new Error('typing guard');
    expect(requested.testId).toBe('t-login-flow');
  });

  it('emits the bus event to subscribers, not just WS clients', async () => {
    harness = await makeHarness();
    const seen: string[] = [];
    harness.bus.on('test:rerun-requested', (e) => seen.push(e.testId));

    await rerunOverWs(harness.server, 't-a');
    await rerunOverWs(harness.server, 't-b');

    expect(seen).toContain('t-a');
    expect(seen).toContain('t-b');
  });
});

describe('test:rerun-request WS round-trip — malformed inputs', () => {
  it('drops a malformed rerun request silently (no testId to attribute to)', async () => {
    harness = await makeHarness();
    // Subscribe so we can assert NO event was emitted.
    const seen: string[] = [];
    harness.bus.on('test:rerun-requested', (e) => seen.push(e.testId));

    // Send a malformed message and a follow-up well-formed one — when the
    // valid one comes back we know the server processed both inbound
    // messages, so the absence of the malformed one in `seen` is real.
    await new Promise<void>((resolveSettle, rejectSettle) => {
      const ws = new WebSocket(harness!.server.wsUrl);
      const timeout = setTimeout(() => {
        ws.close();
        rejectSettle(new Error('timed out'));
      }, 5000);
      ws.on('open', () => {
        ws.send(JSON.stringify({ kind: 'test:rerun-request' /* no testId */ }));
        ws.send(JSON.stringify({ kind: 'test:rerun-request', testId: 't-valid' }));
      });
      ws.on('message', (data) => {
        let event: RunEvent;
        try {
          event = JSON.parse(data.toString()) as RunEvent;
        } catch {
          return;
        }
        if (event.t === 'test:rerun-requested' && event.testId === 't-valid') {
          clearTimeout(timeout);
          ws.close();
          resolveSettle();
        }
      });
      ws.on('error', (err) => {
        clearTimeout(timeout);
        rejectSettle(err);
      });
    });

    expect(seen).toEqual(['t-valid']);
  });
});
