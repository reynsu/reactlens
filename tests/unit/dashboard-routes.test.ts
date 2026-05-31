// Spins up the real dashboard server against a tmpdir runsDir and verifies
// the past-runs API routes end-to-end (sans Playwright). This catches route
// mounting + error-mapping regressions that pure-helper tests can't.
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventBus } from '../../src/runner/event-bus';
import { startDashboardServer, type DashboardServer } from '../../src/dashboard/server';
import { RunsArea } from '../../src/runs/run-paths';

let runsDir: string;
let area: RunsArea;
let server: DashboardServer;
let baseUrl: string;

async function seedRun(id: string, events: unknown[]): Promise<void> {
  await mkdir(join(runsDir, id), { recursive: true });
  await writeFile(
    join(runsDir, id, 'events.jsonl'),
    events.map((e) => JSON.stringify(e)).join('\n') + '\n',
  );
}

beforeEach(async () => {
  // Use a tmpdir as cwd; RunsArea computes <cwd>/.reactlens/runs as runsDir.
  // We write seeds directly under that path so the API serves them.
  const cwd = await mkdtemp(join(tmpdir(), 'reactlens-routes-'));
  area = new RunsArea(cwd);
  runsDir = area.runsDir;
  await mkdir(runsDir, { recursive: true });
  server = await startDashboardServer({ port: 0, bus: new EventBus(), runsArea: area });
  baseUrl = `http://localhost:${server.port}`;
});

afterEach(async () => {
  await server.close();
});

describe('GET /api/runs', () => {
  it('returns sorted-desc summaries with stats extracted from the JSONL', async () => {
    await seedRun('2026-05-14T10-00-00-000Z-aaaaaaaa', [
      { t: 'run:start', runId: '2026-05-14T10-00-00-000Z-aaaaaaaa', totalTests: 2, timestamp: 1 },
      { t: 'run:end', passed: 2, failed: 0, skipped: 0, duration: 10 },
    ]);
    await seedRun('2026-05-14T11-00-00-000Z-bbbbbbbb', [
      { t: 'run:start', runId: '2026-05-14T11-00-00-000Z-bbbbbbbb', totalTests: 3, timestamp: 2 },
    ]);
    const res = await fetch(`${baseUrl}/api/runs`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ runId: string; totalTests?: number; passed?: number }>;
    expect(body.map((r) => r.runId)).toEqual([
      '2026-05-14T11-00-00-000Z-bbbbbbbb',
      '2026-05-14T10-00-00-000Z-aaaaaaaa',
    ]);
    expect(body[0]!.totalTests).toBe(3);
    expect(body[1]!.passed).toBe(2);
  });

  it('returns [] when no runs exist yet', async () => {
    const res = await fetch(`${baseUrl}/api/runs`);
    expect(await res.json()).toEqual([]);
  });
});

describe('GET /api/runs/:id/events', () => {
  it('serves the raw NDJSON with the correct content-type', async () => {
    await seedRun('r1', [
      { t: 'run:start', runId: 'r1', totalTests: 1, timestamp: 1 },
      { t: 'run:end', passed: 1, failed: 0, skipped: 0, duration: 5 },
    ]);
    const res = await fetch(`${baseUrl}/api/runs/r1/events`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/x-ndjson/);
    const lines = (await res.text()).trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).t).toBe('run:start');
  });

  it('returns 400 on path-traversal attempts', async () => {
    const res = await fetch(`${baseUrl}/api/runs/..%2Fetc%2Fpasswd/events`);
    expect(res.status).toBe(400);
  });

  it('returns 404 when the run does not exist', async () => {
    const res = await fetch(`${baseUrl}/api/runs/never-existed/events`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/runs/:id/frame-track (#78)', () => {
  it('returns the ordered per-frame index for a run', async () => {
    await seedRun('r1', [
      { t: 'run:start', runId: 'r1', totalTests: 1, timestamp: 1 },
      { t: 'step:start', testId: 't1', stepId: 's1', title: 'a' },
      { t: 'frame', testId: 't1', stepId: 's1', sessionId: 'x', frameRef: 'frames/t1/0.jpg', timestamp: 1700000000001 },
      { t: 'frame', testId: 't1', stepId: 's1', sessionId: 'x', frameRef: 'frames/t1/1.jpg', timestamp: 1700000000002 },
      { t: 'run:end', passed: 1, failed: 0, skipped: 0, duration: 5 },
    ]);
    const res = await fetch(`${baseUrl}/api/runs/r1/frame-track`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body).toEqual([
      { testId: 't1', stepId: 's1', frameRef: 'frames/t1/0.jpg', timestamp: 1700000000001 },
      { testId: 't1', stepId: 's1', frameRef: 'frames/t1/1.jpg', timestamp: 1700000000002 },
    ]);
  });

  it('returns [] for a pre-feature run with no frames', async () => {
    await seedRun('r2', [
      { t: 'run:start', runId: 'r2', totalTests: 1, timestamp: 1 },
      { t: 'run:end', passed: 1, failed: 0, skipped: 0, duration: 5 },
    ]);
    const res = await fetch(`${baseUrl}/api/runs/r2/frame-track`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('returns 404 when the run does not exist and 400 on bad ids', async () => {
    expect((await fetch(`${baseUrl}/api/runs/nope/frame-track`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/runs/..%2Fbad/frame-track`)).status).toBe(400);
  });
});

describe('GET /api/runs/:id/frames/:testId/:filename', () => {
  it('serves the JPEG bytes for a real frame on disk', async () => {
    await mkdir(join(runsDir, 'r1', 'frames', 't1'), { recursive: true });
    const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    await writeFile(join(runsDir, 'r1', 'frames', 't1', 's1.jpg'), fakeJpeg);
    const res = await fetch(`${baseUrl}/api/runs/r1/frames/t1/s1.jpg`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/image\/jpeg/);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.equals(fakeJpeg)).toBe(true);
  });

  it('returns 404 when the frame file is missing', async () => {
    const res = await fetch(`${baseUrl}/api/runs/r1/frames/t1/ghost.jpg`);
    expect(res.status).toBe(404);
  });

  it('returns 400 on bad ids', async () => {
    const res = await fetch(`${baseUrl}/api/runs/..%2Fbad/frames/t1/s1.jpg`);
    expect(res.status).toBe(400);
  });
});
