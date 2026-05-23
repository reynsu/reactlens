// live intent — preparation step.
//
// The `live` DiagnosisIntent is the shape `commands/run.ts` passes when a
// test fails during a live `reactlens run`. The Component bridge probe has
// (usually) captured a snapshot of the React tree at the failure point —
// that snapshot is the moat signal per ADR-0008 / Principle 1, so it
// MUST flow through to the agent's prompt unchanged.
//
// No sandbox: the live runner's cwd is the user's real project (where git
// context, source files, and snapshot context live). The Calibration fence
// is irrelevant — no truth.json exists, so there is nothing to leak.
import type { FailedTest as PublishedFailedTest } from '@reynsu/reactlens-diagnosis-prompts';
import type { ComponentNode } from '../runner/events';
import type { PreparedDiagnosis } from './execute';

export type LiveIntent = {
  kind: 'live';
  cwd: string;
  testId: string;
  testTitle: string;
  specFile: string;
  errorMessage?: string;
  componentSnapshot?: ComponentNode;
  componentFile?: string;
};

export function prepareLive(intent: LiveIntent): PreparedDiagnosis {
  const failure: PublishedFailedTest = {
    testId: intent.testId,
    testTitle: intent.testTitle,
    specFile: intent.specFile,
    ...(intent.errorMessage !== undefined ? { errorMessage: intent.errorMessage } : {}),
    ...(intent.componentSnapshot !== undefined ? { componentSnapshot: intent.componentSnapshot } : {}),
    ...(intent.componentFile !== undefined ? { componentFile: intent.componentFile } : {}),
  };
  return {
    cwd: intent.cwd,
    failure,
  };
}
