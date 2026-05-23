// TDD for the AblationHarness deep module — issue #8 behaviors #10-18.
// The harness loops over (case, variant) tuples and aggregates the
// resulting Diagnoses into the AblationReport that drives the moat-
// contribution delta from ADR-0001.
//
// Post-#46: the harness owns the agent invocation directly via
// DiagnosisRun's `ablation` intent. Tests stub at the AgentRunner level
// — each `query()` call returns a scripted JSON Diagnosis chosen by the
// case-name and variant the harness is currently running. The variant
// is recovered from the prompt by checking for the `<!-- ablation:
// snapshot-start -->` markers (present iff variant === 'with-snapshot').
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Diagnosis } from '@reynsu/reactlens-diagnosis-prompts';
import type {
  AgentMessage,
  AgentQueryOptions,
  AgentRunner,
} from '../../src/agent/runner';
import type { AblationVariant } from '../../src/eval/ablation-variant-generator';
import { loadEvalCases } from '../../src/eval/eval-case-loader';
import { type AblationCache, runAblation } from '../../src/eval/ablation-harness';

// `makeCuratedCase` now writes a synthetic snapshot.json alongside the
// component/spec. The snapshot is what causes buildUserMessage to emit
// the `<!-- ablation:snapshot-start -->` markers — without them the
// without-snapshot Variant transform throws AblationMarkersMissingError,
// which is correct production behavior but blocks the harness unit
// tests from exercising the without-snapshot leg.
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
  writeFileSync(
    join(dir, 'snapshot.json'),
    JSON.stringify({ name: 'C', props: {}, children: [] }),
  );
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

// Helper that takes the same `{name → Diagnosis}` or `{name → (variant) → Diagnosis}`
// shape the pre-#46 tests passed to `DiagnoseFn` and turns it into a
// FakeAgentRunner. The agent infers (caseName, variant) from the prompt
// content the DiagnosisRun's prepare-ablation step produces:
//   - caseName lives in the prompt as `Test: <name>` (buildUserMessage).
//   - variant is 'with-snapshot' iff the snapshot markers are present.
type Script = Record<string, Diagnosis | ((variant: AblationVariant) => Diagnosis)>;

function scriptedAgent(replies: Script): AgentRunner & {
  calls: Array<{ caseName: string; variant: AblationVariant }>;
} {
  const calls: Array<{ caseName: string; variant: AblationVariant }> = [];
  const agent: AgentRunner = {
    query(opts: AgentQueryOptions): AsyncIterable<AgentMessage> {
      const variant: AblationVariant = opts.prompt.includes('<!-- ablation:snapshot-start -->')
        ? 'with-snapshot'
        : 'without-snapshot';
      let matchedName: string | undefined;
      for (const name of Object.keys(replies)) {
        if (opts.prompt.includes(`Test: ${name}`)) {
          matchedName = name;
          break;
        }
      }
      if (matchedName === undefined) {
        throw new Error(`scriptedAgent: no case-name in prompt matched the script. Prompt preview: ${opts.prompt.slice(0, 200)}`);
      }
      calls.push({ caseName: matchedName, variant });
      const replyOrFn = replies[matchedName];
      if (replyOrFn === undefined) throw new Error(`scriptedAgent: missing reply for ${matchedName}`);
      const reply = typeof replyOrFn === 'function' ? replyOrFn(variant) : replyOrFn;
      const text = JSON.stringify(reply);
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'assistant', message: { content: [{ type: 'text', text }] } } as AgentMessage;
          yield { type: 'result', subtype: 'success' } as AgentMessage;
        },
      };
    },
  };
  return Object.assign(agent, { calls });
}

