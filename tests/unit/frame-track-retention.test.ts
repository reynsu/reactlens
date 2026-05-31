// #81: bound the disk cost of recordings. Two pure decisions + one I/O
// executor:
//   planRetention      — which runs keep their full track, which degrade.
//   degradeEventsJsonl — rewrite a run's NDJSON to one representative frame
//                        per step + report which frame files survive.
//   applyFrameTrackRetention — the lifecycle wiring (lists, plans, prunes).
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_KEEP_RECENT,
  applyFrameTrackRetention,
  degradeEventsJsonl,
  planRetention,
} from '../../src/runs/frame-track-retention';
import { RunsArea } from '../../src/runs/run-paths';

describe('planRetention — keep the most recent N (#81)', () => {
  it('keeps the most recent 5 and degrades the rest (newest-first input)', () => {
    const runs = ['r9', 'r8', 'r7', 'r6', 'r5', 'r4', 'r3'];
    expect(planRetention(runs)).toEqual({
      keep: ['r9', 'r8', 'r7', 'r6', 'r5'],
      degrade: ['r4', 'r3'],
    });
  });

  it('keeps everything when there are 5 or fewer runs (nothing to degrade)', () => {
    expect(planRetention(['r3', 'r2', 'r1'])).toEqual({ keep: ['r3', 'r2', 'r1'], degrade: [] });
  });

  it('respects a custom keepRecent', () => {
    expect(planRetention(['a', 'b', 'c'], 1)).toEqual({ keep: ['a'], degrade: ['b', 'c'] });
  });

  it('default keep-recent is 5', () => {
    expect(DEFAULT_KEEP_RECENT).toBe(5);
  });
});

describe('degradeEventsJsonl — keep one representative frame per step (#81)', () => {
  it('preserves every non-frame line and only the LAST frame line per (test, step)', () => {
    const lines: Array<Record<string, unknown>> = [
      { t: 'run:start', runId: 'r', totalTests: 1, timestamp: 0 },
      { t: 'step:start', testId: 't1', stepId: 's1', title: 'a' },
      { t: 'frame', testId: 't1', stepId: 's1', sessionId: 'x', frameRef: 'frames/t1/0.jpg', timestamp: 1 },
      { t: 'frame', testId: 't1', stepId: 's1', sessionId: 'x', frameRef: 'frames/t1/1.jpg', timestamp: 2 },
      { t: 'step:start', testId: 't1', stepId: 's2', title: 'b' },
      { t: 'frame', testId: 't1', stepId: 's2', sessionId: 'x', frameRef: 'frames/t1/2.jpg', timestamp: 3 },
      { t: 'run:end', passed: 1, failed: 0, skipped: 0, duration: 10 },
    ];
    const raw = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
    const { jsonl, keepRefs } = degradeEventsJsonl(raw);
    const out = jsonl
      .trimEnd()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(out.map((e) => e['t'])).toEqual([
      'run:start',
      'step:start',
      'frame',
      'step:start',
      'frame',
      'run:end',
    ]);
    const frames = out.filter((e) => e['t'] === 'frame');
    expect(frames.map((f) => f['frameRef'])).toEqual(['frames/t1/1.jpg', 'frames/t1/2.jpg']);
    expect([...keepRefs].sort()).toEqual(['frames/t1/1.jpg', 'frames/t1/2.jpg']);
  });

  it('leaves an already-degraded run (one frame per step) byte-identical', () => {
    const lines: Array<Record<string, unknown>> = [
      { t: 'step:start', testId: 't1', stepId: 's1', title: 'a' },
      { t: 'frame', testId: 't1', stepId: 's1', sessionId: 'x', frameRef: 'frames/t1/0.jpg' },
    ];
    const raw = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
    const { jsonl, keepRefs } = degradeEventsJsonl(raw);
    expect(jsonl).toBe(raw);
    expect([...keepRefs]).toEqual(['frames/t1/0.jpg']);
  });
});

describe('applyFrameTrackRetention — lifecycle wiring (#81)', () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'reactlens-retention-'));
  });

  // Seed a run with two frames in one step (seq 0,1). Newest-first ordering
  // is by runId, so lexically larger ids are "newer".
  async function seedRun(area: RunsArea, id: string): Promise<void> {
    const dir = join(area.runsDir, id);
    await mkdir(join(dir, 'frames', 't1'), { recursive: true });
    const lines = [
      { t: 'run:start', runId: id, totalTests: 1, timestamp: 1 },
      { t: 'step:start', testId: 't1', stepId: 's1', title: 'a' },
      { t: 'frame', testId: 't1', stepId: 's1', sessionId: 'x', frameRef: 'frames/t1/0.jpg', timestamp: 1 },
      { t: 'frame', testId: 't1', stepId: 's1', sessionId: 'x', frameRef: 'frames/t1/1.jpg', timestamp: 2 },
      { t: 'run:end', passed: 1, failed: 0, skipped: 0, duration: 5 },
    ];
    await writeFile(join(dir, 'events.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    await writeFile(join(dir, 'frames', 't1', '0.jpg'), 'a');
    await writeFile(join(dir, 'frames', 't1', '1.jpg'), 'b');
  }

  it('prunes the oldest runs beyond the most-recent-5, keeping one still per step', async () => {
    const area = new RunsArea(cwd);
    // Seven runs, ids sortable: ...-00 (oldest) … ...-06 (newest).
    const ids = Array.from({ length: 7 }, (_, i) => `2026-05-30T10-00-0${i}-000Z-aaaaaaaa`);
    for (const id of ids) await seedRun(area, id);

    const result = await applyFrameTrackRetention(area);

    expect(result.kept).toHaveLength(5);
    expect(result.degraded.sort()).toEqual([ids[0], ids[1]].sort());

    // The two oldest runs degrade: only the last frame per step survives,
    // and the events.jsonl is rewritten to one frame line per step.
    for (const id of [ids[0]!, ids[1]!]) {
      const files = (await readdir(join(area.runsDir, id, 'frames', 't1'))).sort();
      expect(files).toEqual(['1.jpg']); // seq 0 pruned, last (1) kept
      const frames = (await readFile(join(area.runsDir, id, 'events.jsonl'), 'utf8'))
        .trimEnd()
        .split('\n')
        .map((l) => JSON.parse(l) as Record<string, unknown>)
        .filter((e) => e['t'] === 'frame');
      expect(frames).toHaveLength(1);
      expect(frames[0]?.['frameRef']).toBe('frames/t1/1.jpg');
    }

    // The five most-recent runs are untouched: both frames remain.
    for (const id of ids.slice(2)) {
      const files = (await readdir(join(area.runsDir, id, 'frames', 't1'))).sort();
      expect(files).toEqual(['0.jpg', '1.jpg']);
    }
  });

  it('is a no-op when there are 5 or fewer runs', async () => {
    const area = new RunsArea(cwd);
    const ids = ['2026-05-30T10-00-01-000Z-aaaaaaaa', '2026-05-30T10-00-02-000Z-aaaaaaaa'];
    for (const id of ids) await seedRun(area, id);
    const result = await applyFrameTrackRetention(area);
    expect(result.degraded).toEqual([]);
    for (const id of ids) {
      expect((await readdir(join(area.runsDir, id, 'frames', 't1'))).sort()).toEqual(['0.jpg', '1.jpg']);
    }
  });
});
