import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runInit } from './commands/init';
import { ReactLensError } from './utils/errors';
import { logger } from './utils/logger';

type StubName = 'generate' | 'run' | 'analyze' | 'regen';

function readPackageVersion(): string {
  const pkgPath = join(__dirname, '..', 'package.json');
  const raw = readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(raw) as { version?: string };
  return pkg.version ?? '0.0.0';
}

function stub(name: StubName): () => void {
  return () => {
    process.stdout.write(`${name} not yet implemented\n`);
  };
}

function buildProgram(): Command {
  const program = new Command();
  program
    .name('reactlens')
    .description('E2E testing for React that understands your component tree.')
    .version(readPackageVersion(), '-v, --version', 'print the reactlens version');

  program
    .command('init')
    .description('scaffold reactlens in the current project')
    .option('--cwd <path>', 'directory to scaffold into', process.cwd())
    .option('-f, --force', 'overwrite existing files without prompting', false)
    .option('--dry-run', 'list what would happen without writing', false)
    .option('--no-install-playwright', 'skip downloading the chromium browser')
    .action(async (opts: { cwd: string; force: boolean; dryRun: boolean; installPlaywright: boolean }) => {
      await runInit({
        cwd: resolve(opts.cwd),
        force: opts.force,
        dryRun: opts.dryRun,
        installPlaywright: opts.installPlaywright,
      });
    });

  program.command('generate').description('generate tests by analyzing components').action(stub('generate'));
  program.command('run').description('run tests with the live dashboard').action(stub('run'));
  program.command('analyze').description('diagnose a Playwright report').action(stub('analyze'));
  program.command('regen').description('regenerate tests for changed components').action(stub('regen'));

  return program;
}

async function main(argv: readonly string[]): Promise<number> {
  const program = buildProgram();
  try {
    await program.parseAsync(argv as string[]);
    return 0;
  } catch (err) {
    if (err instanceof ReactLensError) {
      logger.error({ code: err.code, helpUrl: err.helpUrl }, err.message);
      return 1;
    }
    logger.error({ err }, 'unexpected error');
    return 2;
  }
}

void main(process.argv).then((code) => {
  process.exit(code);
});
