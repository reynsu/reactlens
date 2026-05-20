// AblationHarness — runs the eval set under both with-snapshot and
// without-snapshot variants and produces the AblationReport that
// quantifies the moat-contribution delta from ADR-0001.
//
// Per ADR-0008, the only metric reactlens claims as the moat is whether
// the snapshot signal improves diagnosis. This module is the place
// where that claim either holds up or falls apart, on every measurement.
//
// The harness delegates the agent invocation to an injected
// `diagnoseFn`. Production wires it to `diagnose() + generateVariant()`
// over a sandboxed copy of the case; tests pass scripted replies
// without touching a real LLM.
//
// This file is intentionally minimal — only the tracer-bullet behavior
// (per-variant accuracy for one case) is implemented. Per-classification
// + per-confidence breakdown, delta computation, curated-vs-uncurated
// split, and (case, variant) caching land in subsequent TDD cycles.
import type { Diagnosis } from '@reynsu/reactlens-diagnosis-prompts';
import type { EvalCase } from './eval-case-loader';
import type { AblationVariant } from './ablation-variant-generator';

// The four classifications the diagnosis agent emits (per CLAUDE.md §9
// and the upstream Diagnosis schema). Listed as a literal tuple so the
// VariantReport can initialise a record with all keys present — even
// classifications that didn't appear in this case set get a zero-bucket
// rather than `undefined`, so the CI gate in slice #14 can read
// `.byClassification[c].accuracy` without a null check.
type Classification = Diagnosis['classification'];
const CLASSIFICATIONS: readonly Classification[] = ['real-bug', 'test-bug', 'flaky', 'env-issue'] as const;

export type ClassificationStat = {
  total: number;
  correct: number;
  accuracy: number;
};

export type DiagnoseFn = (args: { case: EvalCase; variant: AblationVariant }) => Promise<Diagnosis>;

export type VariantReport = {
  variant: AblationVariant;
  totalCases: number;
  correctCount: number;
  accuracy: number;
  // False-confidence = `confidence: 'high'` AND classification was wrong.
  // Tracking this separately because Principle 2 (CLAUDE.md §10) says
  // calibrated confidence is non-negotiable; an agent that asserts
  // `high` on a wrong answer is worse than one that says `low` on it.
  falseConfidenceCount: number;
  falseConfidenceRate: number;
  // Per-expected-classification bucket. Keys are the four classifications
  // the agent emits; values count cases where the EXPECTED classification
  // is that key (regardless of what the agent said). Lets the CI gate
  // detect "we got worse at real-bug detection specifically", which a
  // single accuracy number masks.
  byClassification: Record<Classification, ClassificationStat>;
};

export type DeltaReport = {
  // `accuracy` and `falseConfidenceRate` are computed as
  //   withSnapshot - withoutSnapshot
  // so a positive `accuracy` delta means the snapshot helped, and a
  // negative `falseConfidenceRate` delta also means the snapshot helped
  // (fewer wrong-but-confident answers). The CI gate in slice #14 reads
  // these directly to decide pass/fail.
  accuracy: number;
  falseConfidenceRate: number;
};

export type AblationReport = {
  // Curated cases only. This is the moat-contribution number reactlens
  // claims publicly — uncurated harvest output never enters the
  // headline until a human curates it (ADR-0004).
  headline: {
    withSnapshot: VariantReport;
    withoutSnapshot: VariantReport;
    delta: DeltaReport;
  };
  // Optional, populated only when uncurated cases were present in the
  // input set. Operators can still see how the agent handled corpus-
  // harvested cases — they just don't shape the headline.
  uncurated?: {
    withSnapshot: VariantReport;
    withoutSnapshot: VariantReport;
    delta: DeltaReport;
  };
};

export type RunAblationArgs = {
  cases: EvalCase[];
  diagnoseFn: DiagnoseFn;
};

const VARIANTS: readonly AblationVariant[] = ['with-snapshot', 'without-snapshot'] as const;

export async function runAblation(args: RunAblationArgs): Promise<AblationReport> {
  const { cases, diagnoseFn } = args;
  const curatedBucket = newVariantBucket();
  const uncuratedBucket = newVariantBucket();

  for (const c of cases) {
    const bucket = c.curated ? curatedBucket : uncuratedBucket;
    const expected = c.truth.expectedClassification;
    for (const variant of VARIANTS) {
      const diagnosis = await diagnoseFn({ case: c, variant });
      const report = bucket[variant];
      report.totalCases += 1;
      const correct = diagnosis.classification === expected;
      if (correct) report.correctCount += 1;
      else if (diagnosis.confidence === 'high') report.falseConfidenceCount += 1;

      // Per-expected-classification bucket — keyed by the EXPECTED
      // class so an agent that always answers 'real-bug' shows 0%
      // accuracy on test-bug/flaky/env-issue, exposing the bias.
      const classBucket = report.byClassification[expected];
      classBucket.total += 1;
      if (correct) classBucket.correct += 1;
    }
  }

  finalizeRates(curatedBucket);
  finalizeRates(uncuratedBucket);

  const report: AblationReport = {
    headline: bucketToReport(curatedBucket),
  };
  // Only include the uncurated section if any uncurated case ran —
  // an empty section would be noise in stdout summaries.
  if (uncuratedBucket['with-snapshot'].totalCases > 0) {
    report.uncurated = bucketToReport(uncuratedBucket);
  }
  return report;
}

type VariantBucket = Record<AblationVariant, VariantReport>;

function newVariantBucket(): VariantBucket {
  return {
    'with-snapshot': blankVariantReport('with-snapshot'),
    'without-snapshot': blankVariantReport('without-snapshot'),
  };
}

function finalizeRates(bucket: VariantBucket): void {
  for (const variant of VARIANTS) {
    const r = bucket[variant];
    r.accuracy = r.totalCases === 0 ? 0 : r.correctCount / r.totalCases;
    r.falseConfidenceRate = r.totalCases === 0 ? 0 : r.falseConfidenceCount / r.totalCases;
    for (const c of CLASSIFICATIONS) {
      const cb = r.byClassification[c];
      cb.accuracy = cb.total === 0 ? 0 : cb.correct / cb.total;
    }
  }
}

function bucketToReport(bucket: VariantBucket): {
  withSnapshot: VariantReport;
  withoutSnapshot: VariantReport;
  delta: DeltaReport;
} {
  const withSnapshot = bucket['with-snapshot'];
  const withoutSnapshot = bucket['without-snapshot'];
  return {
    withSnapshot,
    withoutSnapshot,
    delta: {
      accuracy: withSnapshot.accuracy - withoutSnapshot.accuracy,
      falseConfidenceRate: withSnapshot.falseConfidenceRate - withoutSnapshot.falseConfidenceRate,
    },
  };
}

function blankVariantReport(variant: AblationVariant): VariantReport {
  const byClassification = {} as Record<Classification, ClassificationStat>;
  for (const c of CLASSIFICATIONS) {
    byClassification[c] = { total: 0, correct: 0, accuracy: 0 };
  }
  return {
    variant,
    totalCases: 0,
    correctCount: 0,
    accuracy: 0,
    falseConfidenceCount: 0,
    falseConfidenceRate: 0,
    byClassification,
  };
}
