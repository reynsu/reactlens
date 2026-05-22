// Integration test: WS apply round-trip end-to-end (slice #11 phase 1).
//
// Spins startDashboardServer with a real RunsArea (tmpdir cwd), attaches
// an EventPersistor to the bus, opens a WS client to /ws/dashboard, and
// exercises the full Apply Fix path:
//
//   client → { kind: 'patch:apply', testId, patch } →  server
//     → applyPatch (atomic write) → bus.emit(patch:applied)
//     → broadcaster sends to WS clients + persistor writes events.jsonl
//
// Verifies, on the happy path: the file is mutated, the inbound event
// arrives on the WS, and events.jsonl records the result. Verifies, on
// the rejection paths: the file is NOT mutated and a patch:rejected
// event with the matching reason arrives.
//
// NOT a CLI-subprocess test. The built dist/cli.js currently fails to
// load at runtime because of an unrelated CJS-vs-ESM mismatch with
// @reynsu/reactlens-diagnosis-prompts (pre-existing, flagged in slice
// #15's PR). Calling startDashboardServer directly through vitest's
// ESM-friendly transform exercises every layer this slice owns.
import { describe, expect, it, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import WebSocket from 'ws';
import { EventBus } from '../../src/runner/event-bus';
import { EventPersistor } from '../../src/runner/event-persistor';
import { RunsArea } from '../../src/runs/run-paths';
import { startDashboardServer, type DashboardServer } from '../../src/dashboard/server';
import type { RunEvent } from '../../src/runner/events';

// Per-test harness: tmpdir cwd + bus + persistor + server + ws.
type Harness = {
  cwd: string;
  server: DashboardServer;
  bus: EventBus;
  persistor: EventPersistor;
  runId: string;
  close: () => Promise<void>;
};

async function makeHarness(): Promise<Harness> {
  const cwd = await mkdtemp(join(tmpdir(), 'reactlens-patch-apply-ws-'));
  const area = new RunsArea(cwd);
  await mkdir(area.runsDir, { recursive: true });
  const runPath = area.startRun();
  const bus = new EventBus();
  const persistor = new EventPersistor({ runPath });
  persistor.attach(bus);
  const server = await startDashboardServer({ port: 0, bus, runsArea: area });
  const close = async (): Promise<void> => {
    await persistor.flush();
    persistor.detach();
    await server.close();
  };
  return { cwd, server, bus, persistor, runId: runPath.id, close };
}

// Open a WS to /ws/dashboard, send a patch:apply request, and resolve
// with the FIRST patch:applied or patch:rejected event the server
// echoes back. 5s timeout — way more than needed; surfaces hangs loudly.
async function applyOverWs(
  server: DashboardServer,
  testId: string,
  patch: { file: string; oldStr: string; newStr: string },
): Promise<Extract<RunEvent, { t: 'patch:applied' | 'patch:rejected' }>> {
  return new Promise((resolveResult, rejectResult) => {
    const ws = new WebSocket(server.wsUrl);
    const timeout = setTimeout(() => {
      ws.close();
      rejectResult(new Error('timed out waiting for patch:applied / patch:rejected'));
    }, 5000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ kind: 'patch:apply', testId, patch }));
    });
    ws.on('message', (data) => {
      let event: RunEvent;
      try {
        event = JSON.parse(data.toString()) as RunEvent;
      } catch {
        return;
      }
      if (event.t === 'patch:applied' || event.t === 'patch:rejected') {
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

describe('Apply Fix WS round-trip — happy path', () => {
  it('mutates the file and emits patch:applied with the apply provenance', async () => {
    harness = await makeHarness();
    const filePath = join(harness.cwd, 'src', 'Counter.tsx');
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, 'export const x = count + 1;\n');

    const event = await applyOverWs(harness.server, 't1', {
      file: 'src/Counter.tsx',
      oldStr: 'count + 1',
      newStr: 'count - 1',
    });

    expect(event.t).toBe('patch:applied');
    if (event.t !== 'patch:applied') throw new Error('typing guard');
    expect(event.testId).toBe('t1');
    expect(event.file).toBe('src/Counter.tsx');
    expect(event.oldStr).toBe('count + 1');
    expect(event.newStr).toBe('count - 1');

    // File on disk must reflect the patch.
    const after = await readFile(filePath, 'utf8');
    expect(after).toBe('export const x = count - 1;\n');
  });

  it('persists the patch:applied event into the run\'s events.jsonl', async () => {
    harness = await makeHarness();
    const filePath = join(harness.cwd, 'a.txt');
    await writeFile(filePath, 'before\n');

    await applyOverWs(harness.server, 't1', {
      file: 'a.txt',
      oldStr: 'before',
      newStr: 'after',
    });
    // Flush so the writeQueue actually fsyncs before the assertion.
    await harness.persistor.flush();

    const jsonlPath = join(harness.cwd, '.reactlens', 'runs', harness.runId, 'events.jsonl');
    const text = await readFile(jsonlPath, 'utf8');
    const lines = text.split('\n').filter((l) => l.length > 0);
    const applied = lines
      .map((l) => JSON.parse(l) as RunEvent)
      .find((e) => e.t === 'patch:applied');
    expect(applied).toBeDefined();
    if (applied?.t !== 'patch:applied') throw new Error('typing guard');
    expect(applied.testId).toBe('t1');
    expect(applied.file).toBe('a.txt');
  });
});

describe('Apply Fix WS round-trip — rejection paths', () => {
  it('emits patch:rejected reason=oldStr-not-found when the pattern is absent', async () => {
    harness = await makeHarness();
    const filePath = join(harness.cwd, 'a.txt');
    await writeFile(filePath, 'some other content\n');

    const event = await applyOverWs(harness.server, 't1', {
      file: 'a.txt',
      oldStr: 'absent string',
      newStr: 'whatever',
    });
    expect(event.t).toBe('patch:rejected');
    if (event.t !== 'patch:rejected') throw new Error('typing guard');
    expect(event.reason).toBe('oldStr-not-found');

    // File unchanged on rejection.
    expect(await readFile(filePath, 'utf8')).toBe('some other content\n');
  });

  it('emits patch:rejected reason=oldStr-not-unique with detail=count', async () => {
    harness = await makeHarness();
    const filePath = join(harness.cwd, 'a.txt');
    await writeFile(filePath, 'foo bar\nfoo baz\n');

    const event = await applyOverWs(harness.server, 't1', {
      file: 'a.txt',
      oldStr: 'foo',
      newStr: 'FOO',
    });
    expect(event.t).toBe('patch:rejected');
    if (event.t !== 'patch:rejected') throw new Error('typing guard');
    expect(event.reason).toBe('oldStr-not-unique');
    expect(event.detail).toBe('2');
    expect(await readFile(filePath, 'utf8')).toBe('foo bar\nfoo baz\n');
  });

  it('emits patch:rejected reason=fs-error when the patch.file path escapes cwd', async () => {
    harness = await makeHarness();
    const event = await applyOverWs(harness.server, 't1', {
      file: '../escape-attempt.txt',
      oldStr: 'a',
      newStr: 'b',
    });
    expect(event.t).toBe('patch:rejected');
    if (event.t !== 'patch:rejected') throw new Error('typing guard');
    expect(event.reason).toBe('fs-error');
    expect(String(event.detail)).toMatch(/escapes project root/i);
  });

  it('emits patch:rejected reason=fs-error when the target file does not exist', async () => {
    harness = await makeHarness();
    const event = await applyOverWs(harness.server, 't1', {
      file: 'does-not-exist.txt',
      oldStr: 'a',
      newStr: 'b',
    });
    expect(event.t).toBe('patch:rejected');
    if (event.t !== 'patch:rejected') throw new Error('typing guard');
    expect(event.reason).toBe('fs-error');
  });

  // Defensive depth on top of the existing resolve+startsWith guard. A
  // file that's inside cwd at the path level but is a symlink pointing
  // OUTSIDE cwd would pass the lexical guard. realpath() resolves the
  // symlink and lets us re-check containment, so the agent can't be
  // tricked into mutating /etc/anything via a planted symlink in the
  // user's tree. Detail message intentionally mentions "symlink" so the
  // operator can distinguish from the lexical-escape case above.
  it('emits patch:rejected reason=fs-error when patch.file is a symlink pointing outside cwd', async () => {
    harness = await makeHarness();
    // Real target lives OUTSIDE cwd — emulates an attacker-controlled
    // file (or just an unrelated /etc/-shaped target) that the agent
    // should never reach.
    const outsideDir = await mkdtemp(join(tmpdir(), 'reactlens-patch-outside-'));
    const outsideTarget = join(outsideDir, 'sensitive.txt');
    await writeFile(outsideTarget, 'do not touch\n');
    // Plant a symlink INSIDE cwd that points to it. Lexical guard
    // (resolve + startsWith) passes — the symlink path is under cwd.
    const insideLink = join(harness.cwd, 'planted-link.txt');
    await symlink(outsideTarget, insideLink);

    const event = await applyOverWs(harness.server, 't1', {
      file: 'planted-link.txt',
      oldStr: 'do not touch',
      newStr: 'mutated',
    });
    expect(event.t).toBe('patch:rejected');
    if (event.t !== 'patch:rejected') throw new Error('typing guard');
    expect(event.reason).toBe('fs-error');
    expect(String(event.detail)).toMatch(/symlink|escapes/i);
    // The real target file must NOT have been mutated — defence-in-
    // depth is meaningless if the write still landed.
    expect(await readFile(outsideTarget, 'utf8')).toBe('do not touch\n');
  });

  // Regression: a symlink whose realpath is STILL under cwd is legitimate
  // (e.g., monorepo with internal symlinked packages). The realpath check
  // must allow it through — the guard catches escapes, not all symlinks.
  it('allows a symlink whose realpath is still under cwd', async () => {
    harness = await makeHarness();
    const realTarget = join(harness.cwd, 'src', 'Real.tsx');
    await mkdir(dirname(realTarget), { recursive: true });
    await writeFile(realTarget, 'export const x = 1;\n');
    const link = join(harness.cwd, 'Linked.tsx');
    await symlink(realTarget, link);

    const event = await applyOverWs(harness.server, 't1', {
      file: 'Linked.tsx',
      oldStr: 'const x = 1',
      newStr: 'const x = 2',
    });
    expect(event.t).toBe('patch:applied');
    // Real underlying file mutates — that's the documented atomic-write
    // behavior; the guard only refuses cross-root targets.
    expect(await readFile(realTarget, 'utf8')).toBe('export const x = 2;\n');
  });
});
