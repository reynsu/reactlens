// TDD for the EvalCaseLoader deep module — issue #8 behavior #1 (tracer
// bullet): loading a single curated case from a flat cases directory.
//
// The loader's job is to walk the eval-cases directory tree (curated
// `case-*` subdirs at the top level, uncurated `synthetic-from-corpus/*`
// nested deeper) and return tagged tuples to the ablation harness. This
// first test only locks in the happy-path shape; later tests force the
// recursive, uncurated, and malformed-skip behaviors.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// Replace the real pino logger with a plain mock object so that tests
// can assert on the warning shape without fighting pino's internal
// level filter or its prototype-method binding (which makes `vi.spyOn`
// unreliable). `vi.mock` is hoisted by vitest, so this must precede
// any import of modules that transitively load the logger.
vi.mock('../../src/utils/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  },
}));

import { loadEvalCases } from '../../src/eval/eval-case-loader';
import { logger } from '../../src/utils/logger';

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
  return dir;
}

describe('loadEvalCases', () => {
  it('loads one curated case from a flat cases directory', () => {
    const casesDir = mkdtempSync(join(tmpdir(), 'reactlens-cases-'));
    const caseDir = makeCuratedCase(casesDir, 'case-001-tracer', {
      expectedClassification: 'test-bug',
      minimumConfidence: 'medium',
    });

    const cases = loadEvalCases(casesDir);

    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      name: 'case-001-tracer',
      path: caseDir,
      curated: true,
      truth: {
        expectedClassification: 'test-bug',
        minimumConfidence: 'medium',
      },
    });
  });

  // Stable order matters for ablation: the AblationReport iterates cases
  // and the per-case ordering shows up in stdout summaries + cached
  // (case, variant) hashes. Without a sort, filesystem-dependent readdir
  // order makes CI snapshots non-deterministic across OSes.
  it('returns cases in stable lexicographic order regardless of fs order', () => {
    const casesDir = mkdtempSync(join(tmpdir(), 'reactlens-cases-'));
    // Insertion order deliberately out of alphabetical sequence.
    makeCuratedCase(casesDir, 'case-002-beta', {
      expectedClassification: 'real-bug',
      minimumConfidence: 'high',
    });
    makeCuratedCase(casesDir, 'case-001-alpha', {
      expectedClassification: 'test-bug',
      minimumConfidence: 'medium',
    });
    makeCuratedCase(casesDir, 'case-010-gamma', {
      expectedClassification: 'flaky',
      minimumConfidence: 'low',
    });

    const cases = loadEvalCases(casesDir);

    expect(cases.map((c) => c.name)).toEqual([
      'case-001-alpha',
      'case-002-beta',
      'case-010-gamma',
    ]);
  });

  // Per ADR-0004 + issue #12: corpus-harvested cases live under
  // `cases/synthetic-from-corpus/<repo-slug>/case-*` and MUST be tagged
  // `curated: false` so the AblationReport's headline accuracy can
  // filter them out until a human reviews each.
  it('tags cases under synthetic-from-corpus/<repo-slug>/ as curated: false', () => {
    const casesDir = mkdtempSync(join(tmpdir(), 'reactlens-cases-'));
    makeCuratedCase(casesDir, 'case-001-curated', {
      expectedClassification: 'test-bug',
      minimumConfidence: 'medium',
    });
    const harvestRoot = join(casesDir, 'synthetic-from-corpus', 'some-react-repo');
    mkdirSync(harvestRoot, { recursive: true });
    makeCuratedCase(harvestRoot, 'case-001-harvested', {
      expectedClassification: 'real-bug',
      minimumConfidence: 'high',
    });

    const cases = loadEvalCases(casesDir);

    const byName = Object.fromEntries(cases.map((c) => [c.name, c]));
    expect(byName['case-001-curated']?.curated).toBe(true);
    expect(byName['case-001-harvested']?.curated).toBe(false);
    expect(cases).toHaveLength(2);
  });

  // Per issue #8 acceptance: malformed case directories (missing
  // truth.json or invalid shape) MUST be skipped with a logged warning,
  // not throw — so a single bad case doesn't kill the whole ablation
  // sweep. The valid case in the same directory must still be returned.
  it('skips malformed case directories and logs a warning', () => {
    const casesDir = mkdtempSync(join(tmpdir(), 'reactlens-cases-'));
    makeCuratedCase(casesDir, 'case-001-valid', {
      expectedClassification: 'test-bug',
      minimumConfidence: 'medium',
    });
    // Malformed: case directory exists but has no truth.json.
    mkdirSync(join(casesDir, 'case-002-missing-truth'), { recursive: true });

    // Reset between tests since vi.mock makes the mock module-scoped.
    (logger.warn as ReturnType<typeof vi.fn>).mockClear();

    const cases = loadEvalCases(casesDir);

    expect(cases).toHaveLength(1);
    expect(cases[0]?.name).toBe('case-001-valid');
    expect(logger.warn).toHaveBeenCalledOnce();
    // The warning must name the offending directory so the operator
    // can find and fix it without grepping the codebase.
    const warnCall = (logger.warn as ReturnType<typeof vi.fn>).mock.calls[0];
    const warnPayload = JSON.stringify(warnCall);
    expect(warnPayload).toMatch(/case-002-missing-truth/);
  });

  // Regression guard: an empty cases directory must return `[]`, not
  // throw and not warn. The ablation harness can be invoked against a
  // fresh checkout where no eval cases exist yet, and that should
  // produce an empty AblationReport, not crash.
  it('returns an empty array for an empty cases directory', () => {
    const casesDir = mkdtempSync(join(tmpdir(), 'reactlens-cases-'));
    (logger.warn as ReturnType<typeof vi.fn>).mockClear();

    const cases = loadEvalCases(casesDir);

    expect(cases).toEqual([]);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