describe('runAblation', () => {
  it('runs each case through both variants and returns per-variant accuracy', async () => {
    const casesDir = mkdtempSync(join(tmpdir(), 'reactlens-ablation-'));
    makeCuratedCase(casesDir, 'case-001-stale-selector', {
      expectedClassification: 'test-bug',
      minimumConfidence: 'medium',
    });
    const cases = loadEvalCases(casesDir);

    const agent = scriptedAgent({ 'case-001-stale-selector': () => makeDiagnosis() });

    const report = await runAblation({ cases, agent });

    expect(report.headline.withSnapshot.totalCases).toBe(1);
    expect(report.headline.withSnapshot.correctCount).toBe(1);
    expect(report.headline.withSnapshot.accuracy).toBe(1);
    expect(report.headline.withoutSnapshot.totalCases).toBe(1);
    expect(report.headline.withoutSnapshot.correctCount).toBe(1);
    expect(report.headline.withoutSnapshot.accuracy).toBe(1);
  });

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

    const agent = scriptedAgent({
      'case-001-real-bug': () => makeDiagnosis({ classification: 'real-bug', confidence: 'high' }),
      'case-002-test-bug': () => makeDiagnosis({ classification: 'real-bug', confidence: 'high' }),
      'case-003-flaky': () => makeDiagnosis({ classification: 'test-bug', confidence: 'low' }),
    });

    const report = await runAblation({ cases, agent });

    expect(report.headline.withSnapshot.totalCases).toBe(3);
    expect(report.headline.withSnapshot.correctCount).toBe(1);
    expect(report.headline.withSnapshot.accuracy).toBeCloseTo(1 / 3);
    expect(report.headline.withSnapshot.falseConfidenceCount).toBe(1);
    expect(report.headline.withSnapshot.falseConfidenceRate).toBeCloseTo(1 / 3);
    expect(report.headline.withoutSnapshot.accuracy).toBeCloseTo(1 / 3);
    expect(report.headline.withoutSnapshot.falseConfidenceCount).toBe(1);
  });

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

    const agent = scriptedAgent({
      'case-001-only-snapshot-helps': (variant) =>
        variant === 'with-snapshot'
          ? makeDiagnosis({ classification: 'real-bug', confidence: 'high' })
          : makeDiagnosis({ classification: 'flaky', confidence: 'high' }),
      'case-002-both-correct': () => makeDiagnosis({ classification: 'test-bug', confidence: 'high' }),
    });

    const report = await runAblation({ cases, agent });

    expect(report.headline.withSnapshot.accuracy).toBe(1);
    expect(report.headline.withoutSnapshot.accuracy).toBe(0.5);
    expect(report.headline.delta.accuracy).toBeCloseTo(0.5);
    expect(report.headline.delta.falseConfidenceRate).toBeCloseTo(-0.5);
  });

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
    const harvestRoot = join(casesDir, 'synthetic-from-corpus', 'some-repo');
    mkdirSync(harvestRoot, { recursive: true });
    makeCuratedCase(harvestRoot, 'case-001-uncurated-wrong', {
      expectedClassification: 'flaky',
      minimumConfidence: 'low',
    });
    const cases = loadEvalCases(casesDir);

    const agent = scriptedAgent({
      'case-001-curated-correct': () => makeDiagnosis({ classification: 'real-bug', confidence: 'high' }),
      'case-002-curated-wrong': () => makeDiagnosis({ classification: 'real-bug', confidence: 'high' }),
      'case-001-uncurated-wrong': () => makeDiagnosis({ classification: 'real-bug', confidence: 'high' }),
    });

    const report = await runAblation({ cases, agent });

    expect(report.headline.withSnapshot.totalCases).toBe(2);
    expect(report.headline.withSnapshot.correctCount).toBe(1);
    expect(report.headline.withSnapshot.accuracy).toBe(0.5);
    expect(report.uncurated?.withSnapshot.totalCases).toBe(1);
    expect(report.uncurated?.withSnapshot.correctCount).toBe(0);
    expect(report.uncurated?.withSnapshot.accuracy).toBe(0);
  });

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

    const agent = scriptedAgent({
      'case-01-real-bug-a': () => makeDiagnosis({ classification: 'real-bug', confidence: 'high' }),
      'case-02-real-bug-b': () => makeDiagnosis({ classification: 'test-bug', confidence: 'high' }),
      'case-03-test-bug': () => makeDiagnosis({ classification: 'test-bug', confidence: 'high' }),
      'case-04-flaky': () => makeDiagnosis({ classification: 'flaky', confidence: 'medium' }),
    });

    const report = await runAblation({ cases, agent });
    const ws = report.headline.withSnapshot;

    expect(ws.byClassification['real-bug']).toMatchObject({ total: 2, correct: 1, accuracy: 0.5 });
    expect(ws.byClassification['test-bug']).toMatchObject({ total: 1, correct: 1, accuracy: 1 });
    expect(ws.byClassification.flaky).toMatchObject({ total: 1, correct: 1, accuracy: 1 });
    expect(ws.byClassification['env-issue']).toMatchObject({ total: 0, correct: 0, accuracy: 0 });
  });

  it('reports accuracy broken down by emitted confidence', async () => {
    const casesDir = mkdtempSync(join(tmpdir(), 'reactlens-ablation-'));
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

    const agent = scriptedAgent({
      'case-01-high-correct': () => makeDiagnosis({ classification: 'real-bug', confidence: 'high' }),
      'case-02-high-wrong': () => makeDiagnosis({ classification: 'test-bug', confidence: 'high' }),
      'case-03-medium-correct': () => makeDiagnosis({ classification: 'real-bug', confidence: 'medium' }),
      'case-04-low-correct': () => makeDiagnosis({ classification: 'real-bug', confidence: 'low' }),
    });

    const report = await runAblation({ cases, agent });
    const ws = report.headline.withSnapshot;

    expect(ws.byConfidence.high).toMatchObject({ total: 2, correct: 1, accuracy: 0.5 });
    expect(ws.byConfidence.medium).toMatchObject({ total: 1, correct: 1, accuracy: 1 });
    expect(ws.byConfidence.low).toMatchObject({ total: 1, correct: 1, accuracy: 1 });
  });

  it('uses cache when (case, variant) is already cached', async () => {
    const casesDir = mkdtempSync(join(tmpdir(), 'reactlens-ablation-'));
    makeCuratedCase(casesDir, 'case-cached', {
      expectedClassification: 'real-bug',
      minimumConfidence: 'high',
    });
    const cases = loadEvalCases(casesDir);

    const cachedDiagnosis = makeDiagnosis({ classification: 'real-bug', confidence: 'high' });
    const freshDiagnosis = makeDiagnosis({ classification: 'test-bug', confidence: 'high' });

    const agent = scriptedAgent({ 'case-cached': () => freshDiagnosis });
    const cache: AblationCache = {
      get: async ({ variant }) => (variant === 'with-snapshot' ? cachedDiagnosis : undefined),
      set: async () => {
        /* unused for this behavior */
      },
    };

    const report = await runAblation({ cases, agent, cache });

    // Agent invoked only for the without-snapshot variant — with-snapshot
    // was served from cache, which skips the agent and prepare-ablation
    // entirely.
    expect(agent.calls).toHaveLength(1);
    expect(agent.calls[0]?.variant).toBe('without-snapshot');
    expect(report.headline.withSnapshot.correctCount).toBe(1);
    expect(report.headline.withSnapshot.accuracy).toBe(1);
    expect(report.headline.withoutSnapshot.correctCount).toBe(0);
  });

  it('writes fresh diagnoses back to the cache on miss', async () => {
    const casesDir = mkdtempSync(join(tmpdir(), 'reactlens-ablation-'));
    makeCuratedCase(casesDir, 'case-fresh', {
      expectedClassification: 'real-bug',
      minimumConfidence: 'high',
    });
    const cases = loadEvalCases(casesDir);

    const freshDiagnosis = makeDiagnosis({ classification: 'real-bug', confidence: 'high' });
    const agent = scriptedAgent({ 'case-fresh': () => freshDiagnosis });

    const writes: Array<{ caseName: string; variant: string; diagnosis: Diagnosis }> = [];
    const cache: AblationCache = {
      get: async () => undefined,
      set: async ({ case: c, variant, diagnosis }) => {
        writes.push({ caseName: c.name, variant, diagnosis });
      },
    };

    await runAblation({ cases, agent, cache });

    expect(writes).toHaveLength(2);
    expect(writes.map((w) => w.variant).sort()).toEqual(['with-snapshot', 'without-snapshot']);
    // The cached diagnosis matches the fresh one structurally — value
    // equality (not reference) because the JSON round-trip through the
    // agent doesn't preserve identity.
    expect(writes[0]?.diagnosis).toEqual(freshDiagnosis);
    expect(writes[1]?.diagnosis).toEqual(freshDiagnosis);
    expect(writes.every((w) => w.caseName === 'case-fresh')).toBe(true);
  });
});

