import { existsSync } from 'node:fs';
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
