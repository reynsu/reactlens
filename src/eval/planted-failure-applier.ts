// Applies a PlantedFailure recipe to a repo root in-place.
//
// The applier is the sharp edge of the harvest pipeline (slice #12 of
// v0.3 #7). It mutates a file in a cloned (or copied) repo, producing
// the broken state that reactlens will then diagnose. Every failure
// mode is a LOUD THROW because per Principle 2 a silently-not-applied
// plant produces an eval case that records a passing test as a
// failing one — exactly the false-confidence calibration regression
// the diagnosis loop is designed to detect.
//
// File-replace is the only recipe kind in this slice. The discriminated
// union in `corpus-manifest.ts` is the extension point — adding a new
// kind (`git-revert`, `prop-rename`, etc.) means adding a new case
// to the switch below and the corresponding schema variant upstream.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PlantedFailure } from './corpus-manifest';

// Error subclasses surface the failure mode to programmatic callers
// (the smoke test in tests/integration/harvest-eval.test.ts checks
// these with instanceof) AND to humans (each carries the path + the
// recipe-specific context that the operator needs to fix the recipe).
export class PlantedFailureFileNotFoundError extends Error {
  override readonly name = 'PlantedFailureFileNotFoundError';
  constructor(absPath: string, relPath: string) {
    super(
      `Planted-failure target file does not exist: ${relPath} (resolved to ${absPath}). Fix the recipe's path field or check the corpus entry's localFixturePath / commitSha.`,
    );
  }
}

export class PlantedFailurePatternNotFoundError extends Error {
  override readonly name = 'PlantedFailurePatternNotFoundError';
  constructor(relPath: string, oldString: string) {
    super(
      `Planted-failure oldString not found in ${relPath}. Searched for: ${JSON.stringify(oldString)}. The recipe is stale — either the file changed upstream, or the recipe was authored against a different commit.`,
    );
  }
}

export class PlantedFailurePatternAmbiguousError extends Error {
  override readonly name = 'PlantedFailurePatternAmbiguousError';
  constructor(relPath: string, oldString: string, matchCount: number) {
    super(
      `Planted-failure oldString matched ${matchCount} times in ${relPath} (must be exactly 1). Searched for: ${JSON.stringify(oldString)}. Widen the recipe's oldString with surrounding context until it identifies a single occurrence.`,
    );
  }
}

export function applyPlantedFailure(repoRoot: string, recipe: PlantedFailure): void {
  // Exhaustive switch on the discriminated union so adding a new kind
  // upstream produces a TypeScript error here instead of silently
  // becoming a no-op.
  switch (recipe.kind) {
    case 'file-replace':
      return applyFileReplace(repoRoot, recipe);
    default: {
      // Exhaustive guard. Reached only when the union widens without
      // a corresponding case here — TS narrows `recipe` to `never`.
      const _exhaustive: never = recipe.kind;
      throw new Error(`Unhandled PlantedFailure kind: ${String(_exhaustive)}`);
    }
  }
}

function applyFileReplace(
  repoRoot: string,
  recipe: Extract<PlantedFailure, { kind: 'file-replace' }>,
): void {
  const absPath = join(repoRoot, recipe.path);

  if (!existsSync(absPath)) {
    throw new PlantedFailureFileNotFoundError(absPath, recipe.path);
  }

  const before = readFileSync(absPath, 'utf8');

  // Substring match, not regex. Schema already guarantees oldString
  // is non-empty (.min(1)) and oldString !== newString (.refine()),
  // so the only remaining failure modes are zero matches or >1 match.
  const matches = countOccurrences(before, recipe.oldString);
  if (matches === 0) {
    throw new PlantedFailurePatternNotFoundError(recipe.path, recipe.oldString);
  }
  if (matches > 1) {
    throw new PlantedFailurePatternAmbiguousError(recipe.path, recipe.oldString, matches);
  }

  // Single-occurrence replace. String.prototype.replace with a string
  // pattern (not regex) replaces only the first match — exactly the
  // behavior we want, but we already confirmed there's only one.
  const after = before.replace(recipe.oldString, recipe.newString);
  writeFileSync(absPath, after);
}

// Counts non-overlapping occurrences of `needle` in `haystack`. Used
// to detect the ambiguous-pattern case before mutating the file.
function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) return count;
    count++;
    from = idx + needle.length;
  }
}