describe('runAblation calibration', () => {
  it('counts a speculative-high case when without-snapshot is high and with-snapshot is medium', async () => {
    const casesDir = mkdtempSync(join(tmpdir(), 'reactlens-ablation-cal-'));
    makeCuratedCase(casesDir, 'case-001-real-bug', {
      expectedClassification: 'real-bug',
      minimumConfidence: 'low',
    });
    const cases = loadEvalCases(casesDir);

    const agent = scriptedAgent({
      'case-001-real-bug': (variant) =>
        makeDiagnosis({
          classification: 'real-bug',
          confidence: variant === 'with-snapshot' ? 'medium' : 'high',
        }),
    });

    const report = await runAblation({ cases, agent });

    expect(report.calibration?.speculativeHighCount).toBe(1);
    expect(report.calibration?.speculativeHighRate).toBe(1);
  });

  it('counts a confidence-boost case when with-snapshot is high and without-snapshot is medium', async () => {
    const casesDir = mkdtempSync(join(tmpdir(), 'reactlens-ablation-cal-'));
    makeCuratedCase(casesDir, 'case-001-real-bug', {
      expectedClassification: 'real-bug',
      minimumConfidence: 'low',
    });
    const cases = loadEvalCases(casesDir);

    const agent = scriptedAgent({
      'case-001-real-bug': (variant) =>
        makeDiagnosis({
          classification: 'real-bug',
          confidence: variant === 'with-snapshot' ? 'high' : 'medium',
        }),
    });

    const report = await runAblation({ cases, agent });

    expect(report.calibration?.confidenceBoostCount).toBe(1);
    expect(report.calibration?.confidenceBoostRate).toBe(1);
  });

  it('counts a confidence-match case when both variants emit the same confidence', async () => {
    const casesDir = mkdtempSync(join(tmpdir(), 'reactlens-ablation-cal-'));
    makeCuratedCase(casesDir, 'case-001-real-bug', {
      expectedClassification: 'real-bug',
      minimumConfidence: 'low',
    });
    const cases = loadEvalCases(casesDir);

    const agent = scriptedAgent({
      'case-001-real-bug': () => makeDiagnosis({ classification: 'real-bug', confidence: 'high' }),
    });

    const report = await runAblation({ cases, agent });

    expect(report.calibration?.confidenceMatchCount).toBe(1);
    expect(report.calibration?.speculativeHighCount).toBe(0);
    expect(report.calibration?.confidenceBoostCount).toBe(0);
  });

  it('counts confidence shift regardless of whether classifications agree', async () => {
    const casesDir = mkdtempSync(join(tmpdir(), 'reactlens-ablation-cal-'));
    makeCuratedCase(casesDir, 'case-001-real-bug', {
      expectedClassification: 'real-bug',
      minimumConfidence: 'low',
    });
    const cases = loadEvalCases(casesDir);

    const agent = scriptedAgent({
      'case-001-real-bug': (variant) =>
        variant === 'with-snapshot'
          ? makeDiagnosis({ classification: 'real-bug', confidence: 'medium' })
          : makeDiagnosis({ classification: 'test-bug', confidence: 'high' }),
    });

    const report = await runAblation({ cases, agent });

    expect(report.calibration?.speculativeHighCount).toBe(1);
  });

  it('computes rates as count divided by paired-case count', async () => {
    const casesDir = mkdtempSync(join(tmpdir(), 'reactlens-ablation-cal-'));
    makeCuratedCase(casesDir, 'case-001-spec-high', {
      expectedClassification: 'real-bug',
      minimumConfidence: 'low',
    });
    makeCuratedCase(casesDir, 'case-002-match', {
      expectedClassification: 'real-bug',
      minimumConfidence: 'low',
    });
    makeCuratedCase(casesDir, 'case-003-match', {
      expectedClassification: 'real-bug',
      minimumConfidence: 'low',
    });
    const cases = loadEvalCases(casesDir);

    const agent = scriptedAgent({
      'case-001-spec-high': (variant) =>
        makeDiagnosis({
          classification: 'real-bug',
          confidence: variant === 'with-snapshot' ? 'medium' : 'high',
        }),
      'case-002-match': () => makeDiagnosis({ classification: 'real-bug', confidence: 'high' }),
      'case-003-match': () => makeDiagnosis({ classification: 'real-bug', confidence: 'high' }),
    });

    const report = await runAblation({ cases, agent });

    expect(report.calibration?.speculativeHighCount).toBe(1);
    expect(report.calibration?.speculativeHighRate).toBeCloseTo(1 / 3);
    expect(report.calibration?.confidenceMatchCount).toBe(2);
    expect(report.calibration?.confidenceBoostCount).toBe(0);
  });

  it('omits calibration when no curated cases ran', async () => {
    const agent = scriptedAgent({});
    const report = await runAblation({ cases: [], agent });
    expect(report.calibration).toBeUndefined();
  });
});
