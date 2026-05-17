// P8 task 7 — end-to-end test of the replay path:
//   1. Run reactlens once against the fastest fixture, let it write a
//      .reactlens/runs/<id>/ directory to disk.
//   2. Spin up a fresh dashboard server (no live bus traffic) pointed at the
//      just-written runsDir.
//   3. Hit /api/runs, /api/runs/:id/events, and /api/runs/:id/frames/...
//   4. Reconstruct the timeline via buildTimelineFromEvents — the same
//      function the frontend uses — and assert it carries real frame URLs
//      + at least one captured component tree.
//
// This covers what the WS-based run-flow integration test can't: the
// "open the dashboard tomorrow and look at yesterday's run" path.
import { execa, type ResultPromise } from 'execa';
import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDashboardServer, type DashboardServer } from '../../src/dashboard/server';
import { EventBus } from '../../src/runner/event-bus';
import { RunsArea } from '../../src/runs/run-paths';
import type { TimelineStep } from '@reynsu/reactlens-dashboard-ui';

// Canonical replay-timeline parser lives bundled in
// @reynsu/reactlens-dashboard-ui's SPA — it isn't separately consumable as
// a Node module from that package today (only the SPA bundle + types are
// shipped). For this integration test we replicate the parser's contract
// inline. If/when the dashboard-ui ships a dual-build (SPA + Node lib),
// drop this and import the published function directly.
type Timeline = Map<string, TimelineStep[]>;
function buildTimelineFromEvents(
  ndjson: string,
  frameUrl: (frameRef: string) => string,
): Timeline {
  const timelineByTest: Timeline = new Map();
  const openStepIdx = new Map<string, number>();
  for (const line of ndjson.split('\n')) {
    if (line.length === 0) continue;
    let event: { t?: string } & Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof event.t !== 'string') continue;
    if (event.t === 'step:start') {
      const testId = event['testId'] as string;
      const arr = timelineByTest.get(testId) ?? [];
      arr.push({ stepId: event['stepId'] as string, title: event['title'] as string });
      timelineByTest.set(testId, arr);
      openStepIdx.set(testId, arr.length - 1);
    } else if (event.t === 'frame') {
      const testId = event['testId'] as string;
      const arr = timelineByTest.get(testId);
      const idx = openStepIdx.get(testId);
      const frameRef = event['frameRef'] as string | undefined;
      if (arr !== undefined && idx !== undefined && frameRef !== undefined) {
        const step = arr[idx];
        if (step !== undefined) step.frame = { kind: 'url', url: frameUrl(frameRef) };
      }
    } else if (event.t === 'component:snapshot') {
      const testId = event['testId'] as string;
      const stepId = event['stepId'] as string;
      const arr = timelineByTest.get(testId);
      if (arr !== undefined && arr.length > 0) {
        const matched = arr.findIndex((s) => s.stepId === stepId);
        const idx = matched >= 0 ? matched : (openStepIdx.get(testId) ?? arr.length - 1);
        const step = arr[idx];
        if (step !== undefined) {
          step.tree = event['tree'] as TimelineStep['tree'];
        }
      }
    }
  }
  return timelineByTest;
}

const REPO_ROOT = join(__dirname, '..', '..');
const FIXTURE = join(REPO_ROOT, 'tests', 'fixtures', 'vite-react-router');
const RUNS_DIR = join(FIXTURE, '.reactlens', 'runs');

function probeBuilt(): boolean {
  return existsSync(join(REPO_ROOT, 'dist', 'probe', 'probe.global.js'));
}

let server: DashboardServer | null = null;
let baseUrl = '';
let latestRunId = '';

async function newestRunId(dir: string): Promise<string> {
  const entries = await readdir(dir);
  const withStat = await Promise.all(
    entries.map(async (name) => {
      const s = await stat(join(dir, name));
      return { name, mtime: s.mtimeMs, isDir: s.isDirectory() };
    }),
  );
  const dirs = withStat.filter((e) => e.isDir).sort((a, b) => b.mtime - a.mtime);
  if (dirs.length === 0) throw new Error('no run directories in ' + dir);
  return dirs[0]!.name;
}

