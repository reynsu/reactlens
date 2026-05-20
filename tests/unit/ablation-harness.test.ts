// TDD for the AblationHarness deep module — issue #8 behaviors #10-18.
// The harness loops over (case, variant) tuples, delegates the agent
// invocation to an injected `diagnoseFn` (real in production, scripted
// in tests), and computes the AblationReport that drives the moat-
// contribution delta from ADR-0001.
//
// The agent-invocation seam (`diagnoseFn`) keeps the harness testable
// without a real LLM and without coupling to the diagnose-prompt
// loading path in `src/analyzer/failure-agent.ts`. Production code
// wraps `diagnose() + generateVariant()` into a DiagnoseFn; tests pass
// a scripted one.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Diagnosis } from '@reynsu/reactlens-diagnosis-prompts';
import { loadEvalCases } from '../../src/eval/eval-case-loader';
import {
  type DiagnoseFn,
  runAblation,
} from '../../src/eval/ablation-harness';

function makeCuratedCase(
  casesDir: string,
  name: string,
  truth: { expectedClassification: string; minimumConfidence: string; category?: string },
): string {
  const dir = join(casesDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'truth.json'), JSON.stringify(truth));
  writeFileSync(join(dir, 'component.tsx'), 'export function C(): null { return null; }\n');
  writeFileSync(join(dir, 'spec.ts'), 'import {test} from "@playwright/test"; test("x", () => {});\n');
  return dir;
}

function makeDiagnosis(overrides: Partial<Diagnosis> = {}): Diagnosis {
  return {
    classification: 'test-bug',
    confidence: 'high',
    rootCause: 'spec uses stale selector',
    evidence: ['data-testid mismatch'],
    suggestedFix: 'update selector',
    ...overrides,
  };
}

