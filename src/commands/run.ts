import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { CostTracker, withCostTracking } from '../agent/cost';
import { canResolveAgent, pickAgentRunner } from '../agent/select';
import { createDiagnosisRun } from '../diagnosis-run/run';
import { loadConfig } from '../config/load';
import { startDashboardServer } from '../dashboard/server';
import { EventBus } from '../runner/event-bus';
import { ALL_EVENT_TYPES, type ComponentNode } from '../runner/events';
import { EventPersistor } from '../runner/event-persistor';
import { runTests, type RunSummary } from '../runner/playwright-runner';
import { persistSnapshots } from '../runner/snapshot-sink';
import { openRunsArea, type RunPath } from '../runs/run-paths';
import { logger } from '../utils/logger';

export type RunCommandOptions = {
  cwd: string;
  reporter: 'text' | 'json';
  skipWebServer?: boolean;
  // Disable launching the dashboard server. CI mode + json mode imply this.
  noDashboard?: boolean;
  open?: boolean;
  // Disable on-failure diagnosis. Useful in CI when you want raw results
  // without API calls. Defaults to enabled when ANTHROPIC_API_KEY is set.
  noAnalyze?: boolean;
  // CI mode: serialize diagnoses to a JSON artifact and skip the dashboard.
  ci?: boolean;
  // Strict opt-in for the local Claude CLI (subscription billing). Fails if
  // the binary isn't installed. By default reactlens already prefers the
  // CLI when available; this flag is for callers who want to be sure they
  // are NOT silently falling back to the API.
  useClaudeCode?: boolean;
  // Strict opt-in for ANTHROPIC_API_KEY billing, even when a local Claude
  // Code subscription is available. Required for CI environments without a
  // logged-in CLI, or when the developer deliberately wants per-token
  // billing for this run.
  forceApi?: boolean;
  // Directory to write per-test component snapshots into. One <testId>.json
  // per failing test, plus a manifest.json mapping ids to titles/spec files.
  // Used by the diagnostic-eval pipeline to harvest real bridge captures.
  saveSnapshotsTo?: string;
  // Hard cap on aggregate USD across all diagnosis query() calls. The
  // decorator throws AGENT_COST_EXCEEDED at the next message boundary.
  maxCost?: number;
  // P10: after the initial run, watch <cwd>/src and <cwd>/e2e and re-run on
  // any change. Each iteration writes its own .reactlens/runs/<id>/ dir.
  // Dashboard + bus + costTracker persist across iterations. Exits on SIGINT.
  watch?: boolean;
  // Optional positional spec path(s) forwarded to `playwright test` as a
  // filter so only matching specs run. Comes from `reactlens run -- <path>`
  // on the CLI; useful for the operator-gated `co-generate-roundtrip`
  // integration test that wants to run ONLY the spec it just generated.
  // Multiple paths forwarded verbatim.
  specPaths?: string[];
};

type Status = 'running' | 'passed' | 'failed' | 'skipped' | 'timedOut';
type Row = { id: string; title: string; suite: string; status: Status; duration: number };

function formatStatus(status: Status): string {
  switch (status) {
    case 'passed':
      return '✓ PASS';
    case 'failed':
      return '✗ FAIL';
    case 'skipped':
      return '- SKIP';
    case 'timedOut':
      return '⧖ TIME';
    case 'running':
      return '· RUN ';
  }
}

function renderTable(rows: Row[], totalTests: number): string {
  if (rows.length === 0) return `(0/${totalTests})\n`;
  const titleWidth = Math.min(50, Math.max(...rows.map((r) => r.title.length)));
  const lines = rows.map((r) => {
    const t = r.title.length > titleWidth ? r.title.slice(0, titleWidth - 1) + '…' : r.title.padEnd(titleWidth);
    const dur = r.status === 'running' ? '   …' : `${r.duration.toString().padStart(4)}ms`;
    return `  ${formatStatus(r.status)}  ${t}  ${dur}  ${r.suite}`;
  });
  return lines.join('\n') + '\n';
}

function reprint(state: { rows: Row[]; totalTests: number }, isTty: boolean): void {
  const text = renderTable(state.rows, state.totalTests);
  if (isTty) {
    process.stdout.write('\x1b[H\x1b[2J' + text);
  } else {
    process.stdout.write(text);
  }
}

