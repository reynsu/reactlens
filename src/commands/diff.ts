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
import { parseRunEvent, type AxNode, type ComponentNode } from '../runner/events';
import { diffComponentTree, type SemanticDiff } from '../analyzer/tree-diff';
import { diffA11yTree, type A11ySemanticDiff } from '../analyzer/a11y-diff';

export type DiffCommandOptions = {
  cwd: string;
  runIdA: string;
  runIdB: string;
  json?: boolean;
};

type FinalSnapshot = { testId: string; testTitle: string; tree: ComponentNode; a11y?: AxNode };

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

  type PerTest = {
    testId: string;
    testTitle: string;
    diffs: SemanticDiff[];
    a11yDiffs: A11ySemanticDiff[];
  };
  const perTest: PerTest[] = [];
  for (const id of sharedIds) {
    const b = before.get(id)!;
    const a = after.get(id)!;
    const diffs = diffComponentTree(b.tree, a.tree);
    // Only diff a11y when both sides captured it. Mixed runs (one with,
    // one without) skip a11y silently — that mismatch is informational,
    // not a regression signal.
    const a11yDiffs =
      b.a11y !== undefined && a.a11y !== undefined ? diffA11yTree(b.a11y, a.a11y) : [];
    if (diffs.length > 0 || a11yDiffs.length > 0) {
      perTest.push({ testId: id, testTitle: a.testTitle, diffs, a11yDiffs });
    }
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
    let event;
    try {
      event = parseRunEvent(JSON.parse(line));
    } catch {
      continue;
    }
    if (event === null) continue;

    if (event.t === 'test:start') {
      titles.set(event.id, event.title);
    } else if (event.t === 'component:snapshot') {
      // Last snapshot per test wins — that's the "end-of-test" state, the
      // most useful comparison point for regression detection.
      const existing = final.get(event.testId);
      final.set(event.testId, {
        testId: event.testId,
        testTitle: titles.get(event.testId) ?? event.testId,
        tree: event.tree,
        ...(existing?.a11y !== undefined ? { a11y: existing.a11y } : {}),
      });
    } else if (event.t === 'a11y:snapshot') {
      // a11y captured once at end-of-test by the fixture — last write wins
      // if a future change captures per-step. Carry forward the component
      // snapshot if one already arrived earlier in the log.
      const existing = final.get(event.testId);
      if (existing !== undefined) {
        final.set(event.testId, { ...existing, a11y: event.tree });
      } else {
        // Synthesize a placeholder so the test shows up even when only
        // the a11y snapshot survived. The component diff side just won't
        // produce diffs for this test.
        final.set(event.testId, {
          testId: event.testId,
          testTitle: titles.get(event.testId) ?? event.testId,
          tree: { id: '0', name: 'Root', props: {}, children: [] },
          a11y: event.tree,
        });
      }
    }
  }
  return final;
}

function renderText(
  runIdA: string,
  runIdB: string,
  perTest: Array<{ testId: string; testTitle: string; diffs: SemanticDiff[]; a11yDiffs: A11ySemanticDiff[] }>,
): string {
  if (perTest.length === 0) {
    return `No semantic differences between ${runIdA} and ${runIdB}.\n`;
  }
  const lines: string[] = [];
  lines.push(`Semantic diff: ${runIdA} → ${runIdB}`);
  lines.push('');
  for (const test of perTest) {
    lines.push(`■ ${test.testTitle}`);
    if (test.diffs.length > 0) {
      lines.push('  components:');
      for (const d of test.diffs) lines.push(`    · ${renderDiffLine(d)}`);
    }
    if (test.a11yDiffs.length > 0) {
      lines.push('  a11y:');
      for (const d of test.a11yDiffs) lines.push(`    · ${renderA11yDiffLine(d)}`);
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

function renderA11yDiffLine(d: A11ySemanticDiff): string {
  switch (d.kind) {
    case 'node-added':
      return `+ ${d.path}`;
    case 'node-removed':
      return `- ${d.path}`;
    case 'attr-changed':
      return `~ ${d.path} · @${d.attr}: ${shortValue(d.before)} → ${shortValue(d.after)}`;
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
