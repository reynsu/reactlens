// Pure helpers for the diagnostic-eval pipeline. Keeping these out of
// eval-runner.test.ts so they can be unit-tested without touching disk or the
// Anthropic API, and reused by the live-API branch and any CLI report wrapper.
import { z } from 'zod';
import type { Diagnosis } from '../runner/events';

const truthSchema = z.object({
  expectedClassification: z.enum(['real-bug', 'test-bug', 'flaky', 'env-issue']),
  minimumConfidence: z.enum(['high', 'medium', 'low']),
  category: z.string().optional(),
  notes: z.string().optional(),
});

export type Truth = z.infer<typeof truthSchema>;

export type CaseResult = {
  name: string;
  expected: Truth;
  actual: Diagnosis;
  correct: boolean;
  // True when the diagnosis is wrong but the agent reported `high` confidence.
  // This is the calibration failure mode Principle 2 forbids: confident wrong
  // beats unconfident wrong, but we only ship if it's vanishingly rare.
  falseConfidence: boolean;
};

export function parseTruth(raw: string): Truth {
  return truthSchema.parse(JSON.parse(raw));
}

export function compareToTruth(actual: Diagnosis, expected: Truth, name: string): CaseResult {
  const correct = actual.classification === expected.expectedClassification;
  return {
    name,
    expected,
    actual,
    correct,
    falseConfidence: !correct && actual.confidence === 'high',
  };
}

export type EvalMetrics = {
  total: number;
  correct: number;
  accuracy: number;
  // Wrong diagnoses delivered with `high` confidence, divided by total. The
  // v0.1.0 DoD caps this implicitly via the >=95% high-confidence accuracy
  // target — surface it explicitly so regressions are obvious in the report.
  falseConfidenceRate: number;
  // Bucketed by expected classification so per-category recall is visible
  // (e.g. "we get real-bug right 90% of the time but flaky only 40%").
  perClassification: Record<Truth['expectedClassification'], { total: number; correct: number }>;
};

export function aggregateMetrics(results: CaseResult[]): EvalMetrics {
  const total = results.length;
  const correct = results.filter((r) => r.correct).length;
  const falseConfident = results.filter((r) => r.falseConfidence).length;
  const perClassification: EvalMetrics['perClassification'] = {
    'real-bug': { total: 0, correct: 0 },
    'test-bug': { total: 0, correct: 0 },
    flaky: { total: 0, correct: 0 },
    'env-issue': { total: 0, correct: 0 },
  };
  for (const r of results) {
    const bucket = perClassification[r.expected.expectedClassification];
    bucket.total += 1;
    if (r.correct) bucket.correct += 1;
  }
  return {
    total,
    correct,
    accuracy: total === 0 ? 0 : correct / total,
    falseConfidenceRate: total === 0 ? 0 : falseConfident / total,
    perClassification,
  };
}
