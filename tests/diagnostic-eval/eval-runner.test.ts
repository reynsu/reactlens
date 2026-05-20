// Eval set runner. Skipped by default unless ANTHROPIC_API_KEY is set —
// the diagnostic agent needs to make API calls. To run:
//   ANTHROPIC_API_KEY=... pnpm test:eval
//
// Each case directory contains:
//   - component.tsx  (the source the spec exercises)
//   - spec.ts        (the failing spec)
//   - truth.json     ({ expectedClassification, minimumConfidence, ... })
//   - error.txt      (optional: the playwright error message)
//   - snapshot.json  (optional: the component snapshot at failure)
//
// We measure: classification accuracy, false-confidence rate (cases where
// confidence==='high' but classification was wrong), and per-category recall.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { canResolveAgent, pickAgentRunner } from '../../src/agent/select';
import {
  aggregateMetrics,
  type CaseResult,
  type Truth,
  parseTruth,
} from '@reynsu/reactlens-diagnosis-prompts';
import { runEvalCase } from '../../src/analyzer/eval-pipeline';
import { createFileCache } from '../../src/eval/ablation-cache';
import { runAblation } from '../../src/eval/ablation-harness';
import { formatAblationReport } from '../../src/eval/ablation-report-formatter';
import { loadEvalCases } from '../../src/eval/eval-case-loader';
import { createProductionDiagnoseFn } from '../../src/eval/production-diagnose-fn';
import { logger } from '../../src/utils/logger';

const CASES_DIR = join(__dirname, 'cases');
// Mirrors the runtime agent-selection precedence: the live block unlocks
// whenever ANY supported backend is reachable — local Claude Code CLI
// (subscription, default) OR ANTHROPIC_API_KEY (per-token API). The previous
// env-var-only check pre-dated the subscription-first refactor (acdbddf) and
// would silently skip the eval when only the CLI was available, masking the
// 16/16 accuracy gate.
//
// Top-level await works at runtime via vitest's vite/esbuild transform but
// tsc rejects it under our NodeNext + CJS module setup (no `"type":"module"`
// in package.json). Suppressed honestly so `pnpm typecheck` stays green.
// @ts-expect-error TLA at module scope: vitest handles it; tsc does not.
const HAS_AGENT = await canResolveAgent();

function loadCase(dir: string): { name: string; dir: string; truth: Truth } | null {
  const truthPath = join(dir, 'truth.json');
  if (!existsSync(truthPath)) return null;
  // parseTruth throws on shape mismatch — any malformed truth.json now fails
  // the smoke test loudly instead of silently surviving as a wrongly-cast
  // value at the assertions below.
  const truth = parseTruth(readFileSync(truthPath, 'utf8'));
  return { name: dir.split('/').pop() ?? '', dir, truth };
}

const allCases = readdirSync(CASES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => loadCase(join(CASES_DIR, d.name)))
  .filter((c): c is NonNullable<typeof c> => c !== null);

// Without these alongside truth.json, the live-API runner has nothing to feed
// the diagnosis agent and the smoke test would silently green-light a case
// that contributes zero signal to calibration — the exact false-confidence
// Principle 2 forbids.
const REQUIRED_INPUTS = ['component.tsx', 'spec.ts'] as const;

describe('diagnostic eval (smoke)', () => {
  it('every case has a truth.json with required fields', () => {
    expect(allCases.length).toBeGreaterThan(0);
    for (const c of allCases) {
      expect(c.truth.expectedClassification).toMatch(/^(real-bug|test-bug|flaky|env-issue)$/);
      expect(c.truth.minimumConfidence).toMatch(/^(high|medium|low)$/);
    }
  });

  it.each(allCases.map((c) => [c.name, c.dir]))(
    'case %s has all required input files',
    (_name, dir) => {
      for (const f of REQUIRED_INPUTS) {
        expect(existsSync(join(dir, f)), `${f} missing in ${dir}`).toBe(true);
      }
    },
  );
});

