// Corpus manifest — zod schema + parser for the harvest input file.
//
// `harvest-corpus.json` at the repo root is the single source of truth
// for which source repos (or local fixtures) the harvest pipeline
// pulls from and what failure to plant in each. Hand-curated per
// ADR-0004 — adding an entry is a deliberate maintainer choice, not
// automated crawling.
//
// Schema-first: the harvest script (slice #12) treats the parsed
// manifest as opaque-but-typed. New plantedFailure kinds widen the
// discriminated union; call sites use exhaustive switches so a new
// kind doesn't quietly become a no-op.
//
// Pure: parse-string-return-object. No filesystem, no network. Tests
// in tests/unit/corpus-manifest.test.ts.
import { z } from 'zod';

// `file-replace` is the only recipe kind for slice #12. Designed as a
// discriminated union so future kinds (git-revert, prop-rename via
// AST, dep-version-downgrade) can be added without disturbing this one.
const FileReplaceRecipeSchema = z
  .object({
    kind: z.literal('file-replace'),
    // Path inside the repo root that the harvest script will mutate.
    // Always POSIX-style; the applier converts for the local platform.
    path: z.string().min(1),
    // Exact string to find. Substring match, not regex — keeps the
    // recipe readable in JSON and trivially debuggable when it fails
    // to apply.
    oldString: z.string().min(1),
    // Replacement. The schema rejects oldString === newString at the
    // .refine() below because that's a no-op plant — the harvested
    // case would record a non-failure as a failure.
    newString: z.string().min(1),
    // One-line, human-readable. Lands in the case's manifest.json so a
    // future reader can tell what was planted without re-deriving from
    // the diff.
    description: z.string().min(1),
  })
  .refine((r) => r.oldString !== r.newString, {
    message: 'plantedFailure.oldString === plantedFailure.newString — no-op plants are forbidden because the harvested case would not actually fail.',
    path: ['newString'],
  });
export type FileReplaceRecipe = z.infer<typeof FileReplaceRecipeSchema>;

const PlantedFailureSchema = z.discriminatedUnion('kind', [FileReplaceRecipeSchema]);
export type PlantedFailure = z.infer<typeof PlantedFailureSchema>;

const CorpusEntrySchema = z
  .object({
    // Human-readable identifier. Becomes the repo-slug directory under
    // `tests/diagnostic-eval/cases/synthetic-from-corpus/<name>/`.
    // Empty-string rejected because slug derivation would silently
    // produce a wrong path; a future operator would never notice.
    name: z.string().min(1),
    // Either localFixturePath (smoke-test mode) OR repoUrl (real-clone
    // mode), enforced by the .refine() below. Setting both is operator
    // error — an entry copied from a real repo to a fixture but the
    // operator forgot to remove the repoUrl would silently take the
    // wrong path under naive parsing.
    localFixturePath: z.string().min(1).optional(),
    repoUrl: z.string().url().optional(),
    // Pinned commit for reproducibility. Optional because fixture mode
    // (the only mode in CI) doesn't checkout anything. Real-clone
    // mode SHOULD pin — a follow-up could tighten this to "required
    // when repoUrl is set".
    commitSha: z.string().regex(/^[0-9a-f]{7,40}$/).optional(),
    plantedFailure: PlantedFailureSchema,
    // POSIX-style paths within the source repo that the harvest script
    // copies into the case directory as `spec.ts` / `component.tsx`.
    // The script does not autodetect — the operator names them.
    candidateSpec: z.string().min(1),
    candidateComponent: z.string().min(1),
  })
  .refine(
    (e) => Boolean(e.localFixturePath) !== Boolean(e.repoUrl),
    {
      message: 'Each corpus entry must set exactly one of localFixturePath OR repoUrl, not both and not neither.',
      path: ['localFixturePath'],
    },
  );
export type CorpusEntry = z.infer<typeof CorpusEntrySchema>;

export const CorpusManifestSchema = z.object({
  entries: z.array(CorpusEntrySchema).min(1, {
    message: 'harvest-corpus.json must contain at least one entry — an empty corpus is operator error (the harvest run would zero-iterate silently).',
  }),
});
export type CorpusManifest = z.infer<typeof CorpusManifestSchema>;

// Parse a JSON string into a validated CorpusManifest. Throws on JSON
// syntax error AND on schema mismatch. Errors are propagated, not
// wrapped — zod messages already pinpoint the offending field, and
// the caller (a script with a known stack) can format as desired.
export function parseCorpusManifest(jsonText: string): CorpusManifest {
  const raw = JSON.parse(jsonText);
  return CorpusManifestSchema.parse(raw);
}
