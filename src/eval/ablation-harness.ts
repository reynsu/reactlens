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
    for (const variant of VARIANTS) {
      const diagnosis = await diagnoseFn({ case: c, variant });
      const report = bucket[variant];
      report.totalCases += 1;
      const correct = diagnosis.classification === c.truth.expectedClassification;
      if (correct) report.correctCount += 1;
      else if (diagnosis.confidence === 'high') report.falseConfidenceCount += 1;
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
  return {
    variant,
    totalCases: 0,
    correctCount: 0,
    accuracy: 0,
    falseConfidenceCount: 0,
    falseConfidenceRate: 0,
  };
}
