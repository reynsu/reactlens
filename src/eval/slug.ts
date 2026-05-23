// Filesystem-safe slug helper shared by the HarvestSource adapters and
// their CLI callers.
//
// Extracted because two adapters (DogfoodSource, CorpusSource) AND two
// CLI wrappers (eval-add-from-last-failure, scripts/harvest-eval) all
// derived the same lowercase-and-hyphenate logic — per LANGUAGE.md
// "two adapters = real seam", that's the threshold for sharing rather
// than duplicating.
//
// Reconciliation: pre-PR, dogfood + the CLI used a `'untitled'` fallback
// for empty results; corpus + the script used `''` (caller-handled). The
// shared helper exposes the fallback as an optional parameter so callers
// keep their original surface behavior without forcing one convention.
export function slugify(s: string, fallback = ''): string {
  const out = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return out.length > 0 ? out : fallback;
}
