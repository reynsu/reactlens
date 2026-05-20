// `reactlens eval add-from-last-failure` — dogfood eval-growth (slice #15).
//
// Thin CLI wrapper around dogfoodAddFromLastFailure. Maps the
// discriminated DogfoodResult to a specific exit code + message so the
// operator can tell at a glance whether the case was emitted, no
// recent run was found, or the most recent run had nothing failing.
//
// Exit codes:
//   0  — case emitted (kind: 'ok')
//   3  — no runs (kind: 'no-runs') — operator needs to run `reactlens
//        run` at least once before harvesting
//   4  — no failure in most recent run (kind: 'no-failure') — there's
//        nothing to harvest; rerun a failing test first
//
// Codes 3 and 4 are distinct from the generic "1" (ReactLensError) and
// "2" (unexpected error) used elsewhere so a wrapper script (or `pnpm
// reactlens eval add-from-last-failure || true` patterns) can tell
// "intended-skip" apart from "broken".
import { resolve } from 'node:path';
import { dogfoodAddFromLastFailure } from '../eval/dogfood-orchestrator';
import { logger } from '../utils/logger';

export type EvalAddFromLastFailureOpts = {
  cwd: string;
};

export async function runEvalAddFromLastFailure(opts: EvalAddFromLastFailureOpts): Promise<number> {
  const cwd = resolve(opts.cwd);
  const result = await dogfoodAddFromLastFailure({ cwd });

  switch (result.kind) {
    case 'ok':
      logger.info(
        { caseDir: result.caseDir, runId: result.runId, testId: result.testId },
        `dogfood: wrote case stub to ${result.caseDir}`,
      );
      return 0;
    case 'no-runs':
      logger.warn(
        { cwd },
        `dogfood: no reactlens runs found under ${cwd}/.reactlens/runs/. Run \`reactlens run\` first to capture a run, then re-invoke this command.`,
      );
      return 3;
    case 'no-failure':
      logger.warn(
        { cwd, runId: result.runId },
        `dogfood: most recent run ${result.runId} had no failing test. Re-run a known-failing test and try again.`,
      );
      return 4;
    default: {
      // Exhaustive guard. Reached only when DogfoodResult widens without
      // a corresponding case here — TS narrows `result` to `never`.
      const _exhaustive: never = result;
      throw new Error(`Unhandled DogfoodResult kind: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
