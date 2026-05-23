// AblationHarness — runs the eval set under both with-snapshot and
// without-snapshot variants and produces the AblationReport that
// quantifies the moat-contribution delta from ADR-0001.
//
// Per ADR-0008, the only metric reactlens claims as the moat is whether
// the snapshot signal improves diagnosis. This module is the place
// where that claim either holds up or falls apart, on every measurement.
//
// Post-#46: the harness owns the agent invocation directly via
// DiagnosisRun's `ablation` intent. The previous `DiagnoseFn` injection
// seam is gone — tests stub at the `AgentRunner` level (FakeAgentRunner
// returning scripted JSON per case × variant), the production caller in
// `tests/diagnostic-eval/eval-runner.test.ts` passes a real AgentRunner.
//
// `src/eval/production-diagnose-fn.ts` is no longer imported (its file
// remains until #47 deletes it). The §13 Calibration fence and the
// Variant transform both live inside the DiagnosisRun Module now —
// the harness only schedules invocations and aggregates results.
import type { Diagnosis } from '@reynsu/reactlens-diagnosis-prompts';
import type { AgentRunner } from '../agent/runner';
import { createDiagnosisRun } from '../diagnosis-run/run';
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

// The three confidence levels the diagnosis agent can emit. Same tuple
// pattern as CLASSIFICATIONS above — guarantees every key is present
// in the per-confidence record so the CI gate can read
// `.byConfidence[c].accuracy` unconditionally.
type Confidence = Diagnosis['confidence'];
const CONFIDENCES: readonly Confidence[] = ['high', 'medium', 'low'] as const;

export type ConfidenceStat = {
  total: number;
  correct: number;
  accuracy: number;
};

// Optional cache for (case, variant) → Diagnosis. When provided, the
// harness checks `get` before invoking diagnoseFn; on miss, it calls
// diagnoseFn and then `set` so subsequent runs over unchanged inputs
// short-circuit the agent (per issue #8 acceptance criterion: re-running
// with no input changes does not re-invoke the agent).
//
// Hashing strategy lives inside the implementation, not on this surface
// — keeps the harness oblivious to whether the cache is in-memory, file-
// backed, or sharded.
export type AblationCache = {
  get(input: { case: EvalCase; variant: AblationVariant }): Promise<Diagnosis | undefined>;
  set(input: { case: EvalCase; variant: AblationVariant; diagnosis: Diagnosis }): Promise<void>;
};

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
  // Per-emitted-confidence bucket. Keys are the three confidence levels
  // the agent emits; values count cases where the AGENT's confidence
  // was that key. Calibration axis from Principle 2 / ADR-0008:
  // `.byConfidence.high.accuracy` answers "when the agent said HIGH,
  // was it actually right?". Deepens falseConfidenceCount (which only
  // tracks high-but-wrong) into a full ladder breakdown.
  byConfidence: Record<Confidence, ConfidenceStat>;
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

// Calibration: cross-variant confidence comparison. The headline metric
// (accuracy + falseConfidenceRate) is structurally blind to cases where
// both variants classify correctly but emit different confidence levels
// — yet that asymmetry is the moat signal case-020 surfaced
// (finding_ablation_delta_zero.md 2026-05-22). `speculativeHighCount`
// counts cases where without-snapshot says 'high' but with-snapshot
// says less — i.e. cases where the snapshot induced appropriate
// humility on inputs the snapshotless agent was over-confident about.
// Optional field, secondary metric — not in headline, not in CI gate,
// ADR-0001 intentionally unchanged.
export type Calibration = {
  speculativeHighCount: number;
  speculativeHighRate: number;
  // `confidenceBoostCount` counts the symmetric case: with-snapshot
  // strictly exceeds without-snapshot. Interpretation: the snapshot
  // resolved source-level ambiguity, letting the agent commit higher
  // when the source alone wouldn't have justified it.
  confidenceBoostCount: number;
  confidenceBoostRate: number;
  // Cases where both variants emit the same confidence level. The
  // snapshot didn't change the agent's certainty either way — either
  // both at high (source-clear) or both at low (source AND tree
  // equally lost). Together with humility + boost, the three
  // counts partition paired cases.
  confidenceMatchCount: number;
};

const CONFIDENCE_RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

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
  // Optional. Populated when at least one curated case ran through both
  // variants. Backward-compat: old baselines lack this field, so the
  // comparator must tolerate `undefined` (slice-1 contract).
  calibration?: Calibration;
};

