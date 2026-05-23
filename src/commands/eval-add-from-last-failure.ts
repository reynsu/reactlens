// `reactlens eval add-from-last-failure` — dogfood eval-growth (slice #15).
//
// CLI wrapper around DogfoodSource (the HarvestSource adapter). The CLI
// owns three concerns the Source deliberately doesn't:
//   1. Path convention: where harvested cases land under the repo.
//   2. mkdir + emit: the Source is build-only per HarvestSource design
//      pick (i); this command is the disk-I/O caller.
//   3. Exit-code mapping: maps describeWhyEmpty() outcomes to distinct
//      codes so a wrapper script can tell "intended-skip" apart from
//      "broken".
//
// Exit codes:
//   0  — case emitted (one artifact yielded)
//   3  — no runs (describeWhyEmpty === 'no-runs') — operator needs to
//        run `reactlens run` at least once before harvesting
//   4  — no failure in most recent run (describeWhyEmpty === 'no-failure')
//        — there's nothing to harvest; rerun a failing test first
//
// Codes 3 and 4 are distinct from the generic "1" (ReactLensError) and
// "2" (unexpected error) used elsewhere so a wrapper script (or `pnpm
// reactlens eval add-from-last-failure || true` patterns) can tell
// "intended-skip" apart from "broken".
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DogfoodSource } from '../eval/dogfood-source';
import { emitHarvestedCase, type HarvestArtifacts } from '../eval/harvest-case-emitter';
import { slugify } from '../eval/slug';
import { logger } from '../utils/logger';

export type EvalAddFromLastFailureOpts = {
  cwd: string;
};

export async function runEvalAddFromLastFailure(opts: EvalAddFromLastFailureOpts): Promise<number> {
  const cwd = resolve(opts.cwd);
  const source = new DogfoodSource({ cwd });

  // Collect into an array — dogfood yields 0-or-1; the array form
  // makes the post-iteration empty branch straightforward.
  const artifacts: HarvestArtifacts[] = [];
  for await (const art of source.iterate()) artifacts.push(art);

  if (artifacts.length === 0) {
    const why = source.describeWhyEmpty();
    if (why === 'no-runs') {
      logger.warn(
        { cwd },
        `dogfood: no reactlens runs found under ${cwd}/.reactlens/runs/. Run \`reactlens run\` first to capture a run, then re-invoke this command.`,
      );
      return 3;
    }
    if (why === 'no-failure') {
      logger.warn(
        { cwd },
        `dogfood: most recent run had no failing test. Re-run a known-failing test and try again.`,
      );
      return 4;
    }
    // Unexpected: iterate yielded nothing AND describeWhyEmpty has no
    // explanation. Surface as a generic warning rather than swallowing.
    logger.warn(
      { cwd },
      `dogfood: source produced no artifacts and reported no reason. Investigate src/eval/dogfood-source.ts.`,
    );
    return 4;
  }

  // dogfood is one-artifact-per-call by construction; defensive
  // assertion against a future Source refactor that accidentally
  // changes the cardinality without updating this caller.
  if (artifacts.length > 1) {
    logger.warn(
      { count: artifacts.length },
      `dogfood: expected exactly 1 artifact, got ${artifacts.length}. Emitting the first; the others are silently dropped.`,
    );
  }
  const art = artifacts[0]!;

  // Path convention lives in the caller (per HarvestSource design pick
  // (i)). The case dir embeds the source runId so re-running the dogfood
  // command on the same failure twice is idempotent (overwrites in the
  // same directory) AND so an operator `ls` shows which run a case
  // came from at a glance.
  const sourceRunId = art.manifest.discoveredFailure?.sourceRunId ?? 'unknown-run';
  const testTitle = art.manifest.discoveredFailure?.testTitle ?? 'untitled';
  const slug = slugify(`${sourceRunId}-${testTitle}`, 'untitled');
  const casesRoot = join(
    cwd,
    'tests',
    'diagnostic-eval',
    'cases',
    'synthetic-from-corpus',
    'dogfood',
  );
  const caseDir = join(casesRoot, `case-${slug}`);
  // mkdir -p here, not in the emitter — the emitter throws on missing
  // outputDir to catch typo'd paths in operator-direct calls.
  mkdirSync(caseDir, { recursive: true });
  emitHarvestedCase(caseDir, art);

  logger.info(
    {
      caseDir,
      runId: sourceRunId,
      testId: art.manifest.discoveredFailure?.testId,
    },
    `dogfood: wrote case stub to ${caseDir}`,
  );
  return 0;
}
