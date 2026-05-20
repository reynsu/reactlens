// EvalCaseLoader — discovers eval cases on disk and tags them
// curated/uncurated for the ablation harness. Extracted from inline
// discovery in `tests/diagnostic-eval/eval-runner.test.ts` so the harness
// can consume the same shape from any caller (tests, CLI, future CI gate).
//
// This file is intentionally minimal — only the tracer-bullet behavior
// (one curated case from a flat directory) is implemented. The recursive
// + uncurated + malformed-skip behaviors land in subsequent TDD cycles.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Truth } from '@reynsu/reactlens-diagnosis-prompts';
import { parseTruth } from '@reynsu/reactlens-diagnosis-prompts';
import { logger } from '../utils/logger';

export type EvalCase = {
  name: string;
  path: string;
  truth: Truth;
  curated: boolean;
};

// The reserved directory name under `cases/` whose subtree holds
// uncurated corpus-harvest cases per ADR-0004 / issue #12. Layout:
//   cases/synthetic-from-corpus/<repo-slug>/case-*/
// Anything inside this subtree is tagged `curated: false` and the
// AblationReport headline filters it out until a human curates.
const UNCURATED_DIR = 'synthetic-from-corpus';

// Returns null and logs a warning if the directory is not a well-formed
// case (missing truth.json or shape mismatch). A single bad case must
// never kill the ablation sweep — that would let one stale fixture block
// every measurement, the opposite of the moat-validation story.
function tryLoadCaseAt(path: string, name: string, curated: boolean): EvalCase | null {
  try {
    const truth = parseTruth(readFileSync(join(path, 'truth.json'), 'utf8'));
    return { name, path, truth, curated };
  } catch (err) {
    logger.warn({ path, name, err: err instanceof Error ? err.message : err }, 'eval-case-loader: skipping malformed case directory');
    return null;
  }
}

export function loadEvalCases(casesDir: string): EvalCase[] {
  const out: EvalCase[] = [];
  const topLevel = readdirSync(casesDir, { withFileTypes: true }).filter((d) => d.isDirectory());

  for (const entry of topLevel) {
    const entryPath = join(casesDir, entry.name);
    if (entry.name === UNCURATED_DIR) {
      // Two levels deep: <repo-slug>/<case-*>/.
      const repoSlugs = readdirSync(entryPath, { withFileTypes: true }).filter((d) => d.isDirectory());
      for (const repo of repoSlugs) {
        const repoPath = join(entryPath, repo.name);
        const cases = readdirSync(repoPath, { withFileTypes: true }).filter((d) => d.isDirectory());
        for (const c of cases) {
          const loaded = tryLoadCaseAt(join(repoPath, c.name), c.name, false);
          if (loaded) out.push(loaded);
        }
      }
    } else {
      const loaded = tryLoadCaseAt(entryPath, entry.name, true);
      if (loaded) out.push(loaded);
    }
  }

  // Sort the merged result so output order is stable across filesystems.
  // readdir is alphabetical on APFS but not on ext4 — explicit sort keeps
  // cache hits stable and stdout summaries CI-friendly.
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
