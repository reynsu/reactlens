// Regression test for loadPromptSource path resolution.
//
// Lives because of a real bug: pre-fix, `loadPromptSource` had a candidate
// path with two `..` instead of one, so the BUNDLED CLI (dist/cli.js)
// resolved prompts to a path ABOVE the package root and silently failed
// with PROMPT_MISSING on every `reactlens generate` invocation through
// `node bin/reactlens.js`. The bug shipped past several PRs because no
// existing test exercised the bundled-CLI generate path.
//
// This test asserts both shipped generator prompts load via the dev path
// (the test runner uses tsx semantics). For the bundled-CLI path, the
// regression check lives in `tests/integration/co-generate-roundtrip.test.ts`
// (operator-gated) and in `tests/integration/cli-smoke.test.ts` (always-on,
// runs the built CLI). Together they cover dev + bundled.
import { describe, expect, it } from 'vitest';
import { loadPromptSource } from '../../src/agent/run-json';

describe('loadPromptSource', () => {
  it('resolves generate-suite.md (POM prompt) from the shipped source tree', async () => {
    const content = await loadPromptSource({ name: 'generate-suite.md', area: 'generator' });
    expect(content.length).toBeGreaterThan(0);
    expect(content).toMatch(/^# reactlens/);
  });

  it('resolves generate-suite-component-object.md (CO prompt) from the shipped source tree', async () => {
    const content = await loadPromptSource({
      name: 'generate-suite-component-object.md',
      area: 'generator',
    });
    expect(content.length).toBeGreaterThan(0);
    expect(content).toMatch(/Component-Object Pattern/i);
  });

  it('throws a typed error with PROMPT_MISSING code on a non-existent prompt', async () => {
    let caught: unknown = null;
    try {
      await loadPromptSource({ name: 'does-not-exist.md', area: 'generator' });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect((caught as { code?: string }).code).toBe('PROMPT_MISSING');
  });

  it('returns text verbatim when the source is an inline-text source (no file lookup)', async () => {
    const content = await loadPromptSource({ text: 'inline prompt content' });
    expect(content).toBe('inline prompt content');
  });
});
