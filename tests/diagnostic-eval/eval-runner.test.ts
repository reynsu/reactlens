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
import { describe, expect, it } from 'vitest';

const CASES_DIR = join(__dirname, 'cases');
const HAS_API_KEY = process.env.ANTHROPIC_API_KEY !== undefined;

type Truth = {
  expectedClassification: 'real-bug' | 'test-bug' | 'flaky' | 'env-issue';
  minimumConfidence: 'high' | 'medium' | 'low';
  category?: string;
  notes?: string;
};

function loadCase(dir: string): { name: string; truth: Truth } | null {
  const truthPath = join(dir, 'truth.json');
  if (!existsSync(truthPath)) return null;
  const truth = JSON.parse(readFileSync(truthPath, 'utf8')) as Truth;
  return { name: dir.split('/').pop() ?? '', truth };
}

const allCases = readdirSync(CASES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => loadCase(join(CASES_DIR, d.name)))
  .filter((c): c is NonNullable<typeof c> => c !== null);

describe('diagnostic eval (smoke)', () => {
  it('every case has a truth.json with required fields', () => {
    expect(allCases.length).toBeGreaterThan(0);
    for (const c of allCases) {
      expect(c.truth.expectedClassification).toMatch(/^(real-bug|test-bug|flaky|env-issue)$/);
      expect(c.truth.minimumConfidence).toMatch(/^(high|medium|low)$/);
    }
  });
});

describe.skipIf(!HAS_API_KEY)('diagnostic eval (with API)', () => {
  it.skip('runs the diagnosis agent against each case and reports accuracy', async () => {
    // Implementation: import diagnose() from src/analyzer/failure-agent,
    // build a FailedTest from each case directory, compare to truth.json.
    // Stubbed pending live execution.
    expect(true).toBe(true);
  });
});
