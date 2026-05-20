// TDD for `sandboxCase` — the leak-fence helper both eval-pipeline.ts
// (runEvalCase) and production-diagnose-fn.ts (createProductionDiagnoseFn)
// use to prevent the diagnosis agent's Read tool from walking back into
// the case directory and finding truth.json.
//
// Extracted from the original inline duplication once the third
// `SANDBOX_INPUTS` reference would have appeared in CI tooling — the
// constant living in two places was the smell that justified the
// abstraction.
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sandboxCase } from '../../src/eval/case-sandbox';
import type { EvalCase } from '../../src/eval/eval-case-loader';

function makeCase(root: string, name: string, files: Record<string, string>): EvalCase {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  for (const [filename, content] of Object.entries(files)) {
    writeFileSync(join(dir, filename), content);
  }
  return {
    name,
    path: dir,
    truth: { expectedClassification: 'real-bug', minimumConfidence: 'high' },
    curated: true,
  };
}

describe('sandboxCase', () => {
  // The single property worth locking on its own: truth.json must
  // never appear in the sandbox. Every other file is permitted to land
  // there (and tested indirectly through the consumers); this one is
  // the calibration-leak fence Principle 2 / ADR-0008 depends on.
  it('does NOT copy truth.json into the sandbox', () => {
    const root = mkdtempSync(join(tmpdir(), 'reactlens-sandbox-test-'));
    const c = makeCase(root, 'case-x', {
      'component.tsx': 'export const C = () => null;\n',
      'spec.ts': 'import {test} from "@playwright/test"; test("x", () => {});\n',
      'truth.json': JSON.stringify({
        expectedClassification: 'real-bug',
        minimumConfidence: 'high',
      }),
    });

    const { sandboxedCase, cleanup } = sandboxCase(c);
    try {
      // The sandbox dir exists and is NOT the original case dir.
      expect(sandboxedCase.path).not.toBe(c.path);
      expect(existsSync(sandboxedCase.path)).toBe(true);

      // Agent-visible inputs were copied.
      expect(existsSync(join(sandboxedCase.path, 'component.tsx'))).toBe(true);
      expect(existsSync(join(sandboxedCase.path, 'spec.ts'))).toBe(true);

      // The leak fence: truth.json was NOT copied. If this ever flips
      // the eval becomes a calibration disaster — the agent can Read
      // the expected answer.
      expect(existsSync(join(sandboxedCase.path, 'truth.json'))).toBe(false);
    } finally {
      cleanup();
    }

    // cleanup removed the sandbox.
    expect(existsSync(sandboxedCase.path)).toBe(false);
  });
});
