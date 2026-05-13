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
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { pickAgentRunner } from '../../src/agent/select';
import {
  aggregateMetrics,
  type CaseResult,
  type Truth,
  parseTruth,
} from '../../src/analyzer/eval-metrics';
import { runEvalCase } from '../../src/analyzer/eval-pipeline';
import { logger } from '../../src/utils/logger';

const CASES_DIR = join(__dirname, 'cases');
// Live path runs through whichever agent backend the operator opted into:
// ANTHROPIC_API_KEY (token-billed via SDK) or REACTLENS_USE_CLAUDE_CODE=1
// (Max-billed via local claude CLI). Either unlocks the live block.
const HAS_AGENT =
  process.env.ANTHROPIC_API_KEY !== undefined ||
  process.env.REACTLENS_USE_CLAUDE_CODE === '1';

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
    // No threshold assertions yet — DoD #5 thresholds (>=80% / >=95% on high)
    // belong in the CI gate (plan §7.7) and require the full set to have run.
  });
});
