import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runInit } from './commands/init';
import { runRun } from './commands/run';
import { ReactLensError } from './utils/errors';
import { logger } from './utils/logger';

type StubName = 'generate' | 'analyze' | 'regen';

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
  program
    .command('run')
    .description('run tests with the live dashboard')
    .option('--cwd <path>', 'project directory', process.cwd())
    .option('--reporter <kind>', 'text | json', 'text')
    .option('--skip-web-server', 'do not auto-start the user webServer', false)
    .option('--no-dashboard', 'run headlessly without the dashboard server')
    .option('--no-open', 'do not auto-open the dashboard in a browser')
    .action(async (opts: { cwd: string; reporter: string; skipWebServer: boolean; dashboard: boolean; open: boolean }) => {
      const reporter = opts.reporter === 'json' ? 'json' : 'text';
      const code = await runRun({
        cwd: opts.cwd,
        reporter,
        skipWebServer: opts.skipWebServer,
        noDashboard: !opts.dashboard,
        open: opts.open,
      });
      process.exitCode = code;
    });
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
