// End-to-end integration test: spawn `reactlens run` against each fixture,
// connect a WS client to the dashboard, and verify the full event protocol
// flows: run:start → test:start → component:snapshot → frame → test:end →
// run:end. This is the closest thing to a smoke test for the moat.
//
// Runs against all three fixtures sequentially (dashboard binds to :7777 so
// they cannot overlap). Slow (~30s total); only included in
// `pnpm test:integration`.
import { execa, type ResultPromise } from 'execa';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

const REPO_ROOT = join(__dirname, '..', '..');

const FIXTURES = [
  { name: 'vite-react-router', path: join(REPO_ROOT, 'tests', 'fixtures', 'vite-react-router') },
  { name: 'vite-react-router-19', path: join(REPO_ROOT, 'tests', 'fixtures', 'vite-react-router-19') },
  { name: 'next-app-router', path: join(REPO_ROOT, 'tests', 'fixtures', 'next-app-router') },
  { name: 'tanstack-router', path: join(REPO_ROOT, 'tests', 'fixtures', 'tanstack-router') },
] as const;

function probeBuilt(): boolean {
  return existsSync(join(REPO_ROOT, 'dist', 'probe', 'probe.global.js'));
}

let proc: ResultPromise | null = null;

afterEach(async () => {
  if (proc !== null) {
    try {
      proc.kill('SIGINT');
    } catch {
      /* already dead */
    }
    await proc.catch(() => undefined);
    proc = null;
  }
});

describe('reactlens run flow', () => {
  it.skipIf(!probeBuilt()).each(FIXTURES)(
    'emits the full event protocol against the $name fixture',
    async (fixture) => {
      proc = execa('node', [join(REPO_ROOT, 'bin', 'reactlens.js'), 'run', '--cwd', fixture.path, '--no-open'], {
        cwd: REPO_ROOT,
        reject: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const events: Record<string, number> = {};
      // Track per-event details we want to assert on. Keeping these light to
      // avoid bloating the test's memory profile on long Next runs.
      let sawSnapshotWithStepRewrite = false;
      let resolveDone: (() => void) | undefined;
      const done = new Promise<void>((resolve) => {
        resolveDone = resolve;
      });

      // Dashboard lifetime is bounded by the run itself: it opens before tests
      // start and closes the moment `runTests` returns. Some fixtures (Next,
      // TanStack) finish in ~2 s, so any fixed warmup would miss the window.
      // Poll until the dashboard accepts a WS connection or 30 s elapse.
      const ws = await new Promise<WebSocket>((resolve, reject) => {
        const deadline = Date.now() + 30_000;
        const tryConnect = (): void => {
          const candidate = new WebSocket('ws://localhost:7777/ws/dashboard');
          candidate.once('open', () => resolve(candidate));
          candidate.once('error', () => {
            candidate.removeAllListeners();
            try {
              candidate.terminate();
            } catch {
              /* ignore */
            }
            if (Date.now() > deadline) {
              reject(new Error(`dashboard WS never came up for ${fixture.name}`));
              return;
            }
            setTimeout(tryConnect, 200);
          });
        };
        tryConnect();
      });

      ws.on('message', (data) => {
        try {
          const ev = JSON.parse(data.toString()) as { t?: string; testId?: string; stepId?: string };
          if (typeof ev.t === 'string') {
            events[ev.t] = (events[ev.t] ?? 0) + 1;
            if (
              ev.t === 'component:snapshot' &&
              typeof ev.testId === 'string' &&
              typeof ev.stepId === 'string' &&
              ev.stepId !== ev.testId
            ) {
              sawSnapshotWithStepRewrite = true;
            }
            if (ev.t === 'run:end') {
              ws.close();
              resolveDone?.();
            }
          }
        } catch {
          /* ignore */
        }
      });

      const fixtureTimeout = fixture.name === 'next-app-router' ? 90_000 : 60_000;
      await Promise.race([
        done,
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error(`timeout for ${fixture.name}`)), fixtureTimeout)
        ),
      ]);

      expect(events['run:start'], `run:start in ${fixture.name}`).toBeGreaterThanOrEqual(1);
      expect(events['test:start'], `test:start in ${fixture.name}`).toBeGreaterThanOrEqual(1);
      expect(events['test:end'], `test:end in ${fixture.name}`).toBeGreaterThanOrEqual(1);
      expect(events['run:end'], `run:end in ${fixture.name}`).toBeGreaterThanOrEqual(1);
      // Moat: component snapshots must be flowing on every supported stack.
      expect(events['component:snapshot'], `component:snapshot in ${fixture.name}`).toBeGreaterThan(0);
      expect(events['frame'], `frame in ${fixture.name}`).toBeGreaterThan(0);
      // Server-side stepId rewrite: at least one snapshot during the run must
      // carry a stepId derived from a step:start event (i.e. not equal to the
      // testId default the fixture bakes in). This proves end-to-end that
      // step:start → activeStep → snapshot rewrite is wired correctly.
      expect(sawSnapshotWithStepRewrite, `stepId rewrite never fired in ${fixture.name}`).toBe(true);

      await proc.catch(() => undefined);
    },
    180_000
  );
});
