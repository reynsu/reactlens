// AblationVariantGenerator — produces the two prompt variants the
// ablation harness compares (per ADR-0001). The diagnosis prompt MUST
// wrap its component-snapshot section between
//   <!-- ablation:snapshot-start -->
// and
//   <!-- ablation:snapshot-end -->
// markers; the generator removes that section (including the markers)
// for the `without-snapshot` variant and returns the prompt unchanged
// for `with-snapshot`. The markers in the upstream prompt live in
// `@reynsu/reactlens-diagnosis-prompts` — see PR-B in issue #8 for the
// coordinated bump that adds them.
//
// This file is intentionally minimal — only the tracer-bullet behavior
// (with-snapshot identity) is implemented. The without-snapshot strip
// + byte-stability + missing-markers throw land in subsequent cycles.
export type AblationVariant = 'with-snapshot' | 'without-snapshot';

// Matches `<!-- ablation:snapshot-start -->` through `<!-- ablation:snapshot-end -->`,
// inclusive of both markers and the trailing newline (so the resulting
// prompt doesn't gain a spurious blank line at the strip site). The lazy
// quantifier `[\s\S]*?` prevents one marker pair from swallowing across
// neighbours when the prompt has multiple sections.
const SNAPSHOT_SECTION = /<!-- ablation:snapshot-start -->[\s\S]*?<!-- ablation:snapshot-end -->\n?/;
const SNAPSHOT_START_MARKER = '<!-- ablation:snapshot-start -->';

// Thrown when without-snapshot ablation is requested on a prompt that
// has no `<!-- ablation:snapshot-start -->` marker. Silent fallback is
// rejected by design: an unmarked prompt run "without ablation" would
// produce a moat-contribution delta of zero and the developer would
// never know the ablation didn't actually happen — exactly the false-
// confidence Principle 2 forbids.
export class AblationMarkersMissingError extends Error {
  override readonly name = 'AblationMarkersMissingError';
  constructor() {
    super(
      `Prompt is missing the \`${SNAPSHOT_START_MARKER}\` marker. The without-snapshot variant cannot be generated; add markers around the component-snapshot section first.`,
    );
  }
}

export function generateVariant(prompt: string, variant: AblationVariant): string {
  if (variant === 'with-snapshot') return prompt;
  if (!prompt.includes(SNAPSHOT_START_MARKER)) throw new AblationMarkersMissingError();
  return prompt.replace(SNAPSHOT_SECTION, '');
}
