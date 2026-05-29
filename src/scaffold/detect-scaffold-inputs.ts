// Deep, pure resolver that turns a project directory into the concrete
// values the playwright.config scaffold needs (ADR-0010: interpolate the
// Detected stack at write time instead of copying the template verbatim).
//
// Wraps `detectStack` (build tool → port) and `detectPackageManager`
// (lockfile → pm). Spawns no process: every input is read off disk, so the
// result is a pure function of the project's package.json + lockfiles +
// marker files. That purity is what makes `renderPlaywrightConfig` testable
// as byte-stable input → output.
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
};

// Fallback when the build tool is unknown (no vite/next signal). Vite's
// default dev port is the most common React-app default, so it is the least
// surprising guess and keeps the generated config runnable.
const FALLBACK_PORT = 5173;
const DEFAULT_TEST_DIR = 'e2e/specs';

export async function detectScaffoldInputs(projectDir: string): Promise<ScaffoldInputs> {
  const stack = await detectStack(projectDir);
  const packageManager = await detectPackageManager(projectDir);
  const devServerPort = stack.devServerPort ?? FALLBACK_PORT;

  // Next ships its own `next dev` binary; reactlens runs it directly rather
  // than the package-manager `dev` script so a freshly-detected Next project
  // works even before the user has wired a `dev` script. Every other build
  // tool defers to the package manager's `dev` script.
  const devCommand = stack.buildTool === 'next' ? 'next dev' : devCommandFor(packageManager);

  return {
    devServerPort,
    devCommand,
    packageManager,
    baseURL: `http://localhost:${devServerPort}`,
    router: stack.router,
    reactVersion: stack.reactVersion,
    testDir: DEFAULT_TEST_DIR,
  };
}