describe('runAblation', () => {
  it('runs each case through both variants and returns per-variant accuracy', async () => {
    const casesDir = mkdtempSync(join(tmpdir(), 'reactlens-ablation-'));
    makeCuratedCase(casesDir, 'case-001-stale-selector', {
      expectedClassification: 'test-bug',
      minimumConfidence: 'medium',
    });
    const cases = loadEvalCases(casesDir);

    // Both variants return the same correct diagnosis — accuracy 100%
    // for the headline, no delta. The tracer just verifies that the
    // harness invokes the diagnoseFn for each variant and reports the
    // per-variant accuracy structurally.
    const diagnoseFn: DiagnoseFn = async () => makeDiagnosis();

    const report = await runAblation({ cases, diagnoseFn });

    expect(report.headline.withSnapshot.totalCases).toBe(1);
    expect(report.headline.withSnapshot.correctCount).toBe(1);
    expect(report.headline.withSnapshot.accuracy).toBe(1);
    expect(report.headline.withoutSnapshot.totalCases).toBe(1);
    expect(report.headline.withoutSnapshot.correctCount).toBe(1);
    expect(report.headline.withoutSnapshot.accuracy).toBe(1);
  });

  // Behavior #11 + #12: real accuracy math + false-confidence tracking.
  // False-confidence-rate is defined as: of cases the agent classified
  // wrong, what fraction had `confidence: 'high'`. It's the calibration
  // metric Principle 2 of CLAUDE.md §10 forbids regressing — claiming
  // high confidence on a wrong answer is the worst output mode.
  it('computes accuracy and false-confidence rate across mixed cases', async () => {
    const casesDir = mkdtempSync(join(tmpdir(), 'reactlens-ablation-'));
    makeCuratedCase(casesDir, 'case-001-real-bug', {
      expectedClassification: 'real-bug',
      minimumConfidence: 'medium',
    });
    makeCuratedCase(casesDir, 'case-002-test-bug', {
      expectedClassification: 'test-bug',
      minimumConfidence: 'medium',
    });
    makeCuratedCase(casesDir, 'case-003-flaky', {
      expectedClassification: 'flaky',
      minimumConfidence: 'low',
    });
    const cases = loadEvalCases(casesDir);

    // Scripted: per case, identical reply for both variants. Mix:
    //   case-001-real-bug → correct (real-bug, high)
    //   case-002-test-bug → wrong (real-bug, high)  ← false confidence
    //   case-003-flaky    → wrong (test-bug, low)   ← not false-confidence (low)
    const replies: Record<string, Diagnosis> = {
      'case-001-real-bug': makeDiagnosis({ classification: 'real-bug', confidence: 'high' }),
      'case-002-test-bug': makeDiagnosis({ classification: 'real-bug', confidence: 'high' }),
      'case-003-flaky': makeDiagnosis({ classification: 'test-bug', confidence: 'low' }),
    };
    const diagnoseFn: DiagnoseFn = async ({ case: c }) => {
      const reply = replies[c.name];
      if (!reply) throw new Error(`unscripted case: ${c.name}`);
      return reply;
    };

    const report = await runAblation({ cases, diagnoseFn });

    // 1 correct / 3 total per variant = 0.333…
    expect(report.headline.withSnapshot.totalCases).toBe(3);
    expect(report.headline.withSnapshot.correctCount).toBe(1);
    expect(report.headline.withSnapshot.accuracy).toBeCloseTo(1 / 3);
    // 1 wrong high-confidence / 3 total = 0.333…
    expect(report.headline.withSnapshot.falseConfidenceCount).toBe(1);
    expect(report.headline.withSnapshot.falseConfidenceRate).toBeCloseTo(1 / 3);

    // Same scripted replies for both variants, so the withoutSnapshot
    // numbers mirror exactly. The delta will be zero — verified in
    // behavior #15.
    expect(report.headline.withoutSnapshot.accuracy).toBeCloseTo(1 / 3);
    expect(report.headline.withoutSnapshot.falseConfidenceCount).toBe(1);
  });

  // Behavior #15: the delta IS the moat-contribution metric per
  // ADR-0001 + ADR-0008. If with-snapshot doesn't beat without-snapshot,
  // the moat doesn't exist for this case set. The harness MUST surface
  // the delta as a first-class field so CI gates (slice #14) can read
  // a single number and decide pass/fail.
  it('computes the delta (with-snapshot minus without-snapshot) for accuracy and false-confidence', async () => {
    const casesDir = mkdtempSync(join(tmpdir(), 'reactlens-ablation-'));
    makeCuratedCase(casesDir, 'case-001-only-snapshot-helps', {
      expectedClassification: 'real-bug',
      minimumConfidence: 'medium',
    });
    makeCuratedCase(casesDir, 'case-002-both-correct', {
      expectedClassification: 'test-bug',
      minimumConfidence: 'medium',
    });
    const cases = loadEvalCases(casesDir);

    // case-001: with-snapshot correct, without-snapshot wrong (high) →
    //   the snapshot demonstrably changes the answer for this case.
    // case-002: both correct (high).
    // Expected: with-snapshot accuracy 2/2, without-snapshot 1/2.
    // Delta accuracy = +0.5. Delta falseConfidenceRate = -0.5.
    const diagnoseFn: DiagnoseFn = async ({ case: c, variant }) => {
      if (c.name === 'case-001-only-snapshot-helps') {
        return variant === 'with-snapshot'
          ? makeDiagnosis({ classification: 'real-bug', confidence: 'high' })
          : makeDiagnosis({ classification: 'flaky', confidence: 'high' });
      }
      return makeDiagnosis({ classification: 'test-bug', confidence: 'high' });
    };

    const report = await runAblation({ cases, diagnoseFn });

    expect(report.headline.withSnapshot.accuracy).toBe(1);
    expect(report.headline.withoutSnapshot.accuracy).toBe(0.5);
    expect(report.headline.delta.accuracy).toBeCloseTo(0.5);
    expect(report.headline.delta.falseConfidenceRate).toBeCloseTo(-0.5);
  });

  // Behavior #16: the headline accuracy MUST exclude uncurated cases
  // (per ADR-0004 + issue #8). Corpus-harvested cases are candidates
  // until a human reviews them; mixing them into the headline would
  // contaminate the moat-contribution number with un-validated truth
  // labels. The harness reports them separately under `uncurated` so
  // operators can still see whether the agent handles them, without
  // affecting the headline.
  it('reports curated cases under headline and uncurated cases under a separate `uncurated` field', async () => {
    const casesDir = mkdtempSync(join(tmpdir(), 'reactlens-ablation-'));
    makeCuratedCase(casesDir, 'case-001-curated-correct', {
      expectedClassification: 'real-bug',
      minimumConfidence: 'medium',
    });
    makeCuratedCase(casesDir, 'case-002-curated-wrong', {
      expectedClassification: 'test-bug',
      minimumConfidence: 'medium',
    });
    // Plant an uncurated case under the harvest path.
    const harvestRoot = join(casesDir, 'synthetic-from-corpus', 'some-repo');
    mkdirSync(harvestRoot, { recursive: true });
    makeCuratedCase(harvestRoot, 'case-001-uncurated-wrong', {
      expectedClassification: 'flaky',
      minimumConfidence: 'low',
    });
    const cases = loadEvalCases(casesDir);

    // Scripted: every case gets `real-bug, high`.
    //   case-001-curated-correct: correct (real-bug)
    //   case-002-curated-wrong: wrong (expected test-bug, got real-bug)
    //   case-001-uncurated-wrong: wrong (expected flaky, got real-bug)
    const diagnoseFn: DiagnoseFn = async () =>
      makeDiagnosis({ classification: 'real-bug', confidence: 'high' });

    const report = await runAblation({ cases, diagnoseFn });

    // Headline: 1 correct of 2 curated = 0.5. NOT contaminated by the
    // uncurated wrong case.
    expect(report.headline.withSnapshot.totalCases).toBe(2);
    expect(report.headline.withSnapshot.correctCount).toBe(1);
    expect(report.headline.withSnapshot.accuracy).toBe(0.5);

    // Uncurated reported separately: 0 correct of 1.
    expect(report.uncurated?.withSnapshot.totalCases).toBe(1);
    expect(report.uncurated?.withSnapshot.correctCount).toBe(0);
    expect(report.uncurated?.withSnapshot.accuracy).toBe(0);
  });

  // Behavior #13: per-classification breakdown. Knowing the harness is
  // 90% accurate isn't enough — operators need to know WHICH failure
  // class regressed when accuracy drops. `byClassification` answers
  // that, and the CI gate in slice #14 can scope its threshold per
  // class if needed (e.g., real-bug detection is more critical).
  it('reports accuracy broken down by classification', async () => {
    const casesDir = mkdtempSync(join(tmpdir(), 'reactlens-ablation-'));
    makeCuratedCase(casesDir, 'case-01-real-bug-a', {
      expectedClassification: 'real-bug',
      minimumConfidence: 'high',
    });
    makeCuratedCase(casesDir, 'case-02-real-bug-b', {
      expectedClassification: 'real-bug',
      minimumConfidence: 'high',
    });
    makeCuratedCase(casesDir, 'case-03-test-bug', {
      expectedClassification: 'test-bug',
      minimumConfidence: 'medium',
    });
    makeCuratedCase(casesDir, 'case-04-flaky', {
      expectedClassification: 'flaky',
      minimumConfidence: 'low',
    });
    const cases = loadEvalCases(casesDir);

    // Scripted by case:
    //   case-01-real-bug-a: correct (real-bug)
    //   case-02-real-bug-b: WRONG (test-bug)        → real-bug bucket 1/2
    //   case-03-test-bug: correct (test-bug)        → test-bug bucket 1/1
    //   case-04-flaky: correct (flaky)              → flaky bucket 1/1
    //                                                  env-issue bucket 0/0
    const replies: Record<string, Diagnosis> = {
      'case-01-real-bug-a': makeDiagnosis({ classification: 'real-bug', confidence: 'high' }),
      'case-02-real-bug-b': makeDiagnosis({ classification: 'test-bug', confidence: 'high' }),
      'case-03-test-bug': makeDiagnosis({ classification: 'test-bug', confidence: 'high' }),
      'case-04-flaky': makeDiagnosis({ classification: 'flaky', confidence: 'medium' }),
    };
    const diagnoseFn: DiagnoseFn = async ({ case: c }) => {
      const reply = replies[c.name];
      if (!reply) throw new Error(`unscripted: ${c.name}`);
      return reply;
    };

    const report = await runAblation({ cases, diagnoseFn });
    const ws = report.headline.withSnapshot;

    expect(ws.byClassification['real-bug']).toMatchObject({ total: 2, correct: 1, accuracy: 0.5 });
    expect(ws.byClassification['test-bug']).toMatchObject({ total: 1, correct: 1, accuracy: 1 });
    expect(ws.byClassification.flaky).toMatchObject({ total: 1, correct: 1, accuracy: 1 });
    // Classifications with zero cases: total 0, accuracy 0 (not NaN).
    expect(ws.byClassification['env-issue']).toMatchObject({ total: 0, correct: 0, accuracy: 0 });
  });

  // Behavior #14: per-confidence calibration. Keyed by the agent's
  // EMITTED confidence (not truth.minimumConfidence) — that's the
  // calibration axis Principle 2 / ADR-0008 cares about: "when the
  // agent said HIGH, was it actually right?". Deepens the existing
  // falseConfidenceCount (which only tracks high-but-wrong) into a
  // full breakdown so the slice #14 CI gate can fail on calibration
  // regressions across the whole confidence ladder.
  it('reports accuracy broken down by emitted confidence', async () => {
    const casesDir = mkdtempSync(join(tmpdir(), 'reactlens-ablation-'));
    // All four cases expect real-bug — varying the agent's answer
    // and confidence isolates the per-confidence axis cleanly.
    makeCuratedCase(casesDir, 'case-01-high-correct', {
      expectedClassification: 'real-bug',
      minimumConfidence: 'high',
    });
    makeCuratedCase(casesDir, 'case-02-high-wrong', {
      expectedClassification: 'real-bug',
      minimumConfidence: 'high',
    });
    makeCuratedCase(casesDir, 'case-03-medium-correct', {
      expectedClassification: 'real-bug',
      minimumConfidence: 'medium',
    });
    makeCuratedCase(casesDir, 'case-04-low-correct', {
      expectedClassification: 'real-bug',
      minimumConfidence: 'low',
    });
    const cases = loadEvalCases(casesDir);

    // Scripted to land in distinct buckets keyed by agent's confidence:
    //   high   bucket: 2 total, 1 correct → 0.5  (the calibration failure)
    //   medium bucket: 1 total, 1 correct → 1
    //   low    bucket: 1 total, 1 correct → 1
    const replies: Record<string, Diagnosis> = {
      'case-01-high-correct': makeDiagnosis({ classification: 'real-bug', confidence: 'high' }),
      'case-02-high-wrong': makeDiagnosis({ classification: 'test-bug', confidence: 'high' }),
      'case-03-medium-correct': makeDiagnosis({ classification: 'real-bug', confidence: 'medium' }),
      'case-04-low-correct': makeDiagnosis({ classification: 'real-bug', confidence: 'low' }),
    };
    const diagnoseFn: DiagnoseFn = async ({ case: c }) => {
      const reply = replies[c.name];
      if (!reply) throw new Error(`unscripted: ${c.name}`);
      return reply;
    };

    const report = await runAblation({ cases, diagnoseFn });
    const ws = report.headline.withSnapshot;

    expect(ws.byConfidence.high).toMatchObject({ total: 2, correct: 1, accuracy: 0.5 });
    expect(ws.byConfidence.medium).toMatchObject({ total: 1, correct: 1, accuracy: 1 });
    expect(ws.byConfidence.low).toMatchObject({ total: 1, correct: 1, accuracy: 1 });
  });
});
