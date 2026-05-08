import { execa, type ResultPromise, type Subprocess } from 'execa';
import { ReactLensError } from '../utils/errors';
import { logger } from '../utils/logger';
import { EventBus } from './event-bus';
import type { RunEvent, RunEventType } from './events';

export type RunnerOptions = {
  cwd: string;
  bus: EventBus;
  // Extra args appended to `npx playwright test`. Useful for `--last-failed`
  // and grep filters from the dashboard.
  extraArgs?: string[];
  // When true, set REACTLENS_NO_WEB_SERVER=1 so the user's playwright config
  // skips its webServer block. Currently only used in tests.
  skipWebServer?: boolean;
  // WS URL the in-app probe and the screencast fixture should connect to.
  // Set when reactlens drives the run with a live dashboard.
  probeWsUrl?: string;
  // Filesystem path to the probe IIFE bundle. Used to pin lookup during
  // reactlens development (when the package isn't installed into the target
  // project's node_modules); in published use, the fixtures.ts default
  // resolution via require.resolve('reactlens/package.json') is preferred.
  probePath?: string;
};

export type RunSummary = {
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  exitCode: number;
};

const KNOWN_EVENT_TYPES = new Set<RunEventType>([
  'run:start',
  'run:end',
  'test:start',
  'test:end',
  'step:start',
  'step:end',
  'frame',
  'component:snapshot',
  'component:event',
  'diagnosis:start',
  'diagnosis:chunk',
  'diagnosis:end',
]);

function tryParseEvent(line: string): RunEvent | null {
  if (line.length === 0 || line[0] !== '{') return null;
  try {
    const parsed = JSON.parse(line) as { t?: unknown };
    if (typeof parsed.t !== 'string') return null;
    if (!KNOWN_EVENT_TYPES.has(parsed.t as RunEventType)) return null;
    return parsed as RunEvent;
  } catch {
    return null;
  }
}

class LineSplitter {
  private buffer = '';

  push(chunk: string, onLine: (line: string) => void): void {
    // Scan from a moving offset and only collapse the residual once at the
    // end; re-slicing on each newline is O(n²) for snapshot-heavy stdout.
    const combined = this.buffer + chunk;
    let start = 0;
    let idx = combined.indexOf('\n', start);
    while (idx >= 0) {
      onLine(combined.slice(start, idx));
      start = idx + 1;
      idx = combined.indexOf('\n', start);
    }
    this.buffer = start === 0 ? combined : combined.slice(start);
  }

  flush(onLine: (line: string) => void): void {
    if (this.buffer.length === 0) return;
    onLine(this.buffer);
    this.buffer = '';
  }
}

export async function runTests(opts: RunnerOptions): Promise<RunSummary> {
  const args = ['playwright', 'test', ...(opts.extraArgs ?? [])];
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  if (opts.skipWebServer === true) env['REACTLENS_NO_WEB_SERVER'] = '1';
  if (opts.probeWsUrl !== undefined) env['REACTLENS_WS_URL'] = opts.probeWsUrl;
  if (opts.probePath !== undefined) env['REACTLENS_PROBE_PATH'] = opts.probePath;

  const child = execa('npx', args, {
    cwd: opts.cwd,
    env,
    reject: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  }) as ResultPromise<{ reject: false; encoding: 'utf8' }> & Subprocess;

  let summary: { passed: number; failed: number; skipped: number; duration: number } = {
    passed: 0,
    failed: 0,
    skipped: 0,
    duration: 0,
  };

  const stdoutSplitter = new LineSplitter();
  const stderrSplitter = new LineSplitter();

  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');

  child.stdout?.on('data', (chunk: string) => {
    stdoutSplitter.push(chunk, (line) => {
      const event = tryParseEvent(line);
      if (event !== null) {
        if (event.t === 'run:end') {
          summary = {
            passed: event.passed,
            failed: event.failed,
            skipped: event.skipped,
            duration: event.duration,
          };
        }
        opts.bus.emit(event);
      } else if (line.trim().length > 0) {
        logger.warn({ line }, 'unparseable runner output');
      }
    });
  });

  child.stderr?.on('data', (chunk: string) => {
    stderrSplitter.push(chunk, (line) => {
      if (line.trim().length > 0) logger.warn({ line }, 'playwright stderr');
    });
  });

  // Forward Ctrl+C from our process to the child so Playwright shuts its
  // browsers and webServer cleanly. Without this, child processes leak.
  const onSigint = (): void => {
    try {
      child.kill('SIGINT');
    } catch {
      /* already dead */
    }
  };
  process.once('SIGINT', onSigint);

  let result;
  try {
    result = await child;
  } finally {
    process.removeListener('SIGINT', onSigint);
    stdoutSplitter.flush((line) => {
      const event = tryParseEvent(line);
      if (event !== null) opts.bus.emit(event);
    });
    stderrSplitter.flush(() => undefined);
  }

  const exitCode = result.exitCode ?? 0;
  // Playwright exits 0 = pass, 1 = some failed. Anything else (signal, infra)
  // is a hard error — let the caller decide.
  if (exitCode !== 0 && exitCode !== 1 && !result.isCanceled) {
    throw new ReactLensError(
      `playwright runner exited with code ${exitCode}: ${result.stderr ?? ''}`,
      { code: 'RUNNER_INFRA_ERROR' },
    );
  }

  return { ...summary, exitCode };
}
