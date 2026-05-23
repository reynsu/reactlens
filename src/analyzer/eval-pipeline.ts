// I/O wrapper around the pure helpers in @reynsu/reactlens-diagnosis-prompts:
// load truth.json for a case, invoke DiagnosisRun against the eval-case
// intent, compare the resulting Diagnosis to truth, return a CaseResult.
//
// Post-#45: this file no longer orchestrates sandboxCase + caseToFailure +
// diagnose. Those concerns live inside the DiagnosisRun Module's
// `prepare-eval-case` step now. The §13 Calibration fence is enforced
// there, not here — runEvalCase doesn't need to know it exists.
//
// The legacy `failure-agent.ts::diagnose` + `case-sandbox.ts::sandboxCase`
// + `case-to-failure.ts::caseToFailure` remain alive for the AblationHarness
// caller (production-diagnose-fn.ts) until #46 migrates it and #47 deletes.
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { AgentRunner } from '../agent/runner';
import { createDiagnosisRun } from '../diagnosis-run/run';
import { compareToTruth, parseTruth, type CaseResult } from '@reynsu/reactlens-diagnosis-prompts';

export type RunEvalCaseOptions = {
  caseDir: string;
  agent: AgentRunner;
  onChunk?: (chunk: string) => void;
};

export async function runEvalCase(opts: RunEvalCaseOptions): Promise<CaseResult> {
  const { caseDir, agent } = opts;
  const truth = parseTruth(readFileSync(join(caseDir, 'truth.json'), 'utf8'));
  const name = basename(caseDir);

  const runner = createDiagnosisRun({ agent });
  const diagnosis = await runner.run(
    { kind: 'eval-case', caseDir, name },
    opts.onChunk !== undefined ? { onChunk: opts.onChunk } : undefined,
  );
  return compareToTruth(diagnosis, truth, name);
}
