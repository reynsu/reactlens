// Production DiagnoseFn composer — the wiring site the AblationHarness
// needs to actually run cases through the diagnosis agent end-to-end.
//
// The pipeline (mirrors eval-pipeline.ts:35-77 with the variant-strip
// insertion at the prompt step):
//
//   case → sandbox-copy → caseToFailure → buildUserMessage
//        → generateVariant → diagnose(cwd=sandbox)
//
// The `userMessage` seam on diagnose() (commit 972c5d5) lets us swap
// the variant-transformed prompt in without rebuilding the git-context
// + runAgentJson plumbing.
//
// Sandboxing rationale (Principle 2 / ADR-0008): the diagnosis agent
// has Read in its allowedTools. If we pointed the FailedTest paths at
// the original case directory, the agent could Read `truth.json` and
// trivially produce a "correct" classification — exactly the
// false-confidence the calibration rubric forbids. Same dance as
// eval-pipeline.ts runs for the non-ablation eval path; sharing into
// a helper waits for a third consumer.
//
// The without-snapshot variant requires the `<!-- ablation:snapshot-* -->`
// markers in the prompt template — those land via PR-B upstream in
// @reynsu/reactlens-diagnosis-prompts. Until that ships, calling this
// fn with variant='without-snapshot' throws AblationMarkersMissingError
// from `generateVariant`. The with-snapshot path is unaffected.
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildUserMessage } from '@reynsu/reactlens-diagnosis-prompts';
import type { AgentRunner } from '../agent/runner';
import { diagnose } from '../analyzer/failure-agent';
import type { DiagnoseFn } from './ablation-harness';
import { generateVariant } from './ablation-variant-generator';
import { caseToFailure } from './case-to-failure';
import type { EvalCase } from './eval-case-loader';

// Files copied into the sandbox. Critically excludes truth.json — see
// the file-level comment for the leak-prevention rationale.
const SANDBOX_INPUTS: readonly string[] = [
  'component.tsx',
  'spec.ts',
  'error.txt',
  'snapshot.json',
];

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
    const sandbox = mkdtempSync(join(tmpdir(), 'reactlens-ablation-sandbox-'));
    try {
      for (const f of SANDBOX_INPUTS) {
        const src = join(c.path, f);
        if (existsSync(src)) copyFileSync(src, join(sandbox, f));
      }
      const sandboxedCase: EvalCase = { ...c, path: sandbox };
      const failure = caseToFailure(sandboxedCase);
      const base = buildUserMessage(failure);
      const userMessage = generateVariant(base, variant);
      return await diagnose({ cwd: sandbox, agent, failure, userMessage });
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  };
}
