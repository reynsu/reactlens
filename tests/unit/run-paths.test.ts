// Covers the run-paths module end-to-end. Mirrors the test surface of the
// pre-migration runs-index tests (commit 2 will retire that file) and adds
// coverage for the two value objects (RunPath, RunsArea) and the eager
// gitignore write in openRunsArea.
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  RunPath,
  RunsArea,
  assertSafeId,
  frameExists,
  openRunsArea,
  sanitizeSegment,
} from '../../src/runs/run-paths';

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'reactlens-runs-area-'));
});

async function seedRun(area: RunsArea, id: string, events: unknown[]): Promise<string> {
  const dir = join(area.runsDir, id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return dir;
}

describe('assertSafeId — read-side validation', () => {
  it('accepts ids that match the documented charset', () => {
    expect(() => assertSafeId('run id', '2026-05-14T10-00-00-000Z-aaaaaaaa')).not.toThrow();
    expect(() => assertSafeId('test id', 't1')).not.toThrow();
    expect(() => assertSafeId('frame', 'step-a.jpg')).not.toThrow();
  });

  it('rejects path-traversal segments', () => {
    expect(() => assertSafeId('run id', '..')).toThrow(/invalid run id/i);
    expect(() => assertSafeId('run id', '.')).toThrow(/invalid run id/i);
    expect(() => assertSafeId('run id', '../etc/passwd')).toThrow(/invalid/i);
    expect(() => assertSafeId('run id', '/absolute')).toThrow(/invalid/i);
    expect(() => assertSafeId('run id', 'a/b')).toThrow(/invalid/i);
    expect(() => assertSafeId('run id', 'a\\b')).toThrow(/invalid/i);
  });
});

describe('sanitizeSegment — write-side filename safety', () => {
  it('replaces filesystem-forbidden chars with underscore', () => {
    expect(sanitizeSegment('beforeEach hook for "test:start"')).toBe(
      'beforeEach_hook_for__test_start_',
    );
  });

  it('collapses runs of spaces into a single underscore (second pass, \\s+)', () => {
    // Spaces survive the first pass (not in FORBIDDEN_FILENAME_CHARS). The
    // second pass /\\s+/ then matches each contiguous run.
    expect(sanitizeSegment('a   b   c')).toBe('a_b_c');
  });

  it('replaces control chars 1:1 in the first pass — does NOT collapse them', () => {
    // Tabs / newlines are inside the 0x00-0x1f range so the first pass
    // already turns each one into its own underscore. \\s+ then has nothing
    // left to collapse since the underscores are not whitespace.
    expect(sanitizeSegment('a\t\tb')).toBe('a__b');
    expect(sanitizeSegment('a\n\nc')).toBe('a__c');
  });

  it('preserves dashes verbatim — runIds (which use dashes) round-trip cleanly', () => {
    expect(sanitizeSegment('step-001')).toBe('step-001');
    expect(sanitizeSegment('test-1')).toBe('test-1');
  });

  it('preserves legible alphanumerics verbatim', () => {
    expect(sanitizeSegment('step001')).toBe('step001');
  });

  it('hashes when result exceeds 80 chars (Windows MAX_PATH headroom)', () => {
    const longRaw = 'a'.repeat(200);
    const out = sanitizeSegment(longRaw);
    expect(out.length).toBeLessThanOrEqual(73); // 64 prefix + 1 dash + 8 hash
    expect(out).toMatch(/^a{64}-[a-f0-9]{8}$/);
  });

  it('produces a stable hash for equal inputs', () => {
    const longRaw = 'x'.repeat(150);
    expect(sanitizeSegment(longRaw)).toBe(sanitizeSegment(longRaw));
  });
});

describe('RunPath — per-run value object', () => {
  it('computes eventsPath and framesDir up front from dir', () => {
    const rp = new RunPath({ id: 'r1', dir: '/tmp/.reactlens/runs/r1' });
    expect(rp.id).toBe('r1');
    expect(rp.dir).toBe('/tmp/.reactlens/runs/r1');
    expect(rp.eventsPath).toBe('/tmp/.reactlens/runs/r1/events.jsonl');
    expect(rp.framesDir).toBe('/tmp/.reactlens/runs/r1/frames');
  });

  it('rejects unsafe ids in its constructor', () => {
    expect(() => new RunPath({ id: '..', dir: '/tmp/x' })).toThrow(/invalid run id/i);
    expect(() => new RunPath({ id: 'a/b', dir: '/tmp/x' })).toThrow(/invalid run id/i);
  });

  it('framePath sanitizes testId and stepId before joining under framesDir', () => {
    const rp = new RunPath({ id: 'r1', dir: '/tmp/run' });
    const path = rp.framePath('test:1', 'step "with quotes"');
    expect(path).toBe('/tmp/run/frames/test_1/step__with_quotes_.jpg');
  });
});

describe('RunsArea — per-cwd surface', () => {
  it('computes reactlensDir and runsDir from cwd in its constructor', () => {
    const area = new RunsArea('/work');
    expect(area.cwd).toBe('/work');
    expect(area.reactlensDir).toBe('/work/.reactlens');
    expect(area.runsDir).toBe('/work/.reactlens/runs');
  });

  it('startRun returns a RunPath with a fresh id under runsDir', () => {
    const area = new RunsArea(cwd);
    const a = area.startRun();
    const b = area.startRun();
    expect(a.id).not.toBe(b.id);
    expect(a.dir).toBe(join(area.runsDir, a.id));
    expect(a.eventsPath).toBe(join(area.runsDir, a.id, 'events.jsonl'));
  });
});

describe('RunsArea.list', () => {
  it('returns an empty list when runsDir does not exist', async () => {
    const area = new RunsArea(cwd);
    expect(await area.list()).toEqual([]);
  });

  it('returns runs sorted descending by id (newest first)', async () => {
    const area = new RunsArea(cwd);
    await seedRun(area, '2026-05-14T10-00-00-000Z-aaaaaaaa', [
      { t: 'run:start', runId: '2026-05-14T10-00-00-000Z-aaaaaaaa', totalTests: 3, timestamp: 1 },
    ]);
    await seedRun(area, '2026-05-14T11-00-00-000Z-bbbbbbbb', [
      { t: 'run:start', runId: '2026-05-14T11-00-00-000Z-bbbbbbbb', totalTests: 5, timestamp: 2 },
    ]);
    const result = await area.list();
    expect(result.map((r) => r.runId)).toEqual([
      '2026-05-14T11-00-00-000Z-bbbbbbbb',
      '2026-05-14T10-00-00-000Z-aaaaaaaa',
    ]);
  });

  it('extracts metadata from first/last lines (run:start and run:end)', async () => {
    const area = new RunsArea(cwd);
    await seedRun(area, 'r1', [
      { t: 'run:start', runId: 'r1', totalTests: 4, timestamp: 1000 },
      { t: 'test:start', id: 't1', title: 'a', file: 'a.spec.ts', suite: 's' },
      { t: 'run:end', passed: 3, failed: 1, skipped: 0, duration: 4500 },
    ]);
    const [run] = await area.list();
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
    const area = new RunsArea(cwd);
    await seedRun(area, 'in-progress', [
      { t: 'run:start', runId: 'in-progress', totalTests: 2, timestamp: 500 },
      { t: 'test:start', id: 't1', title: 'a', file: 'a.spec.ts', suite: 's' },
    ]);
    const [run] = await area.list();
    expect(run?.runId).toBe('in-progress');
    expect(run?.passed).toBeUndefined();
    expect(run?.failed).toBeUndefined();
  });

  it('skips directories that have no events.jsonl', async () => {
    const area = new RunsArea(cwd);
    await mkdir(join(area.runsDir, 'orphan'), { recursive: true });
    await seedRun(area, 'real-run', [
      { t: 'run:start', runId: 'real-run', totalTests: 1, timestamp: 1 },
    ]);
    const result = await area.list();
    expect(result.map((r) => r.runId)).toEqual(['real-run']);
  });
});

describe('RunsArea.loadEvents', () => {
  it('returns the raw NDJSON content for a valid run id', async () => {
    const area = new RunsArea(cwd);
    await seedRun(area, 'r1', [
      { t: 'run:start', runId: 'r1', totalTests: 1, timestamp: 1 },
      { t: 'run:end', passed: 1, failed: 0, skipped: 0, duration: 10 },
    ]);
    const text = await area.loadEvents('r1');
    const lines = text.trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).t).toBe('run:start');
  });

  it('rejects ids containing path-traversal segments', async () => {
    const area = new RunsArea(cwd);
    await expect(area.loadEvents('../etc/passwd')).rejects.toThrow(/invalid run id/i);
    await expect(area.loadEvents('..')).rejects.toThrow(/invalid run id/i);
    await expect(area.loadEvents('/absolute')).rejects.toThrow(/invalid run id/i);
    await expect(area.loadEvents('a/b')).rejects.toThrow(/invalid run id/i);
  });

  it('throws a 404-shaped error when the run does not exist', async () => {
    const area = new RunsArea(cwd);
    await expect(area.loadEvents('does-not-exist')).rejects.toThrow(/run not found/i);
  });
});