function locatePackagedProbe(): string | undefined {
  // Walk up from this compiled file looking for the dist/probe bundle.
  const candidates = [
    join(__dirname, 'probe', 'probe.global.js'),
    join(__dirname, '..', 'probe', 'probe.global.js'),
    join(__dirname, '..', '..', 'dist', 'probe', 'probe.global.js'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return undefined;
}

function locatePackagedAxe(): string | undefined {
  // Walk up looking for axe-core in our own node_modules. The fixture
  // running in the user's project can normally require.resolve axe-core
  // (it's a transitive dep), but pnpm's strict isolation breaks that path
  // in our integration suite — pin it explicitly here so dev + prod agree.
  const candidates = [
    join(__dirname, '..', 'node_modules', 'axe-core', 'axe.min.js'),
    join(__dirname, '..', '..', 'node_modules', 'axe-core', 'axe.min.js'),
    join(__dirname, '..', '..', '..', 'node_modules', 'axe-core', 'axe.min.js'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return undefined;
}

function tryOpenInBrowser(url: string): void {
  // `start` is a cmd.exe builtin (not a binary), so on Windows we have to
  // shell through cmd /c with an empty title argument so the URL isn't
  // interpreted as the window title.
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '""', url], { stdio: 'ignore', detached: true }).unref();
    } else {
      const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
      spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref();
    }
  } catch (err) {
    logger.warn({ err }, 'failed to open browser');
  }
}

