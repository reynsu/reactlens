// Helpers shared between commands. Underscore-prefixed so the file isn't
// mistaken for a top-level subcommand by anyone scanning the directory.
import { glob } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function expandComponentGlobs(cwd: string, patterns: string[]): Promise<string[]> {
  const files = new Set<string>();
  for (const pattern of patterns) {
    const it = glob(pattern, { cwd }) as AsyncIterable<string>;
    for await (const f of it) {
      files.add(resolve(cwd, f));
    }
  }
  return Array.from(files);
}
