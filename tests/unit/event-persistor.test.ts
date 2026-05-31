import { mkdtemp, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventBus } from '../../src/runner/event-bus';
import { EventPersistor } from '../../src/runner/event-persistor';
import type { RunEvent } from '../../src/runner/events';
import { RunPath } from '../../src/runs/run-paths';

// 1×1 transparent JPEG, base64-encoded. Small enough to verify byte-perfect
// roundtrip without bloating the test file. Anything that decodes to N bytes
// works — the format isn't asserted, only the decoded byte count.
const TINY_JPEG_B64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL+AB//Z';

let runDir: string;
let bus: EventBus;
let persistor: EventPersistor;
let unsub: () => void;

beforeEach(async () => {
  runDir = await mkdtemp(join(tmpdir(), 'reactlens-persistor-'));
  bus = new EventBus();
  persistor = new EventPersistor({ runPath: new RunPath({ id: 'test-run', dir: runDir }) });
  unsub = bus.addSink(persistor);
});

afterEach(() => {
  unsub();
});

describe('EventPersistor', () => {
  it('writes one NDJSON line per emitted event to events.jsonl', async () => {
    bus.emit({ t: 'run:start', runId: 'r1', totalTests: 1, timestamp: 0 });
    bus.emit({ t: 'test:start', id: 't1', title: 'a', file: 'a.spec.ts', suite: 's' });
    bus.emit({ t: 'test:end', id: 't1', status: 'passed', duration: 12 });
    bus.emit({ t: 'run:end', passed: 1, failed: 0, skipped: 0, duration: 12 });

    await persistor.flush();

    const text = await readFile(join(runDir, 'events.jsonl'), 'utf8');
    const lines = text.trimEnd().split('\n');
    expect(lines).toHaveLength(4);
    const parsed = lines.map((l) => JSON.parse(l) as RunEvent);
    expect(parsed.map((e) => e.t)).toEqual(['run:start', 'test:start', 'test:end', 'run:end']);
  });

  it('persists frames as JPEGs keyed by activeStep and replaces them on update (last write wins)', async () => {
    bus.emit({ t: 'run:start', runId: 'r1', totalTests: 1, timestamp: 0 });
    bus.emit({ t: 'test:start', id: 't1', title: 'a', file: 'a.spec.ts', suite: 's' });
    bus.emit({ t: 'step:start', testId: 't1', stepId: 's1', title: 'click submit' });
    bus.emit({ t: 'frame', testId: 't1', data: TINY_JPEG_B64, sessionId: 'sess-1' });
    bus.emit({ t: 'frame', testId: 't1', data: TINY_JPEG_B64, sessionId: 'sess-1' });

    await persistor.flush();

    const stepDir = join(runDir, 'frames', 't1');
    const files = await readdir(stepDir);
    expect(files).toEqual(['s1.jpg']);
    const buf = await readFile(join(stepDir, 's1.jpg'));
    const decodedLen = Buffer.from(TINY_JPEG_B64, 'base64').length;
    expect(buf.byteLength).toBe(decodedLen);
  });

  it('replaces the raw base64 frame data with a frameRef in the NDJSON log', async () => {
    bus.emit({ t: 'run:start', runId: 'r1', totalTests: 1, timestamp: 0 });
    bus.emit({ t: 'step:start', testId: 't1', stepId: 'step-a', title: 'click' });
    bus.emit({ t: 'frame', testId: 't1', data: TINY_JPEG_B64, sessionId: 'sess-1' });

    await persistor.flush();

    const lines = (await readFile(join(runDir, 'events.jsonl'), 'utf8'))
      .trimEnd()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const frame = lines.find((e) => e['t'] === 'frame');
    expect(frame).toBeDefined();
    expect(frame).not.toHaveProperty('data');
    expect(frame).toMatchObject({
      t: 'frame',
      testId: 't1',
      stepId: 'step-a',
      sessionId: 'sess-1',
      frameRef: 'frames/t1/step-a.jpg',
    });
  });

  it('preserves the frame timestamp on the persisted NDJSON line (#76)', async () => {
    bus.emit({ t: 'run:start', runId: 'r1', totalTests: 1, timestamp: 0 });
    bus.emit({ t: 'step:start', testId: 't1', stepId: 'step-a', title: 'click' });
    bus.emit({ t: 'frame', testId: 't1', data: TINY_JPEG_B64, sessionId: 'sess-1', timestamp: 1700000000123 });

    await persistor.flush();

    const lines = (await readFile(join(runDir, 'events.jsonl'), 'utf8'))
      .trimEnd()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const frame = lines.find((e) => e['t'] === 'frame');
    expect(frame).toMatchObject({
      t: 'frame',
      testId: 't1',
      stepId: 'step-a',
      frameRef: 'frames/t1/step-a.jpg',
      timestamp: 1700000000123,
    });
    expect(frame).not.toHaveProperty('data');
  });

  it('omits timestamp on the persisted line when the wire frame had none (#76 back-compat)', async () => {
    bus.emit({ t: 'run:start', runId: 'r1', totalTests: 1, timestamp: 0 });
    bus.emit({ t: 'step:start', testId: 't1', stepId: 'step-a', title: 'click' });
    bus.emit({ t: 'frame', testId: 't1', data: TINY_JPEG_B64, sessionId: 'sess-1' });

    await persistor.flush();

    const lines = (await readFile(join(runDir, 'events.jsonl'), 'utf8'))
      .trimEnd()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const frame = lines.find((e) => e['t'] === 'frame');
    expect(frame).toBeDefined();
    expect(frame).not.toHaveProperty('timestamp');
  });

  it('falls back to testId-keyed frames when no step:start has fired yet', async () => {
    bus.emit({ t: 'run:start', runId: 'r1', totalTests: 1, timestamp: 0 });
    bus.emit({ t: 'test:start', id: 't1', title: 'a', file: 'a.spec.ts', suite: 's' });
    bus.emit({ t: 'frame', testId: 't1', data: TINY_JPEG_B64, sessionId: 'sess-1' });

    await persistor.flush();

    const files = await readdir(join(runDir, 'frames', 't1'));
    expect(files).toEqual(['t1.jpg']);
  });

  it('unsubscribing the sink stops new events from being persisted', async () => {
    bus.emit({ t: 'run:start', runId: 'r1', totalTests: 1, timestamp: 0 });
    await persistor.flush();
    unsub();
    bus.emit({ t: 'test:start', id: 't1', title: 'a', file: 'a.spec.ts', suite: 's' });
    await persistor.flush();

    const lines = (await readFile(join(runDir, 'events.jsonl'), 'utf8')).trimEnd().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).t).toBe('run:start');
  });

  it('sanitizes filesystem-hostile chars in testId/stepId (Windows-safe)', async () => {
    // Real Playwright-shape: testId has dashes, stepId mixes timestamp +
    // title with colons, quotes, parentheses — would break on Windows.
    const hostileStepId = '1778763805886:Expect "toBeVisible" getByTestId(\'checkout-card\')';
    bus.emit({ t: 'run:start', runId: 'r1', totalTests: 1, timestamp: 0 });
    bus.emit({ t: 'test:start', id: 'test-1', title: 'a', file: 'a.spec.ts', suite: 's' });
    bus.emit({ t: 'step:start', testId: 'test-1', stepId: hostileStepId, title: 'click' });
    bus.emit({ t: 'frame', testId: 'test-1', data: TINY_JPEG_B64, sessionId: 'sess-1' });

    await persistor.flush();

    const files = await readdir(join(runDir, 'frames', 'test-1'));
    expect(files).toHaveLength(1);
    // No forbidden chars in the actual filename on disk.
    expect(files[0]).not.toMatch(/[<>:"/\\|?*]/);
    // The JSONL line's frameRef must match the on-disk path exactly.
    const lines = (await readFile(join(runDir, 'events.jsonl'), 'utf8'))
      .trimEnd()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const frame = lines.find((e) => e['t'] === 'frame');
    expect(frame?.['frameRef']).toBe(`frames/test-1/${files[0]}`);
    // The original stepId is preserved in the JSONL (only the disk path is sanitized).
    expect(frame?.['stepId']).toBe(hostileStepId);
  });

  it('mkdir is lazy: runDir is created on first event, not at construction', async () => {
    const lateDir = join(runDir, 'nested', 'fresh');
    const lateBus = new EventBus();
    const lateP = new EventPersistor({ runPath: new RunPath({ id: 'late-run', dir: lateDir }) });
    const lateUnsub = lateBus.addSink(lateP);
    await expect(stat(lateDir)).rejects.toThrow();
    lateBus.emit({ t: 'run:start', runId: 'r1', totalTests: 0, timestamp: 0 });
    await lateP.flush();
    const s = await stat(lateDir);
    expect(s.isDirectory()).toBe(true);
    lateUnsub();
  });
});
