// Pure formatter: AblationReport → human-readable stdout string.
//
// Per issue #8 acceptance criterion, the ablation command must print
// overall accuracy delta, false-confidence-rate delta, per-classification
// delta, and per-confidence-level delta. This file is the single place
// that decides how those numbers look on a developer's terminal.
//
// Why a pure function and not a logger.info call: the moat-rubric (ADR-
// 0008) measures moat-contribution by comparing this output across
// commits. A pure transform is byte-stable for a given input — easy to
// diff, easy to snapshot in a CI gate, easy to unit-test without
// mocking pino.
import type {
  AblationReport,
  ClassificationStat,
  ConfidenceStat,
  VariantReport,
} from './ablation-harness';

const CLASSIFICATION_ORDER: readonly (keyof VariantReport['byClassification'])[] = [
  'real-bug',
  'test-bug',
  'flaky',
  'env-issue',
];
const CONFIDENCE_ORDER: readonly (keyof VariantReport['byConfidence'])[] = ['high', 'medium', 'low'];

export function formatAblationReport(report: AblationReport): string {
  const lines: string[] = [];
  const { withSnapshot, withoutSnapshot, delta } = report.headline;

  lines.push('Ablation report');
  lines.push('═══════════════');
  lines.push('');
  lines.push(`Cases (curated): ${withSnapshot.totalCases}`);
  if (report.uncurated !== undefined) {
    lines.push(`Cases (uncurated, informational): ${report.uncurated.withSnapshot.totalCases}`);
  }
  lines.push('');
  lines.push(`                  with-snapshot   without-snapshot   delta`);
  lines.push(
    `overall accuracy  ${pct(withSnapshot.accuracy)}           ${pct(withoutSnapshot.accuracy)}              ${signedPct(delta.accuracy)}`,
  );
  lines.push(
    `false-confidence  ${pct(withSnapshot.falseConfidenceRate)}           ${pct(withoutSnapshot.falseConfidenceRate)}              ${signedPct(delta.falseConfidenceRate)}`,
  );
  lines.push('');
  lines.push('By classification (keyed by expected class):');
  for (const c of CLASSIFICATION_ORDER) {
    const w = withSnapshot.byClassification[c];
    const wo = withoutSnapshot.byClassification[c];
    lines.push(`  ${c.padEnd(12)} ${rowFor(w, wo)}`);
  }
  lines.push('');
  lines.push('By emitted confidence (calibration):');
  for (const c of CONFIDENCE_ORDER) {
    const w = withSnapshot.byConfidence[c];
    const wo = withoutSnapshot.byConfidence[c];
    lines.push(`  ${c.padEnd(12)} ${rowFor(w, wo)}`);
  }

  // Cross-variant calibration. Optional secondary metric (per
  // finding_ablation_delta_zero.md 2026-05-22): catches the moat signal
  // the headline accuracy metric is structurally blind to — cases where
  // both variants classify correctly but the without-snapshot agent
  // emits 'high' while with-snapshot honestly drops to lower confidence.
  // When the field is undefined (legacy baselines, empty case set), the
  // whole section disappears rather than rendering a "none" stub.
  if (report.calibration !== undefined) {
    const cal = report.calibration;
    lines.push('');
    lines.push('Calibration (cross-variant confidence shifts):');
    lines.push(
      `  speculative-high (without=high, with<high)  ${cal.speculativeHighCount} (${pct(cal.speculativeHighRate)})`,
    );
    lines.push(
      `  confidence-boost (with>without)             ${cal.confidenceBoostCount} (${pct(cal.confidenceBoostRate)})`,
    );
    lines.push(`  confidence-match (with==without)            ${cal.confidenceMatchCount}`);
  }

  return lines.join('\n');
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function signedPct(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${(n * 100).toFixed(1)}%`;
}

// ClassificationStat and ConfidenceStat are shape-identical
// (`{ total, correct, accuracy }`); one row helper covers both.
function rowFor(w: ClassificationStat | ConfidenceStat, wo: ClassificationStat | ConfidenceStat): string {
  if (w.total === 0 && wo.total === 0) return '— (no cases)';
  return `${pct(w.accuracy)} (${w.correct}/${w.total})   ${pct(wo.accuracy)} (${wo.correct}/${wo.total})   ${signedPct(w.accuracy - wo.accuracy)}`;
}