export async function runRun(opts: RunCommandOptions): Promise<number> {
  const cwd = resolve(opts.cwd);
  const config = await loadConfig(cwd);
  const bus = new EventBus();

  // Persist every event for v0.2 time-travel. The RunsArea owns the
  // .reactlens/ layout and writes the self-defensive .gitignore once on
  // open. In watch mode `currentRun` is rotated each iteration; the first
  // iteration is set up here so the JSON-reporter early-return path still
  // has a single persistor.
  const area = await openRunsArea(cwd);
  let currentRun: RunPath = area.startRun();
  let persistor = new EventPersistor({ runPath: currentRun });
  persistor.attach(bus);
  logger.info({ runId: currentRun.id }, 'run starting');

  const wantDashboard = opts.noDashboard !== true && opts.reporter !== 'json';

  let dashboard: Awaited<ReturnType<typeof startDashboardServer>> | null = null;
  if (wantDashboard) {
    try {
      dashboard = await startDashboardServer({
        port: config.dashboard.port,
        bus,
        runsArea: area,
      });
      const url = `http://localhost:${dashboard.port}`;
      logger.info({ url }, 'dashboard listening');
      if (opts.open !== false && config.dashboard.open) tryOpenInBrowser(url);
    } catch (err) {
      logger.warn({ err }, 'dashboard server failed to start; continuing in headless mode');
      dashboard = null;
    }
  }

  if (opts.reporter === 'json') {
    for (const t of ALL_EVENT_TYPES) {
      bus.on(t, (e) => process.stdout.write(JSON.stringify(e) + '\n'));
    }
    const summary = await runTests({
      cwd,
      bus,
      runId: currentRun.id,
      skipWebServer: opts.skipWebServer,
      probeWsUrl: dashboard?.probeWsUrl,
      probePath: locatePackagedProbe(),
      axePath: locatePackagedAxe(),
      ...(opts.specPaths !== undefined && opts.specPaths.length > 0
        ? { extraArgs: opts.specPaths }
        : {}),
    });
    if (dashboard !== null) await dashboard.close();
    await persistor.flush();
    persistor.detach();
    return summary.exitCode;
  }

  // Track per-test data we need at failure time (title + file for the
  // diagnosis prompt; latest snapshot as the unique evidence signal).
  type TestState = { title: string; file: string; snapshot?: ComponentNode };
  const testState = new Map<string, TestState>();
  bus.on('test:start', (e) => {
    testState.set(e.id, { title: e.title, file: e.file });
  });
  bus.on('component:snapshot', (e) => {
    const existing = testState.get(e.testId);
    if (existing !== undefined) existing.snapshot = e.tree;
  });
  const diagnosisPromises: Array<Promise<void>> = [];
  const ciDiagnoses: Array<{ testId: string; title: string; diagnosis: unknown }> = [];
  // Diagnosis is opt-in: needs an agent reachable per the new selection
  // policy (subscription preferred, API as fallback). Mirroring
  // pickAgentRunner's logic via canResolveAgent prevents the wiring from
  // happening when neither a Claude CLI nor an API key are available.
  const canDiagnose =
    opts.noAnalyze !== true &&
    (await canResolveAgent({ useClaudeCode: opts.useClaudeCode, forceApi: opts.forceApi }));
  const costTracker = new CostTracker(opts.maxCost !== undefined ? { maxUsd: opts.maxCost } : {});
  if (canDiagnose) {
    let agentPromise: Promise<ReturnType<typeof withCostTracking>> | null = null;
    bus.on('test:end', (e) => {
      if (e.status !== 'failed' && e.status !== 'timedOut') return;
      const t = testState.get(e.id);
      if (t === undefined) return;
      bus.emit({ t: 'diagnosis:start', testId: e.id });
      if (agentPromise === null) {
        agentPromise = pickAgentRunner({
          commandName: 'run',
          useClaudeCode: opts.useClaudeCode,
          forceApi: opts.forceApi,
        }).then((base) => withCostTracking(base, costTracker));
      }
      const promise = agentPromise
        .then((agent) =>
          createDiagnosisRun({ agent }).run(
            {
              kind: 'live',
              cwd,
              testId: e.id,
              testTitle: t.title,
              specFile: t.file,
              ...(e.error !== undefined ? { errorMessage: e.error } : {}),
              ...(t.snapshot !== undefined ? { componentSnapshot: t.snapshot } : {}),
            },
            { onChunk: (text) => bus.emit({ t: 'diagnosis:chunk', testId: e.id, text }) },
          ),
        )
        .then((result) => {
          bus.emit({ t: 'diagnosis:end', testId: e.id, result });
          if (opts.ci === true) {
            ciDiagnoses.push({ testId: e.id, title: t.title, diagnosis: result });
          }
        })
        .catch((err) => {
          logger.warn({ err, testId: e.id }, 'diagnosis failed');
        });
      diagnosisPromises.push(promise);
    });
  }

  const state = { totalTests: 0, rows: [] as Row[] };
  const isTty = process.stdout.isTTY === true;

  // P10: bus subscribers stay registered across watch iterations; only the
  // per-iteration mutables need resetting. The reset listener fires on every
  // run:start (including watch re-runs) so the CLI table doesn't accumulate
  // rows from prior iterations and testState/diagnosisPromises start clean.
  bus.on('run:start', (e) => {
    state.totalTests = e.totalTests;
    state.rows = [];
    testState.clear();
    diagnosisPromises.length = 0;
    reprint(state, isTty);
  });
  bus.on('test:start', (e) => {
    state.rows.push({ id: e.id, title: e.title, suite: e.suite, status: 'running', duration: 0 });
    reprint(state, isTty);
  });
  bus.on('test:end', (e) => {
    const row = state.rows.find((r) => r.id === e.id);
    if (row !== undefined) {
      row.status = e.status;
      row.duration = e.duration;
    }
    reprint(state, isTty);
  });

  // Apply-fix loop closure: the dashboard server emits this when a client
  // posts `test:rerun-request` over /ws/dashboard. Today the runner just
  // logs the acknowledgement — actually spawning a re-targeted Playwright
  // invocation mid-session is its own slice (process-orchestration around
  // execa, cancel/wait for the active run, dedupe overlapping requests).
  // The wire infrastructure being in place lets that future slice land
  // without touching the event protocol or the dashboard server.
  bus.on('test:rerun-requested', (e) => {
    logger.info({ testId: e.testId }, 'test rerun requested (runner orchestration is a follow-up slice)');
  });

  async function executeOneRun(): Promise<RunSummary> {
    let summary: RunSummary;
    try {
      summary = await runTests({
        cwd,
        bus,
        runId: currentRun.id,
        skipWebServer: opts.skipWebServer,
        probeWsUrl: dashboard?.probeWsUrl,
        probePath: locatePackagedProbe(),
        axePath: locatePackagedAxe(),
      });
    } finally {
      if (diagnosisPromises.length > 0) {
        await Promise.allSettled(diagnosisPromises);
      }
      if (opts.ci === true && ciDiagnoses.length > 0) {
        const path = join(cwd, 'reactlens-diagnoses.json');
        const { writeFile } = await import('node:fs/promises');
        await writeFile(path, JSON.stringify(ciDiagnoses, null, 2));
        logger.info({ path, count: ciDiagnoses.length }, 'wrote CI diagnoses artifact');
        ciDiagnoses.length = 0;
      }
      if (opts.saveSnapshotsTo !== undefined) {
        const outDir = resolve(cwd, opts.saveSnapshotsTo);
        const tests = Array.from(testState.entries()).map(([id, t]) => ({
          id,
          title: t.title,
          file: t.file,
          ...(t.snapshot !== undefined ? { snapshot: t.snapshot } : {}),
        }));
        const result = await persistSnapshots({ outDir, tests, writeManifest: true });
        logger.info(
          { outDir, written: result.written.length, skipped: result.skipped.length },
          'wrote per-test snapshots',
        );
      }
      await persistor.flush();
      persistor.detach();
      logger.info({ runDir: currentRun.dir }, 'persisted run');
    }
    return summary;
  }

  let summary = await executeOneRun();
  process.stdout.write(
    `\n${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped (${summary.duration}ms)\n`,
  );

  if (opts.watch === true) {
    summary = await runWatchLoop(cwd, async () => {
      // Rotate the persistor for the next iteration before runTests fires.
      currentRun = area.startRun();
      persistor = new EventPersistor({ runPath: currentRun });
      persistor.attach(bus);
      logger.info({ runId: currentRun.id }, 'watch re-run starting');
      const next = await executeOneRun();
      process.stdout.write(
        `\n${next.passed} passed, ${next.failed} failed, ${next.skipped} skipped (${next.duration}ms)\n`,
      );
      return next;
    });
  }

  if (dashboard !== null) await dashboard.close();
  const costTotal = costTracker.total();
  if (costTotal.calls > 0) logger.info({ cost: costTotal }, 'agent cost summary');
  return summary.exitCode;
}

