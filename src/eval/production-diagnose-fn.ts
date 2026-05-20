// Production DiagnoseFn composer — the wiring site the AblationHarness
// needs to actually run cases through the diagnosis agent end-to-end.
//
// The pipeline (mirrors eval-pipeline.ts runEvalCase with the variant-
// strip insertion at the prompt step):
//
//   case → sandboxCase → caseToFailure → buildUserMessage
//        → generateVariant → diagnose(cwd=sandbox)
//
// The `userMessage` seam on diagnose() (commit 972c5d5) lets us swap
// the variant-transformed prompt in without rebuilding the git-context
// + runAgentJson plumbing.
//
// Sandboxing rationale lives in `case-sandbox.ts`. The summary:
// truth.json never reaches the agent-visible cwd, preventing the
// calibration leak Principle 2 / ADR-0008 forbid.
//
// The without-snapshot variant requires the `<!-- ablation:snapshot-* -->`
// markers in the prompt template — those land via PR-B upstream in
// @reynsu/reactlens-diagnosis-prompts. Until that ships, calling this
// fn with variant='without-snapshot' throws AblationMarkersMissingError
// from `generateVariant`. The with-snapshot path is unaffected.
import { buildUserMessage } from '@reynsu/reactlens-diagnosis-prompts';
import type { AgentRunner } from '../agent/runner';
import { diagnose } from '../analyzer/failure-agent';
import type { DiagnoseFn } from './ablation-harness';
import { generateVariant } from './ablation-variant-generator';
import { caseToFailure } from './case-to-failure';
import { sandboxCase } from './case-sandbox';

export type CreateProductionDiagnoseFnOpts = {
  agent: AgentRunner;
  // Provided for parity with the non-ablation eval path; the sandbox
  // cwd is what actually reaches diagnose(), so the value here only
  // affects git-context gathering when the sandbox isn't a git repo
  // (it never is, so gitContext is `{}`).
  cwd: string;
};

export function createProductionDiagnoseFn(opts: CreateProductionDiagnoseFnOpts): DiagnoseFn {
  const { agent } = opts;
  return async ({ case: c, variant }) => {
    const { sandboxedCase, cleanup } = sandboxCase(c);
    try {
      const failure = caseToFailure(sandboxedCase);
      const base = buildUserMessage(failure);
      const userMessage = generateVariant(base, variant);
      return await diagnose({ cwd: sandboxedCase.path, agent, failure, userMessage });
    } finally {
      cleanup();
    }
  };
}
