// eval-case intent — preparation step. First Module-internal owner of
// the §13 Calibration fence.
//
// The fence (CONTEXT.md): truth.json MUST NOT reach the agent-visible cwd.
// Before this slice, every caller of `diagnose()` for an eval case was
// responsible for calling `sandboxCase` themselves. Now the responsibility
// lives inside the Module — `runEvalCase` (and any future eval-case caller)
// passes an intent and the Module sandboxes for them.
//
// The lifecycle: prepare() creates a tmpdir + copies SANDBOX_INPUTS into
// it. The cleanup callback returned alongside the PreparedDiagnosis is
// invoked by the Module's run() in a `finally` block — so cleanup runs
// even if the execute core throws.
//
// `case-sandbox.ts` stays in src/eval/. readSandboxedFailure used to live
// here too, but prepare-ablation reached across the sibling seam to import
// it — that leak is fixed by moving the helper into src/eval/sandboxed-
// failure.ts, peer of sandboxDir.
import { sandboxDir } from '../eval/case-sandbox';
import { readSandboxedFailure } from '../eval/sandboxed-failure';
import type { PreparedDiagnosis } from './execute';

export type EvalCaseIntent = {
  kind: 'eval-case';
  caseDir: string;
  // Used as testId + testTitle inside the FailedTest. Typically basename
  // of caseDir; callers can override (e.g. corpus-harvested cases use a
  // namespaced name).
  name: string;
};

export type PrepareResult = {
  prepared: PreparedDiagnosis;
  // Invoked by DiagnosisRun.run() in `finally` — removes the sandbox
  // tmpdir even if execute throws. Absent for intents that don't sandbox
  // (post-mortem, live).
  cleanup?: () => void;
};

export function prepareEvalCase(intent: EvalCaseIntent): PrepareResult {
  const { dir, cleanup } = sandboxDir(intent.caseDir);
  const failure = readSandboxedFailure(dir, intent.name);
  return {
    prepared: { cwd: dir, failure },
    cleanup,
  };
}