// Watches <cwd>/src and <cwd>/e2e via chokidar, debouncing rapid changes
// (one save can fire 3-5 events in 100ms on macOS) and serializing reruns
// so two saves in quick succession produce one re-run, not two. Returns
// the summary of the last run before SIGINT.
async function runWatchLoop(
  cwd: string,
  runOnce: () => Promise<RunSummary>,
): Promise<RunSummary> {
  const { default: chokidar } = await import('chokidar');
  // Watch only the directories that influence test outcomes. We could be
  // smarter later (read the user's playwright config for testDir, walk
  // imports), but two top-level dirs cover the canonical layout and the
  // false-positive cost of an extra re-run is trivial.
  const watchPaths = [join(cwd, 'src'), join(cwd, 'e2e')];
  const watcher = chokidar.watch(watchPaths, {
    ignoreInitial: true,
    ignored: (path) =>
      path.includes('node_modules') ||
      path.includes('.reactlens') ||
      path.includes('playwright-report') ||
      path.includes('test-results') ||
      path.includes('/.git/'),
  });

  // chokidar's initial walk takes a tick on large trees. With ignoreInitial:
  // true any file that appears before 'ready' is treated as pre-existing and
  // suppressed — so callers (and tests) that wait for the watcher to be
  // armed must hold off writes until this log line clears.
  await new Promise<void>((resolve) => watcher.once('ready', () => resolve()));
  logger.info({ watchPaths }, 'watch mode: ready · edits under these paths re-run the suite');

  let lastSummary: RunSummary | null = null;
  let isRunning = false;
  let pendingRerun = false;
  let debounce: NodeJS.Timeout | null = null;

  async function trigger(): Promise<void> {
    if (isRunning) {
      pendingRerun = true;
      return;
    }
    isRunning = true;
    try {
      lastSummary = await runOnce();
    } catch (err) {
      logger.warn({ err }, 'watch re-run failed; will trigger again on next change');
    } finally {
      isRunning = false;
      if (pendingRerun) {
        pendingRerun = false;
        scheduleRerun();
      }
    }
  }

  function scheduleRerun(): void {
    if (debounce !== null) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      void trigger();
    }, 250);
  }

  watcher.on('all', (_event, path) => {
    logger.debug({ path }, 'watch: change detected');
    scheduleRerun();
  });

  await new Promise<void>((resolve) => {
    const onSigint = (): void => {
      logger.info('watch mode: SIGINT received, shutting down');
      resolve();
    };
    process.once('SIGINT', onSigint);
  });

  if (debounce !== null) clearTimeout(debounce);
  await watcher.close();
  // If a rerun was in flight, let it settle so its persistor flushes.
  while (isRunning) {
    await new Promise((r) => setTimeout(r, 50));
  }
  return lastSummary ?? { passed: 0, failed: 0, skipped: 0, duration: 0, exitCode: 0 };
}
