// End-to-end integration test: spawn `reactlens run` against the fixture,
// connect a WS client to the dashboard, and verify the full event protocol
// flows: run:start → test:start → component:snapshot → frame → test:end →
// run:end. This is the closest thing to a smoke test for the moat.
//
// Slow (≈10s); only included in `pnpm test:integration`.
import { execa, type ResultPromise } from 'execa';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

const REPO_ROOT = join(__dirname, '..', '..');
const FIXTURE = join(REPO_ROOT, 'tests', 'fixtures', 'vite-react-router');

function probeBuilt(): boolean {
  return existsSync(join(REPO_ROOT, 'dist', 'probe', 'probe.global.js'));
}

let proc: ResultPromise | null = null;

afterAll(async () => {
  if (proc !== null) {
    try {
      proc.kill('SIGINT');
    } catch {
      /* already dead */
    }
  }
});

describe('reactlens run flow', () => {
  it.skipIf(!probeBuilt())('emits the full event protocol against the fixture', async () => {
    proc = execa('node', [join(REPO_ROOT, 'bin', 'reactlens.js'), 'run', '--cwd', FIXTURE, '--no-open'], {
      cwd: REPO_ROOT,
      reject: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const events: Record<string, number> = {};
    let resolveDone: (() => void) | undefined;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });

    // Wait for dashboard to come up.
    await new Promise((r) => setTimeout(r, 4_000));

    let ws: WebSocket;
    try {
      ws = new WebSocket('ws://localhost:7777/ws/dashboard');
    } catch (err) {
      // Dashboard didn't start in time; abort but don't fail with a noisy error.
      throw new Error(`dashboard WS unavailable: ${(err as Error).message}`);
    }

    ws.on('message', (data) => {
      try {
        const ev = JSON.parse(data.toString()) as { t?: string };
        if (typeof ev.t === 'string') {
          events[ev.t] = (events[ev.t] ?? 0) + 1;
          if (ev.t === 'run:end') {
            ws.close();
            resolveDone?.();
          }
        }
      } catch {
        /* ignore */
      }
    });

    await Promise.race([
      done,
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error('timeout')), 60_000)),
    ]);

    expect(events['run:start']).toBeGreaterThanOrEqual(1);
    expect(events['test:start']).toBeGreaterThanOrEqual(1);
    expect(events['test:end']).toBeGreaterThanOrEqual(1);
    expect(events['run:end']).toBeGreaterThanOrEqual(1);
    // Moat: component snapshots must be flowing.
    expect(events['component:snapshot']).toBeGreaterThan(0);
    // Screencast frames flow once CDP attaches.
    expect(events['frame']).toBeGreaterThan(0);

    // Wait for the runner to exit so cleanup doesn't leak.
    await proc.catch(() => undefined);
  }, 120_000);
});
