// I/O wrapper around the pure helpers in eval-metrics.ts: load a single case
// directory, invoke the diagnosis agent against it, compare to truth.json,
// return a CaseResult ready to feed into aggregateMetrics().
//
// Kept separate from eval-metrics.ts so that file stays pure (no fs, no agent)
// and from failure-agent.ts so the agent stays oblivious to truth.json.
//
// Sandboxing: the agent receives a tmpdir cwd containing ONLY the input files
// (component.tsx, spec.ts, optional error.txt / snapshot.json). truth.json
// never leaves the case dir. The component/spec paths embedded in the
// FailedTest also point inside the sandbox, so the agent cannot escape via
// absolute paths. This closes the leak that would otherwise let the agent
// Read truth.json and trivially produce a "correct" classification —
// exactly the calibration false-confidence Principle 2 forbids.
//
// Tradeoff: the agent loses git context (sandbox tmpdir has no .git). This
// is a real signal lost vs production diagnosis, but the leak is
// unacceptable, and eval is honester running under the weaker condition.
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { AgentRunner } from '../agent/runner';
import type { ComponentNode } from '../runner/events';
import { diagnose, type FailedTest } from './failure-agent';
import { compareToTruth, parseTruth, type CaseResult } from '@reynsu/reactlens-diagnosis-prompts';

const SANDBOX_INPUTS = ['component.tsx', 'spec.ts', 'error.txt', 'snapshot.json'] as const;

export type RunEvalCaseOptions = {
  caseDir: string;
  agent: AgentRunner;
  onChunk?: (chunk: string) => void;
};

export async function runEvalCase(opts: RunEvalCaseOptions): Promise<CaseResult> {
  const { caseDir, agent } = opts;
  const truth = parseTruth(readFileSync(join(caseDir, 'truth.json'), 'utf8'));

  const sandbox = mkdtempSync(join(tmpdir(), 'reactlens-eval-sandbox-'));
  try {
    for (const f of SANDBOX_INPUTS) {
      const src = join(caseDir, f);
      if (existsSync(src)) copyFileSync(src, join(sandbox, f));
    }

    const componentFile = join(sandbox, 'component.tsx');
    const specFile = join(sandbox, 'spec.ts');

    const errorPath = join(sandbox, 'error.txt');
    const errorMessage = existsSync(errorPath) ? readFileSync(errorPath, 'utf8') : undefined;

    const snapshotPath = join(sandbox, 'snapshot.json');
    let componentSnapshot: ComponentNode | undefined;
    if (existsSync(snapshotPath)) {
      componentSnapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as ComponentNode;
    }

    const failure: FailedTest = {
      testId: basename(caseDir),
      testTitle: basename(caseDir),
      specFile,
      componentFile,
      ...(errorMessage !== undefined ? { errorMessage } : {}),
      ...(componentSnapshot !== undefined ? { componentSnapshot } : {}),
    };

    const diagnosis = await diagnose({
      cwd: sandbox,
      agent,
      failure,
      onChunk: opts.onChunk,
    });

    return compareToTruth(diagnosis, truth, basename(caseDir));
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}
