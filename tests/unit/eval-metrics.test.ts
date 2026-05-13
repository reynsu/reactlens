import { describe, expect, it } from 'vitest';
import {
  aggregateMetrics,
  compareToTruth,
  parseTruth,
  type Truth,
} from '../../src/analyzer/eval-metrics';
import type { Diagnosis } from '../../src/runner/events';

function makeDiagnosis(overrides: Partial<Diagnosis> = {}): Diagnosis {
  return {
    classification: 'real-bug',
    confidence: 'high',
    rootCause: 'stub',
    evidence: [],
    suggestedFix: 'stub',
    ...overrides,
  };
}

describe('parseTruth', () => {
  it('returns a typed Truth for a well-formed payload', () => {
    const raw = JSON.stringify({
      expectedClassification: 'real-bug',
      minimumConfidence: 'high',
      category: 'validation-regression',
    });
    const t = parseTruth(raw);
    expect(t.expectedClassification).toBe('real-bug');
    expect(t.minimumConfidence).toBe('high');
    expect(t.category).toBe('validation-regression');
  });

  it('throws on an unknown expectedClassification', () => {
    const raw = JSON.stringify({
      expectedClassification: 'totally-bogus',
      minimumConfidence: 'high',
    });
    expect(() => parseTruth(raw)).toThrow();
  });

  it('throws when minimumConfidence is missing', () => {
    const raw = JSON.stringify({ expectedClassification: 'real-bug' });
    expect(() => parseTruth(raw)).toThrow();
  });
});

describe('compareToTruth', () => {
  it('marks correct=true when classification matches', () => {
    const truth = parseTruth(
      JSON.stringify({ expectedClassification: 'real-bug', minimumConfidence: 'high' }),
    );
    const diagnosis = makeDiagnosis({ classification: 'real-bug', confidence: 'high' });
    const result = compareToTruth(diagnosis, truth, 'case-x');
    expect(result.correct).toBe(true);
    expect(result.name).toBe('case-x');
  });

  it('flags falseConfidence when a high-confidence diagnosis is wrong', () => {
    const truth = parseTruth(
      JSON.stringify({ expectedClassification: 'real-bug', minimumConfidence: 'high' }),
    );
    const diagnosis = makeDiagnosis({ classification: 'test-bug', confidence: 'high' });
    const result = compareToTruth(diagnosis, truth, 'case-x');
    expect(result.correct).toBe(false);
    expect(result.falseConfidence).toBe(true);
  });

  it('does not flag falseConfidence when low-confidence diagnosis is wrong', () => {
    const truth = parseTruth(
      JSON.stringify({ expectedClassification: 'real-bug', minimumConfidence: 'high' }),
    );
    const diagnosis = makeDiagnosis({ classification: 'flaky', confidence: 'low' });
    const result = compareToTruth(diagnosis, truth, 'case-x');
    expect(result.correct).toBe(false);
    expect(result.falseConfidence).toBe(false);
  });

  it('does not flag falseConfidence when high-confidence is also correct', () => {
    const truth = parseTruth(
      JSON.stringify({ expectedClassification: 'real-bug', minimumConfidence: 'high' }),
    );
    const diagnosis = makeDiagnosis({ classification: 'real-bug', confidence: 'high' });
    const result = compareToTruth(diagnosis, truth, 'case-x');
    expect(result.falseConfidence).toBe(false);
  });
});

describe('aggregateMetrics', () => {
  function caseFor(name: string, expected: Truth['expectedClassification'], actual: Diagnosis['classification']): ReturnType<typeof compareToTruth> {
    const truth = parseTruth(
      JSON.stringify({ expectedClassification: expected, minimumConfidence: 'high' }),
    );
    return compareToTruth(makeDiagnosis({ classification: actual, confidence: 'high' }), truth, name);
  }

  it('reports total, correct, and accuracy for a mixed result set', () => {
    const results = [
      caseFor('a', 'real-bug', 'real-bug'),
      caseFor('b', 'test-bug', 'test-bug'),
      caseFor('c', 'real-bug', 'flaky'),
      caseFor('d', 'flaky', 'flaky'),
    ];
    const m = aggregateMetrics(results);
    expect(m.total).toBe(4);
    expect(m.correct).toBe(3);
    expect(m.accuracy).toBeCloseTo(0.75);
  });

  it('returns accuracy=0 for an empty result set without dividing by zero', () => {
    const m = aggregateMetrics([]);
    expect(m.total).toBe(0);
    expect(m.correct).toBe(0);
    expect(m.accuracy).toBe(0);
  });

  it('reports falseConfidenceRate as wrong-high-confidence / total', () => {
    const truthHigh = parseTruth(
      JSON.stringify({ expectedClassification: 'real-bug', minimumConfidence: 'high' }),
    );
    const results = [
      compareToTruth(makeDiagnosis({ classification: 'test-bug', confidence: 'high' }), truthHigh, 'a'),
      compareToTruth(makeDiagnosis({ classification: 'real-bug', confidence: 'high' }), truthHigh, 'b'),
      compareToTruth(makeDiagnosis({ classification: 'flaky', confidence: 'low' }), truthHigh, 'c'),
      compareToTruth(makeDiagnosis({ classification: 'real-bug', confidence: 'medium' }), truthHigh, 'd'),
    ];
    const m = aggregateMetrics(results);
    expect(m.falseConfidenceRate).toBeCloseTo(0.25);
  });

  it('reports accuracy per expectedClassification bucket', () => {
    const realBugTruth = parseTruth(
      JSON.stringify({ expectedClassification: 'real-bug', minimumConfidence: 'high' }),
    );
    const testBugTruth = parseTruth(
      JSON.stringify({ expectedClassification: 'test-bug', minimumConfidence: 'high' }),
    );
    const results = [
      compareToTruth(makeDiagnosis({ classification: 'real-bug' }), realBugTruth, 'a'),
      compareToTruth(makeDiagnosis({ classification: 'real-bug' }), realBugTruth, 'b'),
      compareToTruth(makeDiagnosis({ classification: 'flaky' }), realBugTruth, 'c'),
      compareToTruth(makeDiagnosis({ classification: 'test-bug' }), testBugTruth, 'd'),
    ];
    const m = aggregateMetrics(results);
    expect(m.perClassification['real-bug']).toEqual({ total: 3, correct: 2 });
    expect(m.perClassification['test-bug']).toEqual({ total: 1, correct: 1 });
  });
});
