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
// `case-sandbox.ts` and `case-to-failure.ts` stay in src/eval/ for this
// slice; #47 relocates them once the legacy callers are gone.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FailedTest as PublishedFailedTest } from '@reynsu/reactlens-diagnosis-prompts';
import type { ComponentNode } from '../runner/events';
import { sandboxDir } from '../eval/case-sandbox';
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

// Local equivalent of `caseToFailure` from `src/eval/case-to-failure.ts`
// but parameterized on a path (not an EvalCase). Module-internal — also
// used by `prepare-ablation.ts` so both sandbox-based prepares share the
// same path → FailedTest mapping. The legacy `caseToFailure` stays alive
// for the eval-pipeline caller until #47.
export function readSandboxedFailure(sandboxPath: string, name: string): PublishedFailedTest {
  const specFile = join(sandboxPath, 'spec.ts');
  const componentFile = join(sandboxPath, 'component.tsx');
  const errorFile = join(sandboxPath, 'error.txt');
  const snapshotFile = join(sandboxPath, 'snapshot.json');

  const out: PublishedFailedTest = {
    testId: name,
    testTitle: name,
    specFile,
  };
  if (existsSync(componentFile)) out.componentFile = componentFile;
  if (existsSync(errorFile)) out.errorMessage = readFileSync(errorFile, 'utf8');
  if (existsSync(snapshotFile)) {
    // JSON.parse can throw on malformed input. Propagating is intentional
    // — a corrupt snapshot.json is a curation bug we want loud, not a
    // silently-undefined snapshot that would degrade the ablation
    // comparison without the operator noticing (Principle 2 / ADR-0001).
    out.componentSnapshot = JSON.parse(readFileSync(snapshotFile, 'utf8')) as ComponentNode;
  }
  return out;
}
