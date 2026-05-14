import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { CostTracker, withCostTracking } from '../agent/cost';
import { pickAgentRunner } from '../agent/select';
import { diagnose } from '../analyzer/failure-agent';
import { loadConfig } from '../config/load';
import { startDashboardServer } from '../dashboard/server';
import { EventBus } from '../runner/event-bus';
import { ALL_EVENT_TYPES, type ComponentNode } from '../runner/events';
import { runTests, type RunSummary } from '../runner/playwright-runner';
import { persistSnapshots } from '../runner/snapshot-sink';
import { logger } from '../utils/logger';
import { generateRunId } from '../utils/run-id';

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
  // Route diagnosis through the local `claude` CLI (Max-billed) instead of
  // the SDK. Local development only.
  useClaudeCode?: boolean;
  // Directory to write per-test component snapshots into. One <testId>.json
  // per failing test, plus a manifest.json mapping ids to titles/spec files.
  // Used by the diagnostic-eval pipeline to harvest real bridge captures.
  saveSnapshotsTo?: string;
  // Hard cap on aggregate USD across all diagnosis query() calls. The
  // decorator throws AGENT_COST_EXCEEDED at the next message boundary.
  maxCost?: number;
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
  const runId = generateRunId();
  logger.info({ runId }, 'run starting');

  const wantDashboard = opts.noDashboard !== true && opts.reporter !== 'json';

  let dashboard: Awaited<ReturnType<typeof startDashboardServer>> | null = null;
  if (wantDashboard) {
    try {
      dashboard = await startDashboardServer({ port: config.dashboard.port, bus });
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
      runId,
      skipWebServer: opts.skipWebServer,
      probeWsUrl: dashboard?.probeWsUrl,
      probePath: locatePackagedProbe(),
    });
    if (dashboard !== null) await dashboard.close();
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
  // Diagnosis is opt-in: requires either an API key or --use-claude-code.
  // We resolve the runner lazily so a no-failure run never spins up the agent.
  const canDiagnose =
    opts.noAnalyze !== true &&
    (opts.useClaudeCode === true ||
      process.env.REACTLENS_USE_CLAUDE_CODE === '1' ||
      process.env.ANTHROPIC_API_KEY !== undefined);
  const costTracker = new CostTracker(opts.maxCost !== undefined ? { maxUsd: opts.maxCost } : {});
  if (canDiagnose) {
    let agentPromise: Promise<ReturnType<typeof withCostTracking>> | null = null;
    bus.on('test:end', (e) => {
      if (e.status !== 'failed' && e.status !== 'timedOut') return;
      const t = testState.get(e.id);
      if (t === undefined) return;
      bus.emit({ t: 'diagnosis:start', testId: e.id });
      if (agentPromise === null) {
        agentPromise = pickAgentRunner({ commandName: 'run', useClaudeCode: opts.useClaudeCode }).then(
          (base) => withCostTracking(base, costTracker),
        );
      }
      const promise = agentPromise
        .then((agent) =>
          diagnose({
            cwd,
            agent,
            failure: {
              testId: e.id,
              testTitle: t.title,
              specFile: t.file,
              ...(e.error !== undefined ? { errorMessage: e.error } : {}),
              ...(t.snapshot !== undefined ? { componentSnapshot: t.snapshot } : {}),
            },
            onChunk: (text) => bus.emit({ t: 'diagnosis:chunk', testId: e.id, text }),
          }),
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

  bus.on('run:start', (e) => {
    state.totalTests = e.totalTests;
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

  let summary: RunSummary;
  try {
    summary = await runTests({
      cwd,
      bus,
      runId,
      skipWebServer: opts.skipWebServer,
      probeWsUrl: dashboard?.probeWsUrl,
      probePath: locatePackagedProbe(),
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
    if (dashboard !== null) await dashboard.close();
  }

  process.stdout.write(
    `\n${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped (${summary.duration}ms)\n`,
  );
  const costTotal = costTracker.total();
  if (costTotal.calls > 0) logger.info({ cost: costTotal }, 'agent cost summary');
  return summary.exitCode;
}
