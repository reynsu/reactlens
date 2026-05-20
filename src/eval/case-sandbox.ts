// Case-sandbox helper — the calibration-leak fence used by both the
// non-ablation eval path (`runEvalCase` in eval-pipeline.ts) and the
// ablation path (`createProductionDiagnoseFn` in production-diagnose-fn.ts).
//
// The diagnosis agent has `Read` in its allowedTools (failure-agent.ts:
// 53). If we ran diagnose with cwd = case.path, the agent could trivially
// Read `truth.json` from the same directory as the component/spec inputs
// and produce a "correct" classification by copying the expected answer
// — exactly the false-confidence calibration disaster Principle 2 /
// ADR-0008 forbid.
//
// The fix is to copy ONLY the agent-visible inputs (component.tsx,
// spec.ts, plus the optional error.txt and snapshot.json) into a
// fresh tmpdir, point the failure paths there, and run diagnose with
// cwd = sandbox. truth.json never reaches that directory.
//
// Allocate-per-case is intentional: the cleanup runs `rmSync` on the
// sandbox dir, so a single per-process sandbox would not survive
// parallel cases or repeated invocations cleanly.
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EvalCase } from './eval-case-loader';

// The agent-visible inputs. Critically excludes `truth.json` — that is
// the entire point of this module. Adding to this list is a calibration-
// surface change; do not extend casually.
export const SANDBOX_INPUTS: readonly string[] = [
  'component.tsx',
  'spec.ts',
  'error.txt',
  'snapshot.json',
];

export type SandboxedCase = {
  // EvalCase with `path` rewritten to point at the sandbox tmpdir.
  // Pass this onward (e.g. to caseToFailure) so the resulting
  // FailedTest paths point into the sandbox.
  sandboxedCase: EvalCase;
  // Invoke in a `finally` block on the caller's side. Removes the
  // sandbox tmpdir recursively; idempotent and safe on repeated calls.
  cleanup: () => void;
};

export function sandboxCase(c: EvalCase): SandboxedCase {
  const dir = mkdtempSync(join(tmpdir(), 'reactlens-case-sandbox-'));
  for (const f of SANDBOX_INPUTS) {
    const src = join(c.path, f);
    if (existsSync(src)) copyFileSync(src, join(dir, f));
  }
  return {
    sandboxedCase: { ...c, path: dir },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
