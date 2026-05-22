// TDD for `formatAblationReport` — pure transform from AblationReport
// to the human-readable stdout output the issue #8 acceptance criterion
// requires:
//
//   "pnpm test:eval --ablation runs both variants and prints to stdout:
//    overall accuracy delta, false-confidence-rate delta, per-
//    classification delta, per-confidence-level delta."
//
// Isolating the formatter from the CLI plumbing keeps it pure and
// keeps the eval-runner.test.ts integration small. The format itself
// is verified by substring checks (not snapshot tests) so cosmetic
// edits don't break the test surface.
import { describe, expect, it } from 'vitest';
import { formatAblationReport } from '../../src/eval/ablation-report-formatter';
import type { AblationReport } from '../../src/eval/ablation-harness';

function makeReport(overrides: Partial<AblationReport> = {}): AblationReport {
  return {
    headline: {
      withSnapshot: {
        variant: 'with-snapshot',
        totalCases: 4,
        correctCount: 3,
        accuracy: 0.75,
        falseConfidenceCount: 0,
        falseConfidenceRate: 0,
        byClassification: {
          'real-bug': { total: 2, correct: 2, accuracy: 1 },
          'test-bug': { total: 1, correct: 1, accuracy: 1 },
          flaky: { total: 1, correct: 0, accuracy: 0 },
          'env-issue': { total: 0, correct: 0, accuracy: 0 },
        },
        byConfidence: {
          high: { total: 2, correct: 2, accuracy: 1 },
          medium: { total: 1, correct: 1, accuracy: 1 },
          low: { total: 1, correct: 0, accuracy: 0 },
        },
      },
      withoutSnapshot: {
        variant: 'without-snapshot',
        totalCases: 4,
        correctCount: 1,
        accuracy: 0.25,
        falseConfidenceCount: 2,
        falseConfidenceRate: 0.5,
        byClassification: {
          'real-bug': { total: 2, correct: 0, accuracy: 0 },
          'test-bug': { total: 1, correct: 1, accuracy: 1 },
          flaky: { total: 1, correct: 0, accuracy: 0 },
          'env-issue': { total: 0, correct: 0, accuracy: 0 },
        },
        byConfidence: {
          high: { total: 2, correct: 0, accuracy: 0 },
          medium: { total: 1, correct: 1, accuracy: 1 },
          low: { total: 1, correct: 0, accuracy: 0 },
        },
      },
      delta: { accuracy: 0.5, falseConfidenceRate: -0.5 },
    },
    ...overrides,
  };
}

describe('formatAblationReport', () => {
  // Tracer: every section the issue #8 acceptance criterion names is
  // present in the output. The exact wording can drift — what must
  // not drift is the presence of overall accuracy, false-confidence
  // rate, per-classification breakdown, and per-confidence breakdown.
  it('includes overall accuracy, false-confidence, per-classification, and per-confidence sections', () => {
    const out = formatAblationReport(makeReport());

    // Overall numbers from the headline.
    expect(out).toMatch(/with-snapshot/);
    expect(out).toMatch(/without-snapshot/);
    expect(out).toMatch(/75/); // headline.withSnapshot.accuracy = 0.75 → "75"
    expect(out).toMatch(/25/); // headline.withoutSnapshot.accuracy = 0.25 → "25"

    // Delta is shown explicitly (the moat-contribution number).
    expect(out).toMatch(/\+50/); // delta.accuracy = 0.5 → "+50"

    // Per-classification: every present classification key appears.
    expect(out).toMatch(/real-bug/);
    expect(out).toMatch(/test-bug/);
    expect(out).toMatch(/flaky/);
    expect(out).toMatch(/env-issue/);

    // Per-confidence: every confidence level appears.
    expect(out).toMatch(/high/);
    expect(out).toMatch(/medium/);
    expect(out).toMatch(/low/);
  });

  // Calibration honesty per Principle 2 / ADR-0008: a row with zero
  // cases must NOT render as "0%" — that would look like a 100% failure
  // rate at a glance and the operator could chase a phantom regression.
  // "— (no cases)" makes the absence explicit.
  it('renders empty-bucket rows as "— (no cases)" instead of 0%', () => {
    const out = formatAblationReport(makeReport());

    // env-issue has total=0 in BOTH variants in the fixture above.
    // The line for env-issue must contain the empty marker, not "0%".
    const envLine = out.split('\n').find((l) => l.includes('env-issue')) ?? '';
    expect(envLine).toContain('no cases');
    expect(envLine).not.toMatch(/\b0\.0%/);
  });

  // Calibration is the secondary metric introduced as the case-020
  // remediation (finding_ablation_delta_zero.md 2026-05-22). The
  // formatter renders it as its own section so the operator can find
  // it independently of the headline. When the field is undefined
  // (e.g. legacy baselines, empty case set), the section disappears
  // entirely — no "Calibration: none" stub.
  it('renders a Calibration section when report.calibration is present', () => {
    const out = formatAblationReport(
      makeReport({
        calibration: {
          speculativeHighCount: 1,
          speculativeHighRate: 0.25,
          confidenceBoostCount: 0,
          confidenceBoostRate: 0,
          confidenceMatchCount: 3,
        },
      }),
    );
    expect(out).toMatch(/Calibration/);
    expect(out).toMatch(/speculative-high/i);
    expect(out).toMatch(/25\.0%/);
  });

  it('omits the Calibration section when report.calibration is undefined', () => {
    const out = formatAblationReport(makeReport());
    expect(out).not.toMatch(/Calibration/);
  });
});
