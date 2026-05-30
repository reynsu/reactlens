import { promises as fs } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { execa } from 'execa';
import { detectStack, type DetectedStack } from '../ast/route-analyzer';
import { detectScaffoldInputs } from '../scaffold/detect-scaffold-inputs';
import { renderPlaywrightConfig } from '../scaffold/render-playwright-config';
import { renderReactlensConfig } from '../scaffold/render-reactlens-config';
import { detectPackageManager } from '../utils/package-manager';
import { ReactLensError } from '../utils/errors';
import { logger } from '../utils/logger';
import { findTemplatesDir } from '../utils/paths';

export type InitOptions = {
  cwd: string;
  force: boolean;
  dryRun: boolean;
  installPlaywright: boolean;
  // Test seam (#70): observe each Scaffold file as it is (over)written. The
  // Scaffold is reactlens-owned, so re-init rewrites it unconditionally with
  // no interactive prompt — this callback exists purely so unit tests can
  // assert which files were touched without filesystem mocking. It NEVER
  // gates the write: returning anything is ignored.
  confirmOverwrite?: (relPath: string) => Promise<void>;
};

type FilePlan = {
  source: string;
  dest: string;
  rel: string;
  // When set, init writes this function's output instead of copying `source`
  // verbatim. Used for playwright.config.ts, whose contents are interpolated
  // from the detected stack at write time (ADR-0010).
  render?: (cwd: string) => Promise<string>;
};

const FILE_LAYOUT: Array<{ template: string; destRel: string; render?: (cwd: string) => Promise<string> }> = [
  {
    template: 'playwright.config.ts',
    destRel: 'playwright.config.ts',
    render: async (cwd) => renderPlaywrightConfig(await detectScaffoldInputs(cwd)),
  },
  {
    template: 'reactlens.config.ts',
    destRel: 'reactlens.config.ts',
    render: async (cwd) => renderReactlensConfig(await detectScaffoldInputs(cwd)),
  },
  { template: 'streaming-reporter.ts', destRel: 'reactlens/streaming-reporter.ts' },
  { template: 'global-setup.ts', destRel: 'reactlens/global-setup.ts' },
  { template: 'fixtures.ts', destRel: 'reactlens/fixtures.ts' },
  // v0.3 slice 6: the Component-Object runtime helper. fixtures.ts imports
  // it relatively (`./component-object`) and re-exports Component + errors
  // so user specs can do `import { test, expect, Component } from
  // '../../reactlens/fixtures'`.
  { template: 'component-object.ts', destRel: 'reactlens/component-object.ts' },
];

async function planFiles(opts: InitOptions): Promise<FilePlan[]> {
  const templatesDir = findTemplatesDir();
  return FILE_LAYOUT.map(({ template, destRel, render }) => {
    const dest = join(opts.cwd, destRel);
    return { source: join(templatesDir, template), dest, rel: relative(opts.cwd, dest), render };
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

function printDetectedStack(stack: DetectedStack): void {
  logger.info(
    {
      router: stack.router,
      buildTool: stack.buildTool,
      reactVersion: stack.reactVersion,
      formLibrary: stack.formLibrary,
      uiLibrary: stack.uiLibrary,
      devServerPort: stack.devServerPort,
    },
    'detected stack',
  );
}

// Writes one reactlens-owned Scaffold file. The Scaffold tracks the installed
// reactlens version + the Detected stack, so re-init rewrites it
// unconditionally — there is NO interactive per-file overwrite prompt (#70).
// `--force` is therefore a no-op for Scaffold files (kept for CLI back-compat).
// init only ever writes within FILE_LAYOUT; it never touches user-owned files
// (app entry, specs, app code).
async function copyOne(plan: FilePlan, opts: InitOptions): Promise<'wrote' | 'would-write'> {
  const present = await exists(plan.dest);
  // Observation seam (#70): lets tests assert which Scaffold files were
  // (re)written. It cannot veto the write — the Scaffold is reactlens-owned.
  if (opts.confirmOverwrite) await opts.confirmOverwrite(plan.rel);
  if (opts.dryRun) {
    logger.info({ file: plan.rel }, present ? 'would overwrite' : 'would create');
    return 'would-write';
  }
  await fs.mkdir(dirname(plan.dest), { recursive: true });
  if (plan.render) {
    await fs.writeFile(plan.dest, await plan.render(opts.cwd));
  } else {
    await fs.copyFile(plan.source, plan.dest);
  }
  logger.info({ file: plan.rel }, present ? 'overwrote' : 'created');
  return 'wrote';
}

async function installDevDeps(opts: InitOptions, deps: string[]): Promise<void> {
  if (opts.dryRun) {
    logger.info({ deps }, 'would install dev deps');
    return;
  }
  const pm = await detectPackageManager(opts.cwd);
  const args: string[] = pm === 'pnpm' ? ['add', '-D', ...deps] : ['install', '-D', ...deps];
  logger.info({ pm, deps }, 'installing dev deps');
  await execa(pm, args, { cwd: opts.cwd, stdio: 'inherit' });
}

async function installPlaywrightChromium(opts: InitOptions): Promise<void> {
  if (opts.dryRun) {
    logger.info('would run: npx playwright install chromium');
    return;
  }
  if (!opts.installPlaywright) {
    logger.info('skipping playwright browser install (--no-install-playwright)');
    return;
  }
  await execa('npx', ['playwright', 'install', 'chromium'], { cwd: opts.cwd, stdio: 'inherit' });
}

export async function runInit(opts: InitOptions): Promise<void> {
  if (!(await exists(join(opts.cwd, 'package.json')))) {
    throw new ReactLensError(`no package.json found at ${opts.cwd}`, {
      code: 'INIT_NO_PACKAGE_JSON',
    });
  }
  const stack = await detectStack(opts.cwd);
  printDetectedStack(stack);
  const plans = await planFiles(opts);
  for (const plan of plans) {
    await copyOne(plan, opts);
  }
  // The scaffold's reactlens/fixtures.ts + component-object.ts import `ws`
  // directly (the probe transport runs in the user's Node context, resolving
  // from the user's node_modules), so a freshly-init'd project needs `ws`
  // present or `reactlens run` fails with "Cannot find package 'ws'".
  await installDevDeps(opts, ['@playwright/test', 'ws', '@types/ws']);
  await installPlaywrightChromium(opts);
  logger.info('reactlens init complete');
}
