// Verifies every prompt that ships with the bundled CLI can be loaded
// through `loadPromptSource()` from this installation. The v0.3 release
// runbook surfaced #34 (the bundled-CLI `../src/` resolution path was
// wrong) because no non-gated test exercised the agent-bearing prompt
// load. This command IS that probe: it loads each shipped prompt
// without invoking the agent, so it can run in CI without an API key.
//
// Inventory style — not directory scan — because the contract we want
// to enforce is "these are the prompts that MUST resolve from a
// freshly-installed package". A directory scan would mask the case
// where a prompt is in the source tree but excluded from `files` in
// package.json.
//
// Adding a shipped prompt: append a line below. The list is the
// contract; CI fails closed if a prompt added to the source tree is
// not added here.
import type { PromptSource } from '../agent/run-json';
import { loadPromptSource } from '../agent/run-json';

const SHIPPED_PROMPTS: ReadonlyArray<{ area: string; name: string }> = [
  { area: 'generator', name: 'generate-suite.md' },
  { area: 'generator', name: 'generate-suite-component-object.md' },
];

export type ProbeBundleResult =
  | {
      ok: true;
      version: string;
      prompts: { area: string; name: string; bytes: number }[];
    }
  | {
      ok: false;
      error: string;
      failed: { area: string; name: string; reason: string }[];
    };

export async function runInternalProbeBundle(opts: {
  version: string;
}): Promise<ProbeBundleResult> {
  const loaded: { area: string; name: string; bytes: number }[] = [];
  const failed: { area: string; name: string; reason: string }[] = [];
  for (const prompt of SHIPPED_PROMPTS) {
    const src: PromptSource = { area: prompt.area, name: prompt.name };
    try {
      const text = await loadPromptSource(src);
      if (text.trim().length === 0) {
        failed.push({ area: prompt.area, name: prompt.name, reason: 'empty content' });
        continue;
      }
      loaded.push({ area: prompt.area, name: prompt.name, bytes: text.length });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      failed.push({ area: prompt.area, name: prompt.name, reason });
    }
  }
  if (failed.length > 0) {
    return {
      ok: false,
      error: `${failed.length} prompt(s) failed to load`,
      failed,
    };
  }
  return { ok: true, version: opts.version, prompts: loaded };
}
