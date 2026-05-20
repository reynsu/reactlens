// Integration test for `reactlens eval add-from-last-failure` (slice #15).
//
// Exercises the command function end-to-end (CLI action → orchestrator
// → emitter) against a hand-built `.reactlens/runs/<id>/` fixture that
// mimics what a real reactlens run against vite-react-router would
// produce. NOT a CLI-subprocess test — the built dist has a separate
// CJS/ESM compatibility issue with @reynsu/reactlens-diagnosis-prompts
// (out-of-scope for this slice); calling the command function directly
// goes through vitest's ESM-friendly transform and exercises every
// layer this slice owns.
//
// Three integration scenarios match the three DogfoodResult kinds
// each surfacing as a distinct exit code from runEvalAddFromLastFailure:
//
//   ok          → exit 0, case dir lands under synthetic-from-corpus/dogfood/
//   no-runs     → exit 3
//   no-failure  → exit 4
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runEvalAddFromLastFailure } from '../../src/commands/eval-add-from-last-failure';

function freshRepo(): string {
  return mkdtempSync(join(tmpdir(), 'reactlens-eval-add-int-'));
}

function jsonl(...events: object[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

function firstCaseDir(dogfoodRoot: string): string {
  const cases = readdirSync(dogfoodRoot).filter((n) => n.startsWith('case-'));
  const first = cases[0];
  if (first === undefined) throw new Error(`no case- dir found under ${dogfoodRoot}`);
  return join(dogfoodRoot, first);
}

// Seed a realistic vite-react-router-shaped run: source files in
// src/, spec in tests/, events.jsonl with a real failing test that
// references both. The component snapshot carries a source mapping so
// the orchestrator can copy the component verbatim.
function seedVRRStyleFixture(repoRoot: string): { runId: string; testTitle: string } {
  const runId = '2026-05-20T22-00-00Z-abcdef01';
  const componentPath = join(repoRoot, 'src', 'pages', 'CheckoutPage.tsx');
  const specPath = join(repoRoot, 'e2e', 'checkout.spec.ts');
  mkdirSync(join(repoRoot, 'src', 'pages'), { recursive: true });
  mkdirSync(join(repoRoot, 'e2e'), { recursive: true });
  writeFileSync(
    componentPath,
    'export function CheckoutPage(): JSX.Element {\n  return <div>broken checkout</div>;\n}\n',
  );
  writeFileSync(
    specPath,
    "import { expect, test } from '@playwright/test';\n\ntest('checkout succeeds', async ({ page }) => {\n  await page.goto('/checkout');\n  await expect(page.getByTestId('success')).toBeVisible();\n});\n",
  );

  const eventsDir = join(repoRoot, '.reactlens', 'runs', runId);
  mkdirSync(eventsDir, { recursive: true });
  writeFileSync(
    join(eventsDir, 'events.jsonl'),
    jsonl(
      { t: 'run:start', runId, totalTests: 1, timestamp: 1747789200000 },
      {
        t: 'test:start',
        id: 'checkout-t1',
        title: 'checkout succeeds',
        file: specPath,
        suite: 'checkout',
      },
      {
        t: 'component:snapshot',
        testId: 'checkout-t1',
        stepId: 's1',
        tree: {
          name: 'CheckoutPage',
          props: {},
          children: [],
          hooks: [{ kind: 'state', value: false, name: 'submitted' }],
          source: { file: componentPath, line: 1 },
        },
      },
      {
        t: 'test:end',
        id: 'checkout-t1',
        status: 'failed',
        duration: 3400,
        error: 'Timed out 5000ms waiting for [data-testid="success"]',
      },
      { t: 'run:end', passed: 0, failed: 1, skipped: 0, duration: 4600 },
    ),
  );

  return { runId, testTitle: 'checkout succeeds' };
}

describe('runEvalAddFromLastFailure — kind=ok integration', () => {
  it('exits 0 and emits the case dir under synthetic-from-corpus/dogfood/', async () => {
    const repoRoot = freshRepo();
    seedVRRStyleFixture(repoRoot);
    const exitCode = await runEvalAddFromLastFailure({ cwd: repoRoot });
    expect(exitCode).toBe(0);
    const dogfoodRoot = join(repoRoot, 'tests', 'diagnostic-eval', 'cases', 'synthetic-from-corpus', 'dogfood');
    expect(existsSync(dogfoodRoot)).toBe(true);
  });

  it('emitted case dir has all four standard files', async () => {
    const repoRoot = freshRepo();
    seedVRRStyleFixture(repoRoot);
    await runEvalAddFromLastFailure({ cwd: repoRoot });
    const dogfoodRoot = join(repoRoot, 'tests', 'diagnostic-eval', 'cases', 'synthetic-from-corpus', 'dogfood');
    const caseDir = firstCaseDir(dogfoodRoot);
    for (const f of ['component.tsx', 'spec.ts', 'manifest.json', 'truth.json']) {
      expect(existsSync(join(caseDir, f)), `${f} missing in ${caseDir}`).toBe(true);
    }
  });

  it('manifest records sourceMode=dogfood + the discoveredFailure attributing to checkout-t1', async () => {
    const repoRoot = freshRepo();
    const seeded = seedVRRStyleFixture(repoRoot);
    await runEvalAddFromLastFailure({ cwd: repoRoot });

    const dogfoodRoot = join(repoRoot, 'tests', 'diagnostic-eval', 'cases', 'synthetic-from-corpus', 'dogfood');
    const manifest = JSON.parse(readFileSync(join(firstCaseDir(dogfoodRoot), 'manifest.json'), 'utf8'));
    expect(manifest.sourceMode).toBe('dogfood');
    expect(manifest.discoveredFailure?.testId).toBe('checkout-t1');
    expect(manifest.discoveredFailure?.testTitle).toBe(seeded.testTitle);
    expect(manifest.discoveredFailure?.sourceRunId).toBe(seeded.runId);
    expect(manifest.discoveredFailure?.errorMessage).toMatch(/Timed out 5000ms/);
  });

  it('component.tsx is the source the snapshot pointed at (NOT a placeholder)', async () => {
    const repoRoot = freshRepo();
    seedVRRStyleFixture(repoRoot);
    await runEvalAddFromLastFailure({ cwd: repoRoot });

    const dogfoodRoot = join(repoRoot, 'tests', 'diagnostic-eval', 'cases', 'synthetic-from-corpus', 'dogfood');
    const component = readFileSync(join(firstCaseDir(dogfoodRoot), 'component.tsx'), 'utf8');
    expect(component).toContain('function CheckoutPage()');
    expect(component).not.toContain('PLACEHOLDER');
  });
});

describe('runEvalAddFromLastFailure — kind=no-runs integration', () => {
  it('exits 3 when no .reactlens/runs/ exists', async () => {
    const repoRoot = freshRepo();
    const exitCode = await runEvalAddFromLastFailure({ cwd: repoRoot });
    expect(exitCode).toBe(3);
  });
});

describe('runEvalAddFromLastFailure — kind=no-failure integration', () => {
  it('exits 4 when the most recent run had no failing test', async () => {
    const repoRoot = freshRepo();
    const runId = '2026-05-20T22-00-00Z-aaaaaaaa';
    const eventsDir = join(repoRoot, '.reactlens', 'runs', runId);
    mkdirSync(eventsDir, { recursive: true });
    writeFileSync(
      join(eventsDir, 'events.jsonl'),
      jsonl(
        { t: 'run:start', runId, totalTests: 1, timestamp: 0 },
        { t: 'test:start', id: 't1', title: 'all good', file: '/dev/null', suite: 's' },
        { t: 'test:end', id: 't1', status: 'passed', duration: 50 },
      ),
    );
    const exitCode = await runEvalAddFromLastFailure({ cwd: repoRoot });
    expect(exitCode).toBe(4);
  });
});