beforeAll(async () => {
  if (!probeBuilt()) return;
  // Drive Playwright once to seed a real run on disk. We pipe stdio to
  // /dev/null and just wait for exit — the WS-flow test already exercises
  // the live event protocol; this test only cares about post-run artifacts.
  const proc: ResultPromise = execa(
    'node',
    [join(REPO_ROOT, 'bin', 'reactlens.js'), 'run', '--cwd', FIXTURE, '--no-open'],
    { cwd: REPO_ROOT, reject: false, stdio: 'ignore' },
  );
  await proc.catch(() => undefined);

  latestRunId = await newestRunId(RUNS_DIR);
  // RunsArea computes runsDir as <cwd>/.reactlens/runs — pointing it at the
  // fixture gives back the same RUNS_DIR we just listed from.
  const area = new RunsArea(FIXTURE);
  server = await startDashboardServer({ port: 0, bus: new EventBus(), runsArea: area });
  baseUrl = `http://localhost:${server.port}`;
}, 120_000);

afterAll(async () => {
  if (server !== null) await server.close();
});

describe('replay from disk', () => {
  it.skipIf(!probeBuilt())(
    'lists the persisted run via /api/runs',
    async () => {
      const res = await fetch(`${baseUrl}/api/runs`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{ runId: string; totalTests?: number }>;
      const found = body.find((r) => r.runId === latestRunId);
      expect(found, `run ${latestRunId} not in /api/runs response`).toBeDefined();
      expect(found?.totalTests).toBeGreaterThan(0);
    },
  );

  it.skipIf(!probeBuilt())(
    'serves the run NDJSON and the timeline builder finds real steps + frames',
    async () => {
      const eventsRes = await fetch(`${baseUrl}/api/runs/${latestRunId}/events`);
      expect(eventsRes.status).toBe(200);
      const text = await eventsRes.text();
      expect(text.length).toBeGreaterThan(0);

      const frameUrl = (frameRef: string): string =>
        `${baseUrl}/api/runs/${latestRunId}/${frameRef}`;
      const timeline = buildTimelineFromEvents(text, frameUrl);

      const tests = Array.from(timeline.entries());
      expect(tests.length, 'no tests in timeline').toBeGreaterThan(0);

      const withFrames = tests.filter(([, steps]) => steps.some((s) => s.frame !== undefined));
      const withTrees = tests.filter(([, steps]) => steps.some((s) => s.tree !== undefined));
      expect(withFrames.length, 'no test had a frame attached to any step').toBeGreaterThan(0);
      expect(withTrees.length, 'no test had a component tree attached to any step').toBeGreaterThan(0);

      const sampleStep = withFrames[0]![1].find((s) => s.frame !== undefined)!;
      expect(sampleStep.frame!.kind).toBe('url');
      const url = (sampleStep.frame as { kind: 'url'; url: string }).url;
      expect(url).toMatch(/^http:\/\//);
    },
  );

  it.skipIf(!probeBuilt())(
    'serves the JPEG bytes that the timeline references',
    async () => {
      const eventsRes = await fetch(`${baseUrl}/api/runs/${latestRunId}/events`);
      const text = await eventsRes.text();
      const frameUrl = (frameRef: string): string =>
        `${baseUrl}/api/runs/${latestRunId}/${frameRef}`;
      const timeline = buildTimelineFromEvents(text, frameUrl);

      const firstFrame = Array.from(timeline.values())
        .flat()
        .find((s) => s.frame !== undefined);
      expect(firstFrame, 'no frame to fetch').toBeDefined();
      const url = (firstFrame!.frame as { kind: 'url'; url: string }).url;
      const frameRes = await fetch(url);
      expect(frameRes.status).toBe(200);
      expect(frameRes.headers.get('content-type')).toMatch(/image\/jpeg/);
      const buf = Buffer.from(await frameRes.arrayBuffer());
      expect(buf.byteLength).toBeGreaterThan(0);
    },
  );
});
