// Standalone analyze command: takes a Playwright JSON report and produces
// Markdown diagnoses for each failed test. Useful for CI artifacts where the
// dashboard isn't running.
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { resolveAgentForCommand } from '../agent/select';
import { ReactLensError } from '../utils/errors';
import { logger } from '../utils/logger';
import { diagnose } from '../analyzer/failure-agent';
import type { Diagnosis } from '../runner/events';

export type AnalyzeCommandOptions = {
  cwd: string;
  reportPath: string;
  outFile?: string;
  useClaudeCode?: boolean;
  forceApi?: boolean;
  maxCost?: number;
};

type PlaywrightReport = {
  suites?: Array<{ specs?: Array<{ tests?: Array<unknown> }>; suites?: unknown[] }>;
};

type FailedHit = {
  testId: string;
  title: string;
  file: string;
  errorMessage?: string;
};

function collectFailures(report: PlaywrightReport): FailedHit[] {
  const out: FailedHit[] = [];
  function walkSuites(suites: unknown): void {
    if (!Array.isArray(suites)) return;
    for (const s of suites) {
      const suite = s as { specs?: unknown; suites?: unknown };
      if (Array.isArray(suite.specs)) {
        for (const spec of suite.specs) {
          const sp = spec as {
            id?: string;
            title?: string;
            file?: string;
            tests?: Array<{
              status?: string;
              results?: Array<{ status?: string; error?: { message?: string } }>;
            }>;
          };
          for (const t of sp.tests ?? []) {
            for (const r of t.results ?? []) {
              if (r.status === 'failed' || r.status === 'timedOut') {
                out.push({
                  testId: sp.id ?? `${sp.file}:${sp.title}`,
                  title: sp.title ?? 'unknown',
                  file: sp.file ?? '',
                  ...(r.error?.message !== undefined ? { errorMessage: r.error.message } : {}),
                });
              }
            }
          }
        }
      }
      if (Array.isArray(suite.suites)) walkSuites(suite.suites);
    }
  }
  walkSuites(report.suites);
  return out;
}

function diagnosisToMarkdown(d: Diagnosis, hit: FailedHit): string {
  const lines: string[] = [];
  lines.push(`## ${hit.title}`);
  lines.push('');
  lines.push(`**File:** \`${hit.file}\``);
  lines.push(``);
  lines.push(`**Classification:** ${d.classification} · **Confidence:** ${d.confidence}`);
  lines.push(``);
  lines.push(`**Root cause:** ${d.rootCause}`);
  if (d.evidence.length > 0) {
    lines.push(``);
    lines.push(`**Evidence:**`);
    for (const e of d.evidence) lines.push(`- ${e}`);
  }
  lines.push(``);
  lines.push(`**Suggested fix:** ${d.suggestedFix}`);
  if (d.patch !== undefined && d.patch.length > 0) {
    lines.push(``);
    lines.push(`**Patch:**`);
    for (const p of d.patch) {
      lines.push('```diff');
      lines.push(`--- ${p.file}`);
      lines.push(`- ${p.oldStr}`);
      lines.push(`+ ${p.newStr}`);
      lines.push('```');
    }
  }
  return lines.join('\n');
}

export async function runAnalyze(opts: AnalyzeCommandOptions): Promise<number> {
  const cwd = resolve(opts.cwd);
  const reportPath = resolve(cwd, opts.reportPath);
  if (!existsSync(reportPath)) {
    throw new ReactLensError(`report file not found: ${reportPath}`, { code: 'ANALYZE_NO_REPORT' });
  }
  const { agent, tracker } = await resolveAgentForCommand({
    commandName: 'analyze',
    useClaudeCode: opts.useClaudeCode,
    forceApi: opts.forceApi,
    maxCost: opts.maxCost,
  });

  const raw = await readFile(reportPath, 'utf8');
  const report = JSON.parse(raw) as PlaywrightReport;
  const failures = collectFailures(report);
  logger.info({ count: failures.length }, 'analyzing failures');

  const sections: string[] = ['# reactlens diagnostic report', ''];
  for (const hit of failures) {
    const diagnosis = await diagnose({
      cwd,
      agent,
      failure: {
        testId: hit.testId,
        testTitle: hit.title,
        specFile: hit.file,
        ...(hit.errorMessage !== undefined ? { errorMessage: hit.errorMessage } : {}),
      },
    });
    sections.push(diagnosisToMarkdown(diagnosis, hit));
    sections.push('');
  }

  const md = sections.join('\n');
  if (opts.outFile !== undefined) {
    await writeFile(resolve(cwd, opts.outFile), md);
    logger.info({ path: opts.outFile }, 'wrote markdown diagnoses');
  } else {
    process.stdout.write(md + '\n');
  }
  const total = tracker.total();
  if (total.calls > 0) logger.info({ cost: total }, 'agent cost summary');
  return 0;
}
