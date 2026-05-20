// TDD for the production DiagnoseFn — the composition site that wires
// `caseToFailure → buildUserMessage → generateVariant → diagnose` into
// a single function the AblationHarness can invoke per (case, variant).
//
// The without-snapshot leg requires PR-B upstream (markers in
// @reynsu/reactlens-diagnosis-prompts) before it works end-to-end —
// without markers, generateVariant throws AblationMarkersMissingError.
// This file therefore tests only the with-snapshot path; the without-
// snapshot tracer lands once the prompts package ships 0.3.0.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EvalCase } from '../../src/eval/eval-case-loader';
import { createProductionDiagnoseFn } from '../../src/eval/production-diagnose-fn';
import { FakeAgentRunner } from '../helpers/fake-agent';

const VALID_DIAGNOSIS_JSON = JSON.stringify({
  classification: 'real-bug',
  confidence: 'high',
  rootCause: 'derived from production composition',
  evidence: ['evidence'],
  suggestedFix: 'fix',
});

function makeCase(root: string, name: string): EvalCase {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'component.tsx'), 'export const C = () => null;\n');
  writeFileSync(
    join(dir, 'spec.ts'),
    'import {test} from "@playwright/test"; test("x", () => {});\n',
  );
  writeFileSync(
    join(dir, 'truth.json'),
    JSON.stringify({ expectedClassification: 'real-bug', minimumConfidence: 'high' }),
  );
  return {
    name,
    path: dir,
    truth: { expectedClassification: 'real-bug', minimumConfidence: 'high' },
    curated: true,
  };
}

describe('createProductionDiagnoseFn', () => {
  // Tracer bullet: with-snapshot variant composes the pipeline end-to-
  // end. The agent receives the full user message buildUserMessage
  // produces (no marker-stripping because the variant is identity), and
  // the returned Diagnosis is the scripted one.
  it('composes caseToFailure → buildUserMessage → diagnose for with-snapshot', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'reactlens-prod-diagnose-'));
    const c = makeCase(cwd, 'case-001-tracer');
    const agent = new FakeAgentRunner(VALID_DIAGNOSIS_JSON);

    const diagnoseFn = createProductionDiagnoseFn({ agent, cwd });
    const diagnosis = await diagnoseFn({ case: c, variant: 'with-snapshot' });

    // The composer produced a Diagnosis (not just a stub) — proving the
    // diagnose() invocation actually happened with the variant prompt.
    expect(diagnosis.classification).toBe('real-bug');
    expect(diagnosis.rootCause).toBe('derived from production composition');

    // The agent saw a prompt derived from the case's failure shape.
    // Two markers worth asserting:
    //  - "case-001-tracer" appears (testTitle = case.name)
    //  - the spec file path appears (FailedTest.specFile)
    // Both come from buildUserMessage(caseToFailure(c)) — they prove the
    // composition pipeline ran, without coupling to the exact prompt
    // formatting (which lives in the published prompts package).
    const prompt = agent.calls[0]?.prompt ?? '';
    expect(prompt).toContain('case-001-tracer');
    expect(prompt).toContain(join(c.path, 'spec.ts'));
  });
});