export type RunAblationArgs = {
  cases: EvalCase[];
  // Post-#46: the harness constructs DiagnosisRun internally. Callers
  // pass an AgentRunner directly (a real one for production eval,
  // FakeAgentRunner for unit tests). The `ablation` intent handles
  // sandbox + Variant transform per-tuple.
  agent: AgentRunner;
  // Optional cache. When omitted, every (case, variant) tuple runs
  // fresh — useful for the first measurement, tests, or one-shot
  // recalibration. CI gates pass a file-backed cache so unchanged
  // inputs across commits don't re-pay the per-token bill.
  cache?: AblationCache;
};

const VARIANTS: readonly AblationVariant[] = ['with-snapshot', 'without-snapshot'] as const;

export async function runAblation(args: RunAblationArgs): Promise<AblationReport> {
  const { cases, agent, cache } = args;
  const runner = createDiagnosisRun({ agent });
  const curatedBucket = newVariantBucket();
  const uncuratedBucket = newVariantBucket();
  // Per-case confidence pairing for calibration computation. Curated
  // only — uncurated cases never feed any moat metric (ADR-0004), and
  // calibration is a moat metric just like accuracy.
  const curatedPerCase = new Map<string, { with?: Confidence; without?: Confidence }>();

  for (const c of cases) {
    const bucket = c.curated ? curatedBucket : uncuratedBucket;
    const expected = c.truth.expectedClassification;
    for (const variant of VARIANTS) {
      // Check cache first — if the (case, variant) pair was already
      // diagnosed on an unchanged input, reuse the prior answer rather
      // than re-paying the agent invocation. On miss, write the fresh
      // result back so subsequent runs become hits (issue #8: re-running
      // with no input changes does not re-invoke the agent).
      const cached = await cache?.get({ case: c, variant });
      let diagnosis: Diagnosis;
      if (cached !== undefined) {
        diagnosis = cached;
      } else {
        diagnosis = await runner.run({
          kind: 'ablation',
          caseDir: c.path,
          name: c.name,
          variant,
        });
        await cache?.set({ case: c, variant, diagnosis });
      }
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

      // Per-emitted-confidence bucket — keyed by the AGENT's answer
      // so a `high`-but-wrong stays visible as low accuracy in the
      // `high` bucket. This is the calibration axis the moat rubric
      // (ADR-0008) measures against.
      const confBucket = report.byConfidence[diagnosis.confidence];
      confBucket.total += 1;
      if (correct) confBucket.correct += 1;

      // Calibration: remember this variant's confidence so the
      // cross-variant comparison can fire at the end. Curated only —
      // uncurated cases don't feed moat metrics.
      if (c.curated) {
        const key = c.name;
        const existing = curatedPerCase.get(key) ?? {};
        existing[variant === 'with-snapshot' ? 'with' : 'without'] = diagnosis.confidence;
        curatedPerCase.set(key, existing);
      }
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
  // Calibration aggregate. Computed from per-case confidence pairs
  // collected during the variant loop. Skips cases where either
  // variant errored (missing confidence) — those drop out of the
  // denominator.
  const calibration = computeCalibration(curatedPerCase);
  if (calibration !== undefined) report.calibration = calibration;
  return report;
}

function computeCalibration(
  perCase: Map<string, { with?: Confidence; without?: Confidence }>,
): Calibration | undefined {
  let speculativeHighCount = 0;
  let confidenceBoostCount = 0;
  let confidenceMatchCount = 0;
  let paired = 0;
  for (const pair of perCase.values()) {
    if (pair.with === undefined || pair.without === undefined) continue;
    paired += 1;
    if (pair.without === 'high' && pair.with !== 'high') speculativeHighCount += 1;
    if (CONFIDENCE_RANK[pair.with] > CONFIDENCE_RANK[pair.without]) confidenceBoostCount += 1;
    if (pair.with === pair.without) confidenceMatchCount += 1;
  }
  if (paired === 0) return undefined;
  return {
    speculativeHighCount,
    speculativeHighRate: speculativeHighCount / paired,
    confidenceBoostCount,
    confidenceBoostRate: confidenceBoostCount / paired,
    confidenceMatchCount,
  };
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
    for (const c of CONFIDENCES) {
      const cb = r.byConfidence[c];
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
  const byConfidence = {} as Record<Confidence, ConfidenceStat>;
  for (const c of CONFIDENCES) {
    byConfidence[c] = { total: 0, correct: 0, accuracy: 0 };
  }
  return {
    variant,
    totalCases: 0,
    correctCount: 0,
    accuracy: 0,
    falseConfidenceCount: 0,
    falseConfidenceRate: 0,
    byClassification,
    byConfidence,
  };
}