describe('RunsArea.resolveFramePath', () => {
  it('returns the absolute path for a valid (runId, testId, filename) tuple', async () => {
    const area = new RunsArea(cwd);
    await mkdir(join(area.runsDir, 'r1', 'frames', 't1'), { recursive: true });
    await writeFile(join(area.runsDir, 'r1', 'frames', 't1', 'step-a.jpg'), 'fake');
    const path = area.resolveFramePath('r1', 't1', 'step-a.jpg');
    expect(path).toBe(join(area.runsDir, 'r1', 'frames', 't1', 'step-a.jpg'));
  });

  it('rejects any path-traversal attempt in any segment', () => {
    const area = new RunsArea(cwd);
    expect(() => area.resolveFramePath('..', 't1', 'x.jpg')).toThrow();
    expect(() => area.resolveFramePath('r1', '..', 'x.jpg')).toThrow();
    expect(() => area.resolveFramePath('r1', 't1', '../escape.jpg')).toThrow();
    expect(() => area.resolveFramePath('r1', 't1', '/etc/passwd')).toThrow();
  });
});

describe('openRunsArea — eager gitignore', () => {
  it('writes .reactlens/.gitignore on first open', async () => {
    const area = await openRunsArea(cwd);
    const contents = await readFile(join(area.reactlensDir, '.gitignore'), 'utf8');
    expect(contents).toBe('*\n');
  });

  it('is idempotent — does not overwrite an existing user .gitignore', async () => {
    await mkdir(join(cwd, '.reactlens'), { recursive: true });
    await writeFile(join(cwd, '.reactlens', '.gitignore'), '# user customised\n!keep-this\n');
    await openRunsArea(cwd);
    const contents = await readFile(join(cwd, '.reactlens', '.gitignore'), 'utf8');
    expect(contents).toBe('# user customised\n!keep-this\n');
  });

  it('is idempotent across multiple calls (watch iteration safety)', async () => {
    const a = await openRunsArea(cwd);
    const b = await openRunsArea(cwd);
    expect(a.runsDir).toBe(b.runsDir);
    await expect(access(join(a.reactlensDir, '.gitignore'))).resolves.not.toThrow();
  });
});

describe('frameExists', () => {
  it('returns true for an existing file', async () => {
    const file = join(cwd, 'real.jpg');
    await writeFile(file, 'data');
    expect(await frameExists(file)).toBe(true);
  });

  it('returns false for a missing path', async () => {
    expect(await frameExists(join(cwd, 'missing.jpg'))).toBe(false);
  });

  it('returns false for a directory (only regular files count as frames)', async () => {
    expect(await frameExists(cwd)).toBe(false);
  });
});
