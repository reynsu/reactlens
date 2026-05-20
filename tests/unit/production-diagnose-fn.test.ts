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

    // The case name flows through the prompt (testTitle = case.name).
    // We don't assert on the exact spec path because sandboxing replaces
    // it — see the sandboxing test below.
    const prompt = agent.calls[0]?.prompt ?? '';
    expect(prompt).toContain('case-001-tracer');
  });

  // Calibration leak prevention per Principle 2 / ADR-0008. The
  // diagnosis agent has Read in its allowedTools (failure-agent.ts:53);
  // if we pointed the FailedTest's specFile/componentFile at the
  // original case directory, the agent could trivially Read
  // `<dir>/truth.json` and produce a "correct" classification by
  // copying the expected answer. The sandbox dance (mirror of the one
  // in eval-pipeline.ts:39-77) copies only the agent-visible inputs to
  // a tmpdir and points the failure paths there, so truth.json never
  // appears in the agent's accessible cwd.
  it('sandboxes the case so truth.json is not reachable from the agent cwd', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'reactlens-prod-diagnose-'));
    const c = makeCase(cwd, 'case-002-leak-check');
    const agent = new FakeAgentRunner(VALID_DIAGNOSIS_JSON);

    const diagnoseFn = createProductionDiagnoseFn({ agent, cwd });
    await diagnoseFn({ case: c, variant: 'with-snapshot' });

    // The prompt does NOT reveal the original case directory path —
    // that would let the agent's Read tool walk back into the case
    // directory and find truth.json on a real run.
    const prompt = agent.calls[0]?.prompt ?? '';
    expect(prompt).not.toContain(c.path);
  });
});
