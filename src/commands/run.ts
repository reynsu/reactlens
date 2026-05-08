import { resolve } from 'node:path';
import { loadConfig } from '../config/load';
import { EventBus } from '../runner/event-bus';
import { runTests, type RunSummary } from '../runner/playwright-runner';

export type RunCommandOptions = {
  cwd: string;
  reporter: 'text' | 'json';
  skipWebServer?: boolean;
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
    // Move cursor to top-left and clear screen below — simple repaint.
    process.stdout.write('\x1b[H\x1b[2J' + text);
  } else {
    // Non-TTY: append (e.g. piped to a file). Drop terminal control chars.
    process.stdout.write(text);
  }
}

export async function runRun(opts: RunCommandOptions): Promise<number> {
  const cwd = resolve(opts.cwd);
  await loadConfig(cwd); // validates user config; failure throws ConfigError

  const bus = new EventBus();

  if (opts.reporter === 'json') {
    bus.on('run:start', (e) => process.stdout.write(JSON.stringify(e) + '\n'));
    bus.on('test:start', (e) => process.stdout.write(JSON.stringify(e) + '\n'));
    bus.on('step:start', (e) => process.stdout.write(JSON.stringify(e) + '\n'));
    bus.on('step:end', (e) => process.stdout.write(JSON.stringify(e) + '\n'));
    bus.on('test:end', (e) => process.stdout.write(JSON.stringify(e) + '\n'));
    bus.on('run:end', (e) => process.stdout.write(JSON.stringify(e) + '\n'));
    const summary = await runTests({ cwd, bus, skipWebServer: opts.skipWebServer });
    return summary.exitCode;
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
    summary = await runTests({ cwd, bus, skipWebServer: opts.skipWebServer });
  } finally {
    if (!isTty) {
      // No final repaint needed in TTY mode (last run:end already triggered).
    }
  }

  process.stdout.write(
    `\n${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped (${summary.duration}ms)\n`,
  );
  return summary.exitCode;
}
