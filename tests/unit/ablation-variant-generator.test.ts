// TDD for the AblationVariantGenerator deep module — issue #8 behaviors
// #6-9. The generator's job is to produce the two prompt variants the
// ablation harness compares (per ADR-0001). The contract: byte-stable,
// deterministic, and loud-on-misuse (missing markers throws).
import { describe, expect, it } from 'vitest';
import {
  AblationMarkersMissingError,
  generateVariant,
} from '../../src/eval/ablation-variant-generator';

const PROMPT_WITH_MARKERS = `You are a diagnosis agent.

Classify the failure below into one of: real-bug, test-bug, flaky, env-issue.

<!-- ablation:snapshot-start -->
## Component snapshot at failure

The following is the React component tree captured at the moment the
test failed. Each node lists props, hooks, and source.

\`\`\`json
{
  "name": "LoginForm",
  "props": { "cvv": "12" },
  "hooks": [{ "kind": "state", "value": false, "name": "isPending" }]
}
\`\`\`
<!-- ablation:snapshot-end -->

Respond with a JSON object matching the Diagnosis schema.`;

describe('generateVariant', () => {
  it('returns the input prompt unchanged when variant is with-snapshot', () => {
    expect(generateVariant(PROMPT_WITH_MARKERS, 'with-snapshot')).toBe(PROMPT_WITH_MARKERS);
  });

  // The without-snapshot variant must remove BOTH the content between
  // the markers AND the markers themselves (per the decision documented
  // alongside issue #8). The agent should see no trace that an ablation
  // ever happened — the prompt looks like a snapshot-less prompt to it.
  // Non-snapshot prose must survive unchanged.
  it('removes the snapshot section and its markers when variant is without-snapshot', () => {
    const stripped = generateVariant(PROMPT_WITH_MARKERS, 'without-snapshot');

    // Snapshot content + markers gone.
    expect(stripped).not.toContain('<!-- ablation:snapshot-start -->');
    expect(stripped).not.toContain('<!-- ablation:snapshot-end -->');
    expect(stripped).not.toContain('Component snapshot at failure');
    expect(stripped).not.toContain('"LoginForm"');

    // Surrounding prose survives.
    expect(stripped).toContain('You are a diagnosis agent.');
    expect(stripped).toContain('Respond with a JSON object matching the Diagnosis schema.');
  });

  // The variant generator is the boundary between the with/without-snapshot
  // prompts the ablation harness compares — its output participates in the
  // (case, variant) cache hash from issue #8. Any non-determinism here
  // (Date.now() injected into the prompt, randomised whitespace, locale-
  // sensitive sort) would silently bust cache hits and make the moat
  // metric un-reproducible. This test is the regression guard.
  it('produces byte-stable output for the same input', () => {
    const a = generateVariant(PROMPT_WITH_MARKERS, 'without-snapshot');
    const b = generateVariant(PROMPT_WITH_MARKERS, 'without-snapshot');
    expect(a).toBe(b);

    const c = generateVariant(PROMPT_WITH_MARKERS, 'with-snapshot');
    const d = generateVariant(PROMPT_WITH_MARKERS, 'with-snapshot');
    expect(c).toBe(d);
  });

  // Decision from #8 planning: missing markers MUST throw a typed error
  // when without-snapshot is requested. Silent fallback (returning the
  // prompt unchanged) is rejected because it lets a developer run
  // "ablation" without actually ablating and never know — exactly the
  // false-confidence Principle 2 forbids. The with-snapshot variant
  // does NOT throw on missing markers because it's a no-op anyway.
  it('throws AblationMarkersMissingError when without-snapshot is requested on a prompt with no markers', () => {
    const promptWithoutMarkers = 'You are a diagnosis agent. Classify the failure.';
    expect(() => generateVariant(promptWithoutMarkers, 'without-snapshot')).toThrow(
      AblationMarkersMissingError,
    );
  });

  it('does not throw when with-snapshot is requested on a prompt with no markers', () => {
    const promptWithoutMarkers = 'You are a diagnosis agent. Classify the failure.';
    expect(() => generateVariant(promptWithoutMarkers, 'with-snapshot')).not.toThrow();
    expect(generateVariant(promptWithoutMarkers, 'with-snapshot')).toBe(promptWithoutMarkers);
  });
});
