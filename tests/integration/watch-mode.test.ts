// P10 — Watch mode contract.
//
// Spawns `reactlens run --watch` against the vite-react-router fixture,
// waits for the initial run to land its .reactlens/runs/<id>/ directory,
// touches a file under <fixture>/src, then asserts a SECOND run directory
// appears within the deadline. Sends SIGINT and confirms clean exit.
//
// This is the acceptance gate for the watch loop: the inner dev loop must
// actually re-run on a source change. Without it the feature is hollow.
import { execa, type ResultPromise } from 'execa';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..');
const FIXTURE = join(REPO_ROOT, 'tests', 'fixtures', 'vite-react-router');
const RUNS_DIR = join(FIXTURE, '.reactlens', 'runs');
const TRIGGER_FILE = join(FIXTURE, 'src', '__watch_trigger.txt');

function probeBuilt(): boolean {
  return existsSync(join(REPO_ROOT, 'dist', 'probe', 'probe.global.js'));
}

async function listRunIds(): Promise<string[]> {
  try {
    return await readdir(RUNS_DIR);
  } catch {
    return [];
  }
}

// Poll until predicate() resolves true or the deadline elapses. We use this
// because chokidar startup + Playwright run completion happen on independent
// clocks and any fixed sleep would be a guess.
async function poll(predicate: () => Promise<boolean>, deadlineMs: number, intervalMs = 500): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`poll timed out after ${deadlineMs}ms`);
}

let proc: ResultPromise | null = null;

beforeAll(async () => {
  // Start from a clean slate so the runs count reflects only what this test
  // produces. The fixture's run-flow + replay tests rebuild from scratch in
  // their own beforeAll, so we don't step on them.
  await rm(RUNS_DIR, { recursive: true, force: true });
  await rm(TRIGGER_FILE, { force: true });
});

afterAll(async () => {
  if (proc !== null && proc.exitCode === null) {
    try {
      proc.kill('SIGINT');
    } catch {
      /* already dead */
    }
  }
  await proc?.catch(() => undefined);
  await rm(TRIGGER_FILE, { force: true });
});

// Also skipped in CI: the watch loop depends on the same chromium
// probe path that fails in headless GitHub Actions runners; afterAll
// then times out waiting for the child to exit cleanly. Tracked in
// the follow-up issue cited in .github/workflows/integration.yml.
describe.skipIf(!probeBuilt() || Boolean(process.env.CI))('reactlens run --watch', () => {
  it(
    're-runs the suite when a source file under <cwd>/src changes',
    async () => {
      proc = execa(
        'node',
        [join(REPO_ROOT, 'bin', 'reactlens.js'), 'run', '--cwd', FIXTURE, '--no-open', '--watch'],
        { cwd: REPO_ROOT, reject: false, stdio: ['ignore', 'pipe', 'pipe'] },
      );

      // pino-pretty writes to stdout (not stderr), so the "ready" line lands
      // there alongside the streaming-reporter table. Plain substring check
      // is sufficient — the line is unique.
      let watcherReady = false;
      const onChunk = (chunk: Buffer | string): void => {
        if (!watcherReady && chunk.toString().includes('watch mode: ready')) {
          watcherReady = true;
        }
      };
      proc.stdout?.on('data', onChunk);
      proc.stderr?.on('data', onChunk);

      // Step 1: the initial run must produce exactly one runs/<id>/ entry
      // AND chokidar must have armed its watcher. The runs dir appears at
      // the START of the first run (persistor mkdir); the watcher only
      // arms after that run completes. Wait for both, otherwise the
      // trigger-file write below lands in the pre-ready gap and is
      // dropped by ignoreInitial: true.
      await poll(async () => (await listRunIds()).length >= 1 && watcherReady, 120_000);
      const beforeIds = new Set(await listRunIds());
      expect(beforeIds.size).toBe(1);

      // Step 2: write a fresh file under src/. Now that chokidar is ready,
      // this fires an add → debounced trigger → re-run.
      await mkdir(join(FIXTURE, 'src'), { recursive: true });
      await writeFile(TRIGGER_FILE, `// watch trigger ${Date.now()}\n`);

      // Step 3: a second runId must appear within the deadline.
      await poll(
        async () => {
          const ids = await listRunIds();
          return ids.length > 1 && ids.some((id) => !beforeIds.has(id));
        },
        90_000,
      );

      const afterIds = await listRunIds();
      expect(afterIds.length).toBeGreaterThanOrEqual(2);
      const newIds = afterIds.filter((id) => !beforeIds.has(id));
      expect(newIds.length).toBeGreaterThan(0);
    },
    300_000,
  );
});
