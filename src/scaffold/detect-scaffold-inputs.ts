// Deep, pure resolver that turns a project directory into the concrete
// values the playwright.config scaffold needs (ADR-0010: interpolate the
// Detected stack at write time instead of copying the template verbatim).
//
// Wraps `detectStack` (build tool → port) and `detectPackageManager`
// (lockfile → pm). Spawns no process: every input is read off disk, so the
// result is a pure function of the project's package.json + lockfiles +
// marker files. That purity is what makes `renderPlaywrightConfig` testable
// as byte-stable input → output.
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { detectStack, type Router } from '../ast/route-analyzer';
import { detectPackageManager, devCommandFor, type PackageManager } from '../utils/package-manager';

export type ScaffoldInputs = {
  devServerPort: number;
  devCommand: string;
  packageManager: PackageManager;
  baseURL: string;
  router: Router;
  reactVersion: string;
  testDir: string;
  // Globs of component files reactlens analyzes for visual states. Seeded
  // from the project's actual component directories so `reactlens generate`
  // finds something out of the box (ADR-0010 / issue #71). Falls back to
  // DEFAULT_COMPONENT_GLOBS when no known directory contains a .tsx file.
  componentGlobs: string[];
};

// Fallback when the build tool is unknown (no vite/next signal). Vite's
// default dev port is the most common React-app default, so it is the least
// surprising guess and keeps the generated config runnable.
const FALLBACK_PORT = 5173;
const DEFAULT_TEST_DIR = 'e2e/specs';

// Mirrors the schema default in src/config/schema.ts: the fallback when no
// component directory is detected on disk.
const DEFAULT_COMPONENT_GLOBS = ['src/pages/**/*.tsx', 'src/components/**/*.tsx'];

// Directories we probe for components, in stable preference order. Each maps
// to the glob seeded when the directory exists and holds at least one .tsx.
const COMPONENT_DIR_CANDIDATES: ReadonlyArray<{ dir: string; glob: string }> = [
  { dir: 'src/pages', glob: 'src/pages/**/*.tsx' },
  { dir: 'src/components', glob: 'src/components/**/*.tsx' },
  { dir: 'app', glob: 'app/**/*.tsx' },
  { dir: 'pages', glob: 'pages/**/*.tsx' },
  { dir: 'components', glob: 'components/**/*.tsx' },
];

// True if `dir` (relative to projectDir) exists and contains at least one
// .tsx file at any depth. Pure: reads the dir tree off disk, spawns nothing.
async function dirHasTsx(projectDir: string, dir: string): Promise<boolean> {
  const abs = join(projectDir, dir);
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(abs, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.tsx')) return true;
    if (entry.isDirectory()) {
      if (await dirHasTsx(projectDir, join(dir, entry.name))) return true;
    }
  }
  return false;
}

async function detectComponentGlobs(
  projectDir: string,
  router: Router,
): Promise<string[]> {
  const globs: string[] = [];
  for (const { dir, glob } of COMPONENT_DIR_CANDIDATES) {
    if (await dirHasTsx(projectDir, dir)) globs.push(glob);
  }
  // Next.js App Router co-locates route components under `app/`; ensure the
  // app glob is seeded even when `app/` was matched above (idempotent) and
  // bias toward it for next-app projects.
  if (router === 'next-app' && !globs.includes('app/**/*.tsx')) {
    if (await dirHasTsx(projectDir, 'app')) globs.unshift('app/**/*.tsx');
  }
  return globs.length > 0 ? globs : DEFAULT_COMPONENT_GLOBS;
}

export async function detectScaffoldInputs(projectDir: string): Promise<ScaffoldInputs> {
  const stack = await detectStack(projectDir);
  const packageManager = await detectPackageManager(projectDir);
  const devServerPort = stack.devServerPort ?? FALLBACK_PORT;

  // Next ships its own `next dev` binary; reactlens runs it directly rather
  // than the package-manager `dev` script so a freshly-detected Next project
  // works even before the user has wired a `dev` script. Every other build
  // tool defers to the package manager's `dev` script.
  const devCommand = stack.buildTool === 'next' ? 'next dev' : devCommandFor(packageManager);
  const componentGlobs = await detectComponentGlobs(projectDir, stack.router);

  return {
    devServerPort,
    devCommand,
    packageManager,
    baseURL: `http://localhost:${devServerPort}`,
    router: stack.router,
    reactVersion: stack.reactVersion,
    testDir: DEFAULT_TEST_DIR,
    componentGlobs,
  };
}
