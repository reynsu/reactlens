// Production DiagnoseFn composer — the wiring site the AblationHarness
// needs to actually run cases through the diagnosis agent end-to-end.
//
// The pipeline:
//   case → caseToFailure → buildUserMessage → generateVariant → diagnose
//
// The `userMessage` seam on diagnose() (commit 972c5d5) lets us swap
// the variant-transformed prompt in without rebuilding the git-context
// + runAgentJson plumbing.
//
// The without-snapshot variant requires the `<!-- ablation:snapshot-* -->`
// markers in the prompt template — those land via PR-B upstream in
// @reynsu/reactlens-diagnosis-prompts. Until that ships, calling this
// fn with variant='without-snapshot' throws AblationMarkersMissingError
// from `generateVariant`. The with-snapshot path is unaffected and is
// the only path tested here today.
import { buildUserMessage } from '@reynsu/reactlens-diagnosis-prompts';
import type { AgentRunner } from '../agent/runner';
import { diagnose } from '../analyzer/failure-agent';
import type { DiagnoseFn } from './ablation-harness';
import { generateVariant } from './ablation-variant-generator';
import { caseToFailure } from './case-to-failure';

export type CreateProductionDiagnoseFnOpts = {
  agent: AgentRunner;
  // Used by diagnose() for git-context gathering. Production wires this
  // to the user's cwd; tests pass a mkdtempSync dir so gatherGitContext
  // returns `{}` cleanly.
  cwd: string;
};

export function createProductionDiagnoseFn(opts: CreateProductionDiagnoseFnOpts): DiagnoseFn {
  const { agent, cwd } = opts;
  return async ({ case: c, variant }) => {
    const failure = caseToFailure(c);
    const base = buildUserMessage(failure);
    const userMessage = generateVariant(base, variant);
    return diagnose({ cwd, agent, failure, userMessage });
  };
}
