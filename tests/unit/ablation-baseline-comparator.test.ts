// TDD for the AblationBaselineComparator — the deep module that gives
// ADR-0008's rubric operational teeth in CI (slice #14 of v0.3 #7).
//
// The comparator is pure: takes a fresh AblationReport + the checked-in
// baseline, returns { ok, failures }. Three failure modes per the issue:
//   1. Overall accuracy regression > thresholdPp (default 2)
//   2. New false-high-confidence classification (count strictly up)
//   3. Delta inversion (with-snapshot worse than without-snapshot)
//
// Pure-fn TDD pattern: build small synthetic AblationReports inline and
// assert ok + failures.length for each mode. The harness/runner wiring
// is tested separately at the integration boundary.
import { describe, expect, it } from 'vitest';
import type { AblationReport, VariantReport } from '../../src/eval/ablation-harness';
import {
  compareToBaseline,
  DEFAULT_ACCURACY_THRESHOLD_PP,
} from '../../src/eval/ablation-baseline-comparator';

// Minimal helper — every test builds a synthetic VariantReport with the
// fields the comparator actually reads. Per-classification + per-confidence
// breakdowns are present (zero-filled) because the comparator MAY widen
// to inspect them later; not having them today would force a re-fixture
// across every test when that lands.
function variant(overrides: {
  accuracy: number;
  totalCases?: number;
  correctCount?: number;
  falseConfidenceCount?: number;
  falseConfidenceRate?: number;
}): VariantReport {
  const totalCases = overrides.totalCases ?? 16;
  return {
    variant: 'with-snapshot',
    totalCases,
    correctCount: overrides.correctCount ?? Math.round(overrides.accuracy * totalCases),
    accuracy: overrides.accuracy,
    falseConfidenceCount: overrides.falseConfidenceCount ?? 0,
    falseConfidenceRate: overrides.falseConfidenceRate ?? 0,
    byClassification: {
      'real-bug': { total: 0, correct: 0, accuracy: 0 },
      'test-bug': { total: 0, correct: 0, accuracy: 0 },
      flaky: { total: 0, correct: 0, accuracy: 0 },
      'env-issue': { total: 0, correct: 0, accuracy: 0 },
    },
    byConfidence: {
      high: { total: 0, correct: 0, accuracy: 0 },
      medium: { total: 0, correct: 0, accuracy: 0 },
      low: { total: 0, correct: 0, accuracy: 0 },
    },
  };
}

function report(args: {
  withSnapshot: VariantReport;
  withoutSnapshot: VariantReport;
}): AblationReport {
  return {
    headline: {
      withSnapshot: args.withSnapshot,
      withoutSnapshot: args.withoutSnapshot,
      delta: {
        accuracy: args.withSnapshot.accuracy - args.withoutSnapshot.accuracy,
        falseConfidenceRate: args.withSnapshot.falseConfidenceRate - args.withoutSnapshot.falseConfidenceRate,
      },
    },
  };
}

const PERFECT: AblationReport = report({
  withSnapshot: variant({ accuracy: 1 }),
  withoutSnapshot: variant({ accuracy: 1 }),
});

