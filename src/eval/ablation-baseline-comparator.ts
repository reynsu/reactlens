// AblationBaselineComparator — gives ADR-0008's rubric operational teeth.
//
// CI workflow #14 reads `tests/diagnostic-eval/ablation-baseline.json`,
// runs the ablation harness against the current commit, and feeds both
// AblationReports through this comparator. The comparator decides
// pass/fail and the CI job exits accordingly.
//
// Three failure modes (from the issue acceptance criteria):
//
//   1. Overall accuracy regression > threshold (default 2 percentage
//      points). Acceptable amount of noise tolerated because the agent
//      is non-deterministic; tightening to 0 would chase ghosts.
//   2. New false-high-confidence classification (count strictly up).
//      Calibration regression that Principle 2 forbids — an agent
//      saying `high` on a wrong answer is worse than `low` on it, and
//      this number can move adversely while overall accuracy holds.
//   3. Delta inversion — with-snapshot worse than without-snapshot.
//      The moat thesis is "snapshot helps OR is neutral", never
//      "snapshot makes things worse". An inversion means a prompt
//      change broke the snapshot signal even if overall numbers held.
//
// Pure. No IO, no env reads. The runner is responsible for reading the
// threshold from env (REACTLENS_ABLATION_ACCURACY_THRESHOLD_PP) and
// passing it in. Keeping IO out of the comparator means a single
// comparator change can be unit-tested without spinning up an LLM.
import type { AblationReport } from './ablation-harness';

// 2pp default per the issue acceptance criterion. Exposed as a named
// constant so the runner + tests share the same source.
export const DEFAULT_ACCURACY_THRESHOLD_PP = 2;

export type BaselineCompareThresholds = {
  // Maximum allowed regression in with-snapshot accuracy, in PERCENTAGE
  // POINTS (not a fraction). 2 means: a drop from 0.92 to 0.90 (2pp) is
  // exactly at the limit and passes; 0.92 to 0.89 (3pp) fails.
  maxAccuracyRegressionPp: number;
};

export type BaselineCompareResult = {
  ok: boolean;
  // Human-readable explanations, one per failure mode that tripped.
  // The CI gate logs these directly — so they must be self-contained
  // (mention which number, what the threshold was, what tripped it).
  failures: string[];
};

export function compareToBaseline(
  current: AblationReport,
  baseline: AblationReport,
  opts: Partial<BaselineCompareThresholds> = {},
): BaselineCompareResult {
  const thresholdPp = opts.maxAccuracyRegressionPp ?? DEFAULT_ACCURACY_THRESHOLD_PP;
  const failures: string[] = [];

  // Mode 1 — accuracy regression.
  // The threshold is expressed in percentage points (0..100), so convert
  // to a fractional delta (0..1) once before comparing. Subtract in the
  // current-from-baseline direction so a positive `regressionPp` means
  // "current is worse than baseline".
  const baselineAcc = baseline.headline.withSnapshot.accuracy;
  const currentAcc = current.headline.withSnapshot.accuracy;
  const regressionPp = (baselineAcc - currentAcc) * 100;
  if (regressionPp > thresholdPp) {
    failures.push(
      `Accuracy regressed by ${regressionPp.toFixed(2)}pp: baseline ${(baselineAcc * 100).toFixed(2)}% → current ${(currentAcc * 100).toFixed(2)}% (threshold: ${thresholdPp}pp).`,
    );
  }

  // Mode 2 — new false-high-confidence cases.
  // Strict increase is the trigger. Equal count or decrease passes;
  // a new wrongly-confident classification is a calibration regression
  // even when overall accuracy is unchanged.
  const baselineFC = baseline.headline.withSnapshot.falseConfidenceCount;
  const currentFC = current.headline.withSnapshot.falseConfidenceCount;
  if (currentFC > baselineFC) {
    failures.push(
      `False-high-confidence count increased: baseline ${baselineFC} → current ${currentFC}. Per Principle 2, this is worse than an overall accuracy regression — a confident wrong answer is more damaging than a low-confidence wrong answer.`,
    );
  }

  // Mode 3 — delta inversion on the CURRENT report.
  // We judge the inversion on the current report alone, not against
  // baseline, because "with-snapshot is worse than without-snapshot"
  // is a structural failure of the moat thesis regardless of where
  // the baseline sat.
  const currentDelta = current.headline.delta.accuracy;
  if (currentDelta < 0) {
    failures.push(
      `Moat-contribution delta inverted: with-snapshot accuracy ${(current.headline.withSnapshot.accuracy * 100).toFixed(2)}% is WORSE than without-snapshot ${(current.headline.withoutSnapshot.accuracy * 100).toFixed(2)}% (delta ${(currentDelta * 100).toFixed(2)}pp). The snapshot signal is hurting diagnosis on this commit; ADR-0008 thesis broken.`,
    );
  }

  return { ok: failures.length === 0, failures };
}
