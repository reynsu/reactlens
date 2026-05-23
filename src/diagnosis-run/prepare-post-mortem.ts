// post-mortem intent — preparation step.
//
// The `post-mortem` DiagnosisIntent is the shape `commands/analyze.ts` passes:
// a failure parsed out of a Playwright JSON report after the run finished.
// No live probe ran, so there's no componentSnapshot; no sandbox is needed
// because the caller's cwd is the real project (not a synthesized eval case).
//
// CONTEXT.md: the four DiagnosisIntent kinds share an execute core; their
// prepare steps differ only in how they build the internal FailedTest shape
// (and, for ablation, whether they apply a Variant transform to the prompt).
import type { FailedTest as PublishedFailedTest } from '@reynsu/reactlens-diagnosis-prompts';
import type { PreparedDiagnosis } from './execute';

export type PostMortemIntent = {
  kind: 'post-mortem';
  cwd: string;
  testId: string;
  testTitle: string;
  specFile: string;
  errorMessage?: string;
  componentFile?: string;
};

export function preparePostMortem(intent: PostMortemIntent): PreparedDiagnosis {
  const failure: PublishedFailedTest = {
    testId: intent.testId,
    testTitle: intent.testTitle,
    specFile: intent.specFile,
    ...(intent.errorMessage !== undefined ? { errorMessage: intent.errorMessage } : {}),
    ...(intent.componentFile !== undefined ? { componentFile: intent.componentFile } : {}),
  };
  return {
    cwd: intent.cwd,
    failure,
  };
}
