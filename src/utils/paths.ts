import { existsSync } from 'node:fs';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// In dev (running from src or dist/cli.js), templates live next to package.json
// at the repo root. After publish, they ship inside the package as `templates/`.
// In both cases we walk up from this file until we find a `templates` folder.
export function findTemplatesDir(startFrom: string = __dirname): string {
  let current = startFrom;
  for (let i = 0; i < 6; i += 1) {
    const candidate = join(current, 'templates');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`could not locate templates/ starting from ${startFrom}`);
}

// Self-defensive .gitignore for reactlens-managed directories.
//
// Why: the user's repo may not have ".reactlens" in its own .gitignore. By
// dropping a `*` .gitignore inside the directory itself, git ignores all of
// its contents regardless of what lives upstream — runs, frames, future
// caches. Non-clobbering: if a .gitignore already exists (user override),
// we leave it alone.
export async function ensureGitignore(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const target = join(dir, '.gitignore');
  try {
    await access(target);
    return;
  } catch {
    /* not present — write it */
  }
  await writeFile(target, '*\n');
}
