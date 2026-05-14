import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { listRuns, loadRunEvents, resolveFramePath } from '../../src/dashboard/runs-index';

let runsDir: string;

async function seedRun(id: string, events: unknown[]): Promise<string> {
  const dir = join(runsDir, id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return dir;
}

beforeEach(async () => {
  runsDir = await mkdtemp(join(tmpdir(), 'reactlens-runs-index-'));
});

describe('listRuns', () => {
  it('returns an empty list when the runs directory does not exist', async () => {
    const missing = join(runsDir, 'never-created');
    expect(await listRuns(missing)).toEqual([]);
  });

  it('returns runs sorted descending by id (newest first)', async () => {
    await seedRun('2026-05-14T10-00-00-000Z-aaaaaaaa', [
      { t: 'run:start', runId: '2026-05-14T10-00-00-000Z-aaaaaaaa', totalTests: 3, timestamp: 1 },
    ]);
    await seedRun('2026-05-14T11-00-00-000Z-bbbbbbbb', [
      { t: 'run:start', runId: '2026-05-14T11-00-00-000Z-bbbbbbbb', totalTests: 5, timestamp: 2 },
    ]);
    const result = await listRuns(runsDir);
    expect(result.map((r) => r.runId)).toEqual([
      '2026-05-14T11-00-00-000Z-bbbbbbbb',
      '2026-05-14T10-00-00-000Z-aaaaaaaa',
    ]);
  });

  it('extracts totalTests + startedAt from the first event and end stats from the last', async () => {
    await seedRun('r1', [
      { t: 'run:start', runId: 'r1', totalTests: 4, timestamp: 1000 },
      { t: 'test:start', id: 't1', title: 'a', file: 'a.spec.ts', suite: 's' },
      { t: 'run:end', passed: 3, failed: 1, skipped: 0, duration: 4500 },
    ]);
    const [run] = await listRuns(runsDir);
    expect(run).toMatchObject({
      runId: 'r1',
      totalTests: 4,
      startedAt: 1000,
      passed: 3,
      failed: 1,
      skipped: 0,
      duration: 4500,
    });
  });

  it('handles in-progress runs gracefully (run:end absent)', async () => {
    await seedRun('in-progress', [
      { t: 'run:start', runId: 'in-progress', totalTests: 2, timestamp: 500 },
      { t: 'test:start', id: 't1', title: 'a', file: 'a.spec.ts', suite: 's' },
    ]);
    const [run] = await listRuns(runsDir);
    expect(run.runId).toBe('in-progress');
    expect(run.passed).toBeUndefined();
    expect(run.failed).toBeUndefined();
  });

  it('skips directories that have no events.jsonl', async () => {
    await mkdir(join(runsDir, 'orphan'), { recursive: true });
    await seedRun('real-run', [
      { t: 'run:start', runId: 'real-run', totalTests: 1, timestamp: 1 },
    ]);
    const result = await listRuns(runsDir);
    expect(result.map((r) => r.runId)).toEqual(['real-run']);
  });
});

describe('loadRunEvents', () => {
  it('returns the raw NDJSON content for a valid run id', async () => {
    await seedRun('r1', [
      { t: 'run:start', runId: 'r1', totalTests: 1, timestamp: 1 },
      { t: 'run:end', passed: 1, failed: 0, skipped: 0, duration: 10 },
    ]);
    const text = await loadRunEvents(runsDir, 'r1');
    const lines = text.trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).t).toBe('run:start');
  });

  it('rejects ids containing path-traversal segments', async () => {
    await expect(loadRunEvents(runsDir, '../etc/passwd')).rejects.toThrow(/invalid run id/i);
    await expect(loadRunEvents(runsDir, '..')).rejects.toThrow(/invalid run id/i);
    await expect(loadRunEvents(runsDir, '/absolute')).rejects.toThrow(/invalid run id/i);
    await expect(loadRunEvents(runsDir, 'a/b')).rejects.toThrow(/invalid run id/i);
  });

  it('throws a 404-shaped error when the run does not exist', async () => {
    await expect(loadRunEvents(runsDir, 'does-not-exist')).rejects.toThrow(/run not found/i);
  });
});

describe('resolveFramePath', () => {
  it('returns the absolute path for a valid (runId, testId, filename) tuple', async () => {
    await mkdir(join(runsDir, 'r1', 'frames', 't1'), { recursive: true });
    await writeFile(join(runsDir, 'r1', 'frames', 't1', 'step-a.jpg'), 'fake');
    const path = resolveFramePath(runsDir, 'r1', 't1', 'step-a.jpg');
    expect(path).toBe(join(runsDir, 'r1', 'frames', 't1', 'step-a.jpg'));
  });

  it('rejects any path-traversal attempt in any segment', () => {
    expect(() => resolveFramePath(runsDir, '..', 't1', 'x.jpg')).toThrow();
    expect(() => resolveFramePath(runsDir, 'r1', '..', 'x.jpg')).toThrow();
    expect(() => resolveFramePath(runsDir, 'r1', 't1', '../escape.jpg')).toThrow();
    expect(() => resolveFramePath(runsDir, 'r1', 't1', '/etc/passwd')).toThrow();
  });
});
