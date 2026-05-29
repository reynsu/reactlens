// Single source of truth for package-manager detection. Lifted out of
// init.ts so both `detectScaffoldInputs` (pure, for the playwright.config
// interpolation) and `installDevDeps` (the real `execa` install path) call
// the same lockfile sniff instead of duplicating it.
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

export type PackageManager = 'pnpm' | 'npm' | 'yarn';

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

// pnpm-lock.yaml → pnpm, yarn.lock → yarn, otherwise npm. Pure aside from
// reading the lockfile markers; spawns no process.
export async function detectPackageManager(projectDir: string): Promise<PackageManager> {
  if (await exists(join(projectDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await exists(join(projectDir, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

// The `<pm> dev` script invocation. pnpm/yarn run scripts directly; npm
// needs the `run` verb.
export function devCommandFor(pm: PackageManager): string {
  if (pm === 'npm') return 'npm run dev';
  return `${pm} dev`;
}
