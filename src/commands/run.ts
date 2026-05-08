import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { diagnose } from '../analyzer/failure-agent';
import { loadConfig } from '../config/load';
import { startDashboardServer } from '../dashboard/server';
import { EventBus } from '../runner/event-bus';
import type { ComponentNode } from '../runner/events';
import { runTests, type RunSummary } from '../runner/playwright-runner';
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
  // Replacement for the `open` package — uses platform-native shell command.
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref();
  } catch (err) {
    logger.warn({ err }, 'failed to open browser');
  }
}

export async function runRun(opts: RunCommandOptions): Promise<number> {
  const cwd = resolve(opts.cwd);
  const config = await loadConfig(cwd);
  const bus = new EventBus();

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
    const types = [
      'run:start',
      'test:start',
      'step:start',
      'step:end',
      'test:end',
      'run:end',
      'frame',
      'component:snapshot',
      'component:event',
      'diagnosis:start',
      'diagnosis:chunk',
      'diagnosis:end',
    ] as const;
    for (const t of types) {
      bus.on(t, (e) => process.stdout.write(JSON.stringify(e) + '\n'));
    }
    const summary = await runTests({
      cwd,
      bus,
      skipWebServer: opts.skipWebServer,
      probeWsUrl: dashboard?.probeWsUrl,
      probePath: locatePackagedProbe(),
    });
    if (dashboard !== null) await dashboard.close();
    return summary.exitCode;
  }

  // Track the last component snapshot per test so on-failure diagnosis has it.
  const lastSnapshotByTest = new Map<string, ComponentNode>();
  const lastTestMeta = new Map<string, { title: string; file: string }>();
  bus.on('component:snapshot', (e) => {
    lastSnapshotByTest.set(e.testId, e.tree);
  });
  bus.on('test:start', (e) => {
    lastTestMeta.set(e.id, { title: e.title, file: e.file });
  });
  const diagnosisPromises: Array<Promise<void>> = [];
  const ciDiagnoses: Array<{ testId: string; title: string; diagnosis: unknown }> = [];
  const wantAnalyze = opts.noAnalyze !== true && process.env.ANTHROPIC_API_KEY !== undefined;
  if (wantAnalyze) {
    bus.on('test:end', (e) => {
      if (e.status !== 'failed' && e.status !== 'timedOut') return;
      const meta = lastTestMeta.get(e.id);
      if (meta === undefined) return;
      bus.emit({ t: 'diagnosis:start', testId: e.id });
      const promise = diagnose({
        cwd,
        failure: {
          testId: e.id,
          testTitle: meta.title,
          specFile: meta.file,
          ...(e.error !== undefined ? { errorMessage: e.error } : {}),
          ...(lastSnapshotByTest.get(e.id) !== undefined ? { componentSnapshot: lastSnapshotByTest.get(e.id) } : {}),
        },
        onChunk: (text) => bus.emit({ t: 'diagnosis:chunk', testId: e.id, text }),
      })
        .then((result) => {
          bus.emit({ t: 'diagnosis:end', testId: e.id, result });
          if (opts.ci === true) {
            ciDiagnoses.push({ testId: e.id, title: meta.title, diagnosis: result });
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
    if (dashboard !== null) await dashboard.close();
  }

  process.stdout.write(
    `\n${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped (${summary.duration}ms)\n`,
  );
  return summary.exitCode;
}
