// `reactlens diff <runIdA> <runIdB>` — surface the semantic differences
// between two persisted runs. Reads .reactlens/runs/<id>/events.jsonl on
// both sides, picks the final component:snapshot per test that both runs
// share, and diffs the component trees through src/analyzer/tree-diff.ts.
//
// Text output is the default (human-friendly, one section per test);
// --json emits the raw SemanticDiff[] for tooling.
import { resolve, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { ReactLensError } from '../utils/errors';
import { logger } from '../utils/logger';
import type { ComponentNode } from '../runner/events';
import { diffComponentTree, type SemanticDiff } from '../analyzer/tree-diff';

export type DiffCommandOptions = {
  cwd: string;
  runIdA: string;
  runIdB: string;
  json?: boolean;
};

type FinalSnapshot = { testId: string; testTitle: string; tree: ComponentNode };

export async function runDiff(opts: DiffCommandOptions): Promise<number> {
  const cwd = resolve(opts.cwd);
  const runsDir = join(cwd, '.reactlens', 'runs');
  const beforePath = join(runsDir, opts.runIdA, 'events.jsonl');
  const afterPath = join(runsDir, opts.runIdB, 'events.jsonl');
  for (const p of [beforePath, afterPath]) {
    if (!existsSync(p)) {
      throw new ReactLensError(`events.jsonl not found at ${p}`, { code: 'DIFF_RUN_NOT_FOUND' });
    }
  }

  const before = await loadFinalSnapshots(beforePath);
  const after = await loadFinalSnapshots(afterPath);

  const sharedIds = [...before.keys()].filter((id) => after.has(id));
  if (sharedIds.length === 0) {
    logger.warn({ runIdA: opts.runIdA, runIdB: opts.runIdB }, 'no shared tests between runs');
    return 0;
  }

  type PerTest = { testId: string; testTitle: string; diffs: SemanticDiff[] };
  const perTest: PerTest[] = [];
  for (const id of sharedIds) {
    const b = before.get(id)!;
    const a = after.get(id)!;
    const diffs = diffComponentTree(b.tree, a.tree);
    if (diffs.length > 0) perTest.push({ testId: id, testTitle: a.testTitle, diffs });
  }

  if (opts.json === true) {
    process.stdout.write(JSON.stringify({ runIdA: opts.runIdA, runIdB: opts.runIdB, tests: perTest }, null, 2) + '\n');
  } else {
    process.stdout.write(renderText(opts.runIdA, opts.runIdB, perTest));
  }

  // Exit code mirrors `git diff`: 0 = identical, 1 = differences found.
  return perTest.length === 0 ? 0 : 1;
}

async function loadFinalSnapshots(eventsPath: string): Promise<Map<string, FinalSnapshot>> {
  const text = await readFile(eventsPath, 'utf8');
  const final = new Map<string, FinalSnapshot>();
  const titles = new Map<string, string>();
  for (const line of text.split('\n')) {
    if (line.length === 0) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const t = parsed['t'];
    if (t === 'test:start') {
      const id = parsed['id'] as string | undefined;
      const title = parsed['title'] as string | undefined;
      if (id !== undefined && title !== undefined) titles.set(id, title);
    } else if (t === 'component:snapshot') {
      const testId = parsed['testId'] as string | undefined;
      const tree = parsed['tree'] as ComponentNode | undefined;
      if (testId === undefined || tree === undefined) continue;
      // Last snapshot per test wins — that's the "end-of-test" state, the
      // most useful comparison point for regression detection.
      final.set(testId, {
        testId,
        testTitle: titles.get(testId) ?? testId,
        tree,
      });
    }
  }
  return final;
}

function renderText(runIdA: string, runIdB: string, perTest: Array<{ testId: string; testTitle: string; diffs: SemanticDiff[] }>): string {
  if (perTest.length === 0) {
    return `No semantic differences between ${runIdA} and ${runIdB}.\n`;
  }
  const lines: string[] = [];
  lines.push(`Semantic diff: ${runIdA} → ${runIdB}`);
  lines.push('');
  for (const test of perTest) {
    lines.push(`■ ${test.testTitle}`);
    for (const d of test.diffs) {
      lines.push(`  · ${renderDiffLine(d)}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function renderDiffLine(d: SemanticDiff): string {
  switch (d.kind) {
    case 'component-added':
      return `+ ${d.path}`;
    case 'component-removed':
      return `- ${d.path}`;
    case 'prop-changed':
      return `~ ${d.path} · ${d.prop}: ${shortValue(d.before)} → ${shortValue(d.after)}`;
  }
}

function shortValue(v: unknown): string {
  if (v === undefined) return '∅';
  if (typeof v === 'string') return v.length > 40 ? `"${v.slice(0, 40)}…"` : `"${v}"`;
  try {
    const s = JSON.stringify(v);
    return s.length > 40 ? s.slice(0, 40) + '…' : s;
  } catch {
    return String(v);
  }
}
