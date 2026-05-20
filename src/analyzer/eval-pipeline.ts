// I/O wrapper around the pure helpers in eval-metrics.ts: load a single case
// directory, invoke the diagnosis agent against it, compare to truth.json,
// return a CaseResult ready to feed into aggregateMetrics().
//
// Kept separate from eval-metrics.ts so that file stays pure (no fs, no agent)
// and from failure-agent.ts so the agent stays oblivious to truth.json.
//
// Sandboxing rationale lives in `../eval/case-sandbox.ts`. Summary:
// truth.json never reaches the agent-visible cwd, so the Read tool can't
// trivially copy the expected answer (Principle 2 / ADR-0008).
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { AgentRunner } from '../agent/runner';
import { caseToFailure } from '../eval/case-to-failure';
import { sandboxCase } from '../eval/case-sandbox';
import type { EvalCase } from '../eval/eval-case-loader';
import { diagnose } from './failure-agent';
import { compareToTruth, parseTruth, type CaseResult } from '@reynsu/reactlens-diagnosis-prompts';

export type RunEvalCaseOptions = {
  caseDir: string;
  agent: AgentRunner;
  onChunk?: (chunk: string) => void;
};

export async function runEvalCase(opts: RunEvalCaseOptions): Promise<CaseResult> {
  const { caseDir, agent } = opts;
  const truth = parseTruth(readFileSync(join(caseDir, 'truth.json'), 'utf8'));
  // Synthesize an EvalCase view of the directory. `curated: true` is a
  // safe default — runEvalCase doesn't observe curated at all, and the
  // downstream helpers (`sandboxCase`, `caseToFailure`) don't either.
  const c: EvalCase = { name: basename(caseDir), path: caseDir, truth, curated: true };

  const { sandboxedCase, cleanup } = sandboxCase(c);
  try {
    const failure = caseToFailure(sandboxedCase);
    const diagnosis = await diagnose({
      cwd: sandboxedCase.path,
      agent,
      failure,
      onChunk: opts.onChunk,
    });
    return compareToTruth(diagnosis, truth, c.name);
  } finally {
    cleanup();
  }
}
