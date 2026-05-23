// Unit tests for createSnapshotCollector — the WS-server half of
// captureSnapshot that's testable without Playwright/chromium.
//
// The collector starts a WS server on a free port, accepts probe
// connections, parses incoming JSON messages, and remembers the LAST
// `component:snapshot` event per testId. The CLI's `captureSnapshot()`
// uses the collector's `url` to point the probe at, then reads
// `getLastSnapshot(testId)` after the chromium-driven navigation +
// waitMs.
//
// These tests use the WebSocket client API directly to send scripted
// messages — no chromium, no probe bundle, no addInitScript. The
// integration of all three lives in the (manual) verification against
// case-021 documented in PR #N.
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createSnapshotCollector } from '../../src/eval/snapshot-capture';

// Helper: open a client, wait for it to be in OPEN state, return it.
async function connect(url: string): Promise<WebSocket> {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return ws;
}

// Helper: send a JSON message and wait for the network to flush.
async function sendJson(ws: WebSocket, obj: unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    ws.send(JSON.stringify(obj), (err) => (err ? reject(err) : resolve()));
  });
  // Give the server's onmessage a tick to run.
  await new Promise((r) => setTimeout(r, 10));
}

describe('createSnapshotCollector — happy path', () => {
  it('returns a ws:// url that probes can connect to', async () => {
    const collector = await createSnapshotCollector();
    try {
      expect(collector.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/);
      const ws = await connect(collector.url);
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    } finally {
      await collector.close();
    }
  });

  it('captures the LAST component:snapshot per testId', async () => {
    const collector = await createSnapshotCollector();
    try {
      const ws = await connect(collector.url);
      // Two snapshots for the same testId — collector keeps the last.
      await sendJson(ws, {
        t: 'component:snapshot',
        testId: 'cap',
        stepId: 's1',
        tree: { name: 'A', props: {}, children: [] },
      });
      await sendJson(ws, {
        t: 'component:snapshot',
        testId: 'cap',
        stepId: 's2',
        tree: { name: 'B', props: {}, children: [] },
      });
      ws.close();
      await new Promise((r) => setTimeout(r, 20));

      const snap = collector.getLastSnapshot('cap');
      expect(snap).not.toBeNull();
      expect(snap?.name).toBe('B');
    } finally {
      await collector.close();
    }
  });

  it('attributes snapshots to the correct testId across mixed traffic', async () => {
    const collector = await createSnapshotCollector();
    try {
      const ws = await connect(collector.url);
      await sendJson(ws, {
        t: 'component:snapshot',
        testId: 'cap-a',
        stepId: 's1',
        tree: { name: 'A', props: {}, children: [] },
      });
      await sendJson(ws, {
        t: 'component:snapshot',
        testId: 'cap-b',
        stepId: 's1',
        tree: { name: 'B', props: {}, children: [] },
      });
      ws.close();
      await new Promise((r) => setTimeout(r, 20));

      expect(collector.getLastSnapshot('cap-a')?.name).toBe('A');
      expect(collector.getLastSnapshot('cap-b')?.name).toBe('B');
      expect(collector.getLastSnapshot('cap-c')).toBeNull();
    } finally {
      await collector.close();
    }
  });
});

describe('createSnapshotCollector — robustness', () => {
  it('returns null for a testId that never received a snapshot', async () => {
    const collector = await createSnapshotCollector();
    try {
      expect(collector.getLastSnapshot('nothing')).toBeNull();
    } finally {
      await collector.close();
    }
  });

  it('silently ignores non-component:snapshot events (other RunEvent types)', async () => {
    // The probe sends `component:snapshot` exclusively today, but the
    // protocol is shared with the dashboard's WS where other events
    // (frame, a11y:snapshot, etc.) flow. The collector must not crash
    // on those — just skip silently.
    const collector = await createSnapshotCollector();
    try {
      const ws = await connect(collector.url);
      await sendJson(ws, { t: 'frame', testId: 'cap', data: 'base64', sessionId: 's' });
      await sendJson(ws, {
        t: 'component:snapshot',
        testId: 'cap',
        stepId: 's1',
        tree: { name: 'X', props: {}, children: [] },
      });
      ws.close();
      await new Promise((r) => setTimeout(r, 20));
      expect(collector.getLastSnapshot('cap')?.name).toBe('X');
    } finally {
      await collector.close();
    }
  });

  it('silently ignores malformed JSON (probe-side bug or partial write)', async () => {
    const collector = await createSnapshotCollector();
    try {
      const ws = await connect(collector.url);
      // Send raw garbage that isn't valid JSON.
      await new Promise<void>((resolve, reject) => {
        ws.send('this is not json', (err) => (err ? reject(err) : resolve()));
      });
      await new Promise((r) => setTimeout(r, 10));
      // Then a valid message — collector should still work afterwards.
      await sendJson(ws, {
        t: 'component:snapshot',
        testId: 'cap',
        stepId: 's1',
        tree: { name: 'X', props: {}, children: [] },
      });
      ws.close();
      await new Promise((r) => setTimeout(r, 20));
      expect(collector.getLastSnapshot('cap')?.name).toBe('X');
    } finally {
      await collector.close();
    }
  });

  it('close() shuts down the server and frees the port', async () => {
    const collector = await createSnapshotCollector();
    const url = collector.url;
    await collector.close();
    // After close, a new connection attempt should fail (ECONNREFUSED
    // or similar). We just assert that the close promise resolved and
    // we can create another collector on the same family of ports
    // without lock contention.
    const collector2 = await createSnapshotCollector();
    expect(collector2.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/);
    expect(collector2.url).not.toBe(url); // different free port each time
    await collector2.close();
  });
});