// Live API runner — only when ANTHROPIC_API_KEY (or REACTLENS_USE_CLAUDE_CODE=1)
// is set. Each case is its own `it.each` test so the operator can dry-run a
// single case with `vitest -t "case-001"`, per-case timeouts apply, and a
// stalled case never aborts the whole sweep. The afterAll hook reports the
// aggregate accuracy across whatever cases actually ran.
describe.skipIf(!HAS_AGENT)('diagnostic eval (with API)', () => {
  const liveResults: CaseResult[] = [];

  it.each(allCases.map((c) => [c.name, c.dir] as const))(
    'diagnoses %s',
    async (_name, dir) => {
      const agent = await pickAgentRunner({ commandName: 'eval' });
      const result = await runEvalCase({ caseDir: dir, agent });
      liveResults.push(result);
      logger.info(
        {
          case: result.name,
          expected: result.expected.expectedClassification,
          actual: result.actual.classification,
          confidence: result.actual.confidence,
          correct: result.correct,
          falseConfidence: result.falseConfidence,
        },
        'eval case complete',
      );
      expect(result.actual.classification).toMatch(/^(real-bug|test-bug|flaky|env-issue)$/);
    },
    // Per-case timeout. Cold-cache claude CLI runs can spike to ~5 min when
    // the agent does several Read/Grep tool calls before classifying.
    10 * 60 * 1000,
  );

  afterAll(() => {
    if (liveResults.length === 0) return;
    const metrics = aggregateMetrics(liveResults);
    logger.info({ metrics, ran: liveResults.length, total: allCases.length }, 'diagnostic eval summary');

    // DoD #5 thresholds: accuracy >= 80%, false-confidence rate <= 5%.
    // Only asserted when REACTLENS_EVAL_THRESHOLDS=1 is set AND the full
    // case set ran (a `-t` filter that runs a subset can't be evaluated
    // against these aggregate targets). The CI gate workflow sets the env var;
    // local dev runs still produce the summary log without failing.
    if (process.env.REACTLENS_EVAL_THRESHOLDS !== '1') return;
    if (liveResults.length < allCases.length) {
      throw new Error(
        `REACTLENS_EVAL_THRESHOLDS=1 requires the full case set; only ${liveResults.length}/${allCases.length} ran. Remove the test filter or unset the env var.`,
      );
    }
    expect(metrics.accuracy, 'eval accuracy must meet DoD #5 (>=80%)').toBeGreaterThanOrEqual(0.8);
    expect(metrics.falseConfidenceRate, 'high-confidence accuracy must meet DoD #5 (<=5% false confidence)').toBeLessThanOrEqual(0.05);
  });
});

// Ablation block — separately env-gated from the eval gate above so a
// developer can run the standard accuracy sweep without paying for the
// extra without-snapshot leg (and vice versa). REACTLENS_ABLATION=1
// unlocks the block; REACTLENS_ABLATION_UPDATE_BASELINE=1 additionally
// rewrites the on-disk baseline (used once per intentional moat-
// contribution recalibration, then NEVER in CI — slice #14 compares
// against the checked-in baseline).
//
// The without-snapshot leg requires PR-B upstream (markers in
// @reynsu/reactlens-diagnosis-prompts) before it can actually run end-
// to-end. Until that ships, the block throws AblationMarkersMissingError
// loudly — the calibration-leak Principle 2 forbids would be the silent
// alternative.
const ABLATION = process.env.REACTLENS_ABLATION === '1';
const ABLATION_UPDATE_BASELINE = process.env.REACTLENS_ABLATION_UPDATE_BASELINE === '1';
const ABLATION_BASELINE_PATH = join(__dirname, 'ablation-baseline.json');
const ABLATION_CACHE_ROOT = join(__dirname, '..', '..', '.reactlens', 'eval-cache');

describe.skipIf(!ABLATION || !HAS_AGENT)('diagnostic ablation (with API)', () => {
  it('runs both variants and prints the AblationReport', async () => {
    const agent = await pickAgentRunner({ commandName: 'eval' });
    const cases = loadEvalCases(CASES_DIR);
    const cwd = join(__dirname, '..', '..');
    const diagnoseFn = createProductionDiagnoseFn({ agent, cwd });
    const cache = createFileCache({ root: ABLATION_CACHE_ROOT });

    const report = await runAblation({ cases, diagnoseFn, cache });

    // Print the report on stdout. console.log (not logger.info) because
    // the issue #8 acceptance criterion specifies STDOUT; logger writes
    // through pino's JSON pipeline which the operator can't read at a
    // glance.
    console.log(formatAblationReport(report));

    if (ABLATION_UPDATE_BASELINE) {
      writeFileSync(ABLATION_BASELINE_PATH, JSON.stringify(report, null, 2));
      logger.info({ path: ABLATION_BASELINE_PATH }, 'ablation baseline updated');
    }

    // Smoke assertion — the block ran end-to-end and produced a
    // populated headline. The CI-gate threshold check lives in slice
    // #14, not here.
    expect(report.headline.withSnapshot.totalCases).toBeGreaterThan(0);
  }, 60 * 60 * 1000);
});