describe('compareToBaseline — happy paths', () => {
  it('passes when current matches baseline exactly', () => {
    const result = compareToBaseline(PERFECT, PERFECT);
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('passes when current strictly improves on baseline (higher accuracy, fewer false-high-confidence)', () => {
    const baseline = report({
      withSnapshot: variant({ accuracy: 0.8, falseConfidenceCount: 2 }),
      withoutSnapshot: variant({ accuracy: 0.7 }),
    });
    const current = report({
      withSnapshot: variant({ accuracy: 0.95, falseConfidenceCount: 0 }),
      withoutSnapshot: variant({ accuracy: 0.7 }),
    });
    expect(compareToBaseline(current, baseline)).toEqual({ ok: true, failures: [] });
  });

  it('passes when accuracy regressed by less than the threshold (2pp default)', () => {
    // Baseline 100% → current 99% is a 1pp regression, under the 2pp default.
    const baseline = report({
      withSnapshot: variant({ accuracy: 1.0 }),
      withoutSnapshot: variant({ accuracy: 1.0 }),
    });
    const current = report({
      withSnapshot: variant({ accuracy: 0.99 }),
      withoutSnapshot: variant({ accuracy: 0.99 }),
    });
    expect(compareToBaseline(current, baseline).ok).toBe(true);
  });
});

describe('compareToBaseline — failure mode 1: accuracy regression', () => {
  it('fails when with-snapshot accuracy regresses by more than the threshold', () => {
    // 100% → 95% is 5pp, over the 2pp default.
    const baseline = report({
      withSnapshot: variant({ accuracy: 1.0 }),
      withoutSnapshot: variant({ accuracy: 1.0 }),
    });
    const current = report({
      withSnapshot: variant({ accuracy: 0.95 }),
      withoutSnapshot: variant({ accuracy: 0.95 }),
    });
    const result = compareToBaseline(current, baseline);
    expect(result.ok).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
    // Failure message must surface the actual numbers — silent "regressed"
    // forces the operator to dig through stdout for context.
    expect(result.failures.some((f) => f.includes('100') && f.includes('95'))).toBe(true);
  });

  it('accepts a custom threshold override (looser)', () => {
    const baseline = report({
      withSnapshot: variant({ accuracy: 1.0 }),
      withoutSnapshot: variant({ accuracy: 1.0 }),
    });
    const current = report({
      withSnapshot: variant({ accuracy: 0.95 }),
      withoutSnapshot: variant({ accuracy: 0.95 }),
    });
    // 5pp regression, threshold widened to 10pp → passes.
    expect(compareToBaseline(current, baseline, { maxAccuracyRegressionPp: 10 }).ok).toBe(true);
  });

  it('accepts a custom threshold override (tighter)', () => {
    const baseline = report({
      withSnapshot: variant({ accuracy: 1.0 }),
      withoutSnapshot: variant({ accuracy: 1.0 }),
    });
    const current = report({
      withSnapshot: variant({ accuracy: 0.99 }),
      withoutSnapshot: variant({ accuracy: 0.99 }),
    });
    // 1pp regression, threshold tightened to 0.5pp → fails.
    expect(compareToBaseline(current, baseline, { maxAccuracyRegressionPp: 0.5 }).ok).toBe(false);
  });

  it('exposes DEFAULT_ACCURACY_THRESHOLD_PP as 2 per ADR-0008 acceptance criterion', () => {
    expect(DEFAULT_ACCURACY_THRESHOLD_PP).toBe(2);
  });
});

describe('compareToBaseline — failure mode 2: new false-high-confidence', () => {
  it('fails when current has more false-high-confidence cases than baseline', () => {
    const baseline = report({
      withSnapshot: variant({ accuracy: 0.9, falseConfidenceCount: 1, totalCases: 16 }),
      withoutSnapshot: variant({ accuracy: 0.9 }),
    });
    const current = report({
      // Accuracy held, but a previously low-confidence wrong answer became
      // a high-confidence wrong answer — exactly the calibration regression
      // Principle 2 forbids. The aggregate accuracy number masks this.
      withSnapshot: variant({ accuracy: 0.9, falseConfidenceCount: 2, totalCases: 16 }),
      withoutSnapshot: variant({ accuracy: 0.9 }),
    });
    const result = compareToBaseline(current, baseline);
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.toLowerCase().includes('false') && f.includes('1') && f.includes('2'))).toBe(true);
  });

  it('passes when false-high-confidence count stays equal', () => {
    const same = report({
      withSnapshot: variant({ accuracy: 0.9, falseConfidenceCount: 1 }),
      withoutSnapshot: variant({ accuracy: 0.9 }),
    });
    expect(compareToBaseline(same, same).ok).toBe(true);
  });

  it('passes when false-high-confidence count decreases', () => {
    const baseline = report({
      withSnapshot: variant({ accuracy: 0.9, falseConfidenceCount: 3 }),
      withoutSnapshot: variant({ accuracy: 0.9 }),
    });
    const current = report({
      withSnapshot: variant({ accuracy: 0.9, falseConfidenceCount: 1 }),
      withoutSnapshot: variant({ accuracy: 0.9 }),
    });
    expect(compareToBaseline(current, baseline).ok).toBe(true);
  });
});

describe('compareToBaseline — failure mode 3: delta inversion', () => {
  it('fails when with-snapshot performs worse than without-snapshot in current', () => {
    // Delta inversion: with-snapshot 0.85, without-snapshot 0.95.
    // Baseline doesn't matter for this check — the inversion is judged on
    // the CURRENT report alone, because the moat thesis is "snapshot helps
    // OR is neutral", never "snapshot makes things worse".
    const baseline = report({
      withSnapshot: variant({ accuracy: 1.0 }),
      withoutSnapshot: variant({ accuracy: 1.0 }),
    });
    const current = report({
      withSnapshot: variant({ accuracy: 0.85 }),
      withoutSnapshot: variant({ accuracy: 0.95 }),
    });
    const result = compareToBaseline(current, baseline);
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.toLowerCase().includes('invert') || f.toLowerCase().includes('worse'))).toBe(true);
  });

  it('passes when delta is exactly zero (the current production case)', () => {
    // delta=0 is the actual baseline as of slice #8; the gate must NOT
    // treat it as a failure. The thesis is "snapshot helps OR is neutral".
    const zeroDelta = report({
      withSnapshot: variant({ accuracy: 1.0 }),
      withoutSnapshot: variant({ accuracy: 1.0 }),
    });
    expect(compareToBaseline(zeroDelta, zeroDelta).ok).toBe(true);
  });

  it('passes when delta is positive (with-snapshot better than without)', () => {
    const positive = report({
      withSnapshot: variant({ accuracy: 0.95 }),
      withoutSnapshot: variant({ accuracy: 0.85 }),
    });
    expect(compareToBaseline(positive, positive).ok).toBe(true);
  });
});

describe('compareToBaseline — multiple failures surface together', () => {
  it('returns all applicable failure reasons, not just the first', () => {
    // Engineered to trip all three failure modes at once. The CI gate
    // operator needs to see the full picture in one shot, not iterate.
    const baseline = report({
      withSnapshot: variant({ accuracy: 1.0, falseConfidenceCount: 0 }),
      withoutSnapshot: variant({ accuracy: 1.0 }),
    });
    const current = report({
      withSnapshot: variant({ accuracy: 0.5, falseConfidenceCount: 5 }),
      withoutSnapshot: variant({ accuracy: 0.9 }),
    });
    const result = compareToBaseline(current, baseline);
    expect(result.ok).toBe(false);
    expect(result.failures.length).toBeGreaterThanOrEqual(3);
  });
});
