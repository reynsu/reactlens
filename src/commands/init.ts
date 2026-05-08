import { promises as fs } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { execa } from 'execa';
import prompts from 'prompts';
import { detectStack, type DetectedStack } from '../ast/route-analyzer';
import { ReactLensError } from '../utils/errors';
import { logger } from '../utils/logger';
import { findTemplatesDir } from '../utils/paths';

export type InitOptions = {
  cwd: string;
  force: boolean;
  dryRun: boolean;
  installPlaywright: boolean;
  // Test seam: lets unit tests provide a deterministic answer instead of
  // pulling up a TTY prompt. When undefined we use the real `prompts` lib.
  confirmOverwrite?: (relPath: string) => Promise<boolean>;
};

type FilePlan = {
  source: string;
  dest: string;
  rel: string;
};

const FILE_LAYOUT: Array<{ template: string; destRel: string }> = [
  { template: 'playwright.config.ts', destRel: 'playwright.config.ts' },
  { template: 'reactlens.config.ts', destRel: 'reactlens.config.ts' },
  { template: 'streaming-reporter.ts', destRel: 'reactlens/streaming-reporter.ts' },
  { template: 'global-setup.ts', destRel: 'reactlens/global-setup.ts' },
  { template: 'fixtures.ts', destRel: 'reactlens/fixtures.ts' },
];

async function planFiles(opts: InitOptions): Promise<FilePlan[]> {
  const templatesDir = findTemplatesDir();
  return FILE_LAYOUT.map(({ template, destRel }) => {
    const dest = join(opts.cwd, destRel);
    return { source: join(templatesDir, template), dest, rel: relative(opts.cwd, dest) };
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

async function defaultConfirm(rel: string): Promise<boolean> {
  const answer = (await prompts({
    type: 'confirm',
    name: 'value',
    message: `Overwrite ${rel}?`,
    initial: false,
  })) as { value?: boolean };
  return answer.value === true;
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

async function copyOne(plan: FilePlan, opts: InitOptions): Promise<'wrote' | 'skipped' | 'would-write'> {
  const present = await exists(plan.dest);
  if (present && !opts.force) {
    const confirm = opts.confirmOverwrite ?? defaultConfirm;
    const ok = await confirm(plan.rel);
    if (!ok) return 'skipped';
  }
  if (opts.dryRun) {
    logger.info({ file: plan.rel }, present ? 'would overwrite' : 'would create');
    return 'would-write';
  }
  await fs.mkdir(dirname(plan.dest), { recursive: true });
  await fs.copyFile(plan.source, plan.dest);
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

async function detectPackageManager(cwd: string): Promise<'pnpm' | 'npm' | 'yarn'> {
  if (await exists(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await exists(join(cwd, 'yarn.lock'))) return 'yarn';
  return 'npm';
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
  await installDevDeps(opts, ['@playwright/test', 'msw']);
  await installPlaywrightChromium(opts);
  logger.info('reactlens init complete');
}
