// Prompt source resolver — the dual-layout (bundled dist/ vs dev tsx)
// candidate list used by every caller that loads a prompt file off disk.
//
// Extracted from `src/agent/run-json.ts` in #47 because two non-diagnosis
// consumers (`src/generator/delegate.ts`, `src/commands/internal-probe-bundle.ts`)
// legitimately need it and run-json itself is being deleted now that
// DiagnosisRun owns the diagnosis pipeline. The DiagnosisRun execute core
// does NOT use this — its system prompts ship as plain text constants
// from `@reynsu/reactlens-diagnosis-prompts`.
//
// The candidate order is load-bearing for the bundled CLI to find prompts
// at runtime — see the comments inline.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ReactLensError } from '../utils/errors';

export type PromptSource =
  | { name: string; area: string }
  | { text: string };

// Resolves a prompt file across the dual layout this project ships with:
//
//   - Bundled CLI (`dist/cli.js`): __dirname = <pkg>/dist. Prompts live at
//     <pkg>/src/<area>/prompts/<name> because `files` in package.json
//     ships `src/generator/prompts`. Candidate: __dirname/../src/<area>/...
//   - Dev (tsx running source directly): __dirname = <pkg>/src/agent.
//     Prompts at <pkg>/src/<area>/prompts/<name>.
//     Candidate: __dirname/../<area>/...
//   - (Optional future) tsup-copies-prompts-into-dist: candidate
//     __dirname/<area>/... covers that without changing call sites.
//
// Order matters: try the bundled-CLI path first because that's the
// production path on every installed user. Dev fallback after.
export async function loadPromptSource(src: PromptSource): Promise<string> {
  if ('text' in src) return src.text;
  const candidates = [
    // Bundled CLI: dist/cli.js → ../src/<area>/prompts/<name>
    join(__dirname, '..', 'src', src.area, 'prompts', src.name),
    // Dev (tsx): src/agent/<this file> → ../<area>/prompts/<name>
    join(__dirname, '..', src.area, 'prompts', src.name),
    // tsup-copies-prompts-into-dist: dist/<area>/prompts/<name>
    join(__dirname, src.area, 'prompts', src.name),
    // Same as candidate 2 via dirname(__filename) — guards against ESM-shim
    // edge cases where __dirname is the bundle dir but __filename normalizes
    // differently.
    join(dirname(__filename), '..', src.area, 'prompts', src.name),
  ];
  for (const c of candidates) {
    try {
      return await readFile(c, 'utf8');
    } catch {
      /* try next */
    }
  }
  throw new ReactLensError(`prompt not found: area=${src.area} name=${src.name}`, {
    code: 'PROMPT_MISSING',
  });
}
