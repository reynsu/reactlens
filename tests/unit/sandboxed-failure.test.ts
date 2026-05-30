// Pins the testTitle anonymization rule. The descriptive suffix on case
// directory names (e.g. 'case-022-real-bug-nan-fallback-mask') leaked
// ground-truth category to the diagnosis agent via the prompt's
// `Test: <title>` line. anonymizeTitle strips that suffix.
//
// If this test ever loosens (e.g. accepts full descriptive names in
// titles), every existing eval case becomes a leaky control — same
// failure mode as the 2026-05-24 ablation that motivated this fix.
import { describe, expect, it } from 'vitest';
import { anonymizeTitle } from '../../src/eval/sandboxed-failure';

describe('anonymizeTitle — strips descriptive suffix from eval-case identifiers', () => {
  it('keeps only the case-NNN prefix for the canonical naming convention', () => {
    expect(anonymizeTitle('case-022-real-bug-nan-fallback-mask')).toBe('case-022');
    expect(anonymizeTitle('case-001-stale-selector')).toBe('case-001');
    expect(anonymizeTitle('case-021-real-bug-sibling-cache-leak')).toBe('case-021');
  });

  it('returns the bare prefix when no descriptive suffix is present', () => {
    expect(anonymizeTitle('case-100')).toBe('case-100');
    expect(anonymizeTitle('case-7')).toBe('case-7');
  });

  it('falls through to the full name when the prefix does not match', () => {
    // Ad-hoc names the operator might pass directly. Better to surface
    // them verbatim than silently mangle into a useless empty string.
    expect(anonymizeTitle('ad-hoc-name')).toBe('ad-hoc-name');
    expect(anonymizeTitle('reactlens-smoke')).toBe('reactlens-smoke');
    expect(anonymizeTitle('')).toBe('');
  });

  it('does NOT leak the descriptive suffix even when it would be technically informative', () => {
    // This is the regression guard. If the regex is ever weakened to
    // include the suffix "for diagnostic context", the experiment
    // becomes invalid again. The prompt agent does not need the suffix
    // — it has the source, the spec, the error, and (optionally) the
    // snapshot.
    expect(anonymizeTitle('case-022-real-bug-nan-fallback-mask')).not.toContain('nan');
    expect(anonymizeTitle('case-022-real-bug-nan-fallback-mask')).not.toContain('real-bug');
    expect(anonymizeTitle('case-022-real-bug-nan-fallback-mask')).not.toContain('fallback');
  });
});
