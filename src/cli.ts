import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runAnalyze } from './commands/analyze';
import { runDiff } from './commands/diff';
import { runEvalAddFromLastFailure } from './commands/eval-add-from-last-failure';
import { runGenerate } from './commands/generate';
import { runInit } from './commands/init';
import { runInternalProbeBundle } from './commands/internal-probe-bundle';
import { runRegen } from './commands/regen';
import { runRun } from './commands/run';
import { ReactLensError } from './utils/errors';
import { logger } from './utils/logger';

function parsePattern(raw: string): 'pom' | 'component-object' {
  if (raw === 'pom' || raw === 'component-object') return raw;
  throw new ReactLensError(
    `--pattern must be 'pom' or 'component-object', got: ${JSON.stringify(raw)}`,
    { code: 'INVALID_PATTERN_FLAG' },
  );
}

function readPackageVersion(): string {
  const pkgPath = join(__dirname, '..', 'package.json');
  const raw = readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(raw) as { version?: string };
  return pkg.version ?? '0.0.0';
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
    .option('-f, --force', 'deprecated no-op: re-init always overwrites the reactlens-owned scaffold', false)
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

  program
    .command('generate')
    .description('generate tests by analyzing components')
    .option('--cwd <path>', 'project directory', process.cwd())
    .option('--pages <glob>', 'limit generation to a subset of components')
    .option('--skip-typecheck', 'skip running tsc on generated tests', false)
    .option('--use-claude-code', 'require the local Claude CLI (subscription billing); fail if not installed', false)
    .option('--force-api', 'force ANTHROPIC_API_KEY billing, bypassing any local Claude Code subscription', false)
    .option('--max-cost <usd>', 'abort the command once aggregate cost crosses this USD value', parseFloat)
    .option('--pattern <kind>', 'override config.pattern: pom | component-object', parsePattern)
    .action(async (opts: { cwd: string; pages?: string; skipTypecheck: boolean; useClaudeCode: boolean; forceApi: boolean; maxCost?: number; pattern?: 'pom' | 'component-object' }) => {
      const code = await runGenerate({
        cwd: opts.cwd,
        pages: opts.pages,
        skipTypecheck: opts.skipTypecheck,
        useClaudeCode: opts.useClaudeCode,
        forceApi: opts.forceApi,
        ...(opts.maxCost !== undefined ? { maxCost: opts.maxCost } : {}),
        ...(opts.pattern !== undefined ? { pattern: opts.pattern } : {}),
      });
      process.exitCode = code;
    });
  program
    .command('run')
    .description('run tests with the live dashboard')
    .argument('[specPaths...]', 'optional spec file path(s) — only matching specs run (forwarded to `playwright test`)')
    .option('--cwd <path>', 'project directory', process.cwd())
    .option('--reporter <kind>', 'text | json', 'text')
    .option('--skip-web-server', 'do not auto-start the user webServer', false)
    .option('--no-dashboard', 'run headlessly without the dashboard server')
    .option('--no-open', 'do not auto-open the dashboard in a browser')
    .option('--no-analyze', 'skip Claude diagnosis of failed tests')
    .option('--ci', 'CI mode: no dashboard, no auto-open, JUnit-friendly output', false)
    .option('--use-claude-code', 'require the local Claude CLI for diagnosis (subscription billing); fail if not installed', false)
    .option('--force-api', 'force ANTHROPIC_API_KEY billing for diagnosis, bypassing any local Claude Code subscription', false)
    .option('--save-snapshots-to <dir>', 'write per-test component snapshots (one <testId>.json + manifest.json) into <dir> after the run')
    .option('--max-cost <usd>', 'abort the command once aggregate cost crosses this USD value', parseFloat)
    .option('--watch', 'after the initial run, re-run on changes under <cwd>/src and <cwd>/e2e (P10)', false)
    .action(async (specPaths: string[], opts: { cwd: string; reporter: string; skipWebServer: boolean; dashboard: boolean; open: boolean; analyze: boolean; ci: boolean; useClaudeCode: boolean; forceApi: boolean; saveSnapshotsTo?: string; maxCost?: number; watch: boolean }) => {
      const reporter = opts.reporter === 'json' ? 'json' : 'text';
      const code = await runRun({
        cwd: opts.cwd,
        reporter,
        skipWebServer: opts.skipWebServer,
        noDashboard: opts.ci || !opts.dashboard,
        open: opts.ci ? false : opts.open,
        noAnalyze: !opts.analyze,
        ci: opts.ci,
        useClaudeCode: opts.useClaudeCode,
        ...(specPaths.length > 0 ? { specPaths } : {}),
        forceApi: opts.forceApi,
        watch: opts.watch,
        ...(opts.saveSnapshotsTo !== undefined ? { saveSnapshotsTo: opts.saveSnapshotsTo } : {}),
        ...(opts.maxCost !== undefined ? { maxCost: opts.maxCost } : {}),
      });
      process.exitCode = code;
    });
  program
    .command('analyze')
    .description('diagnose a Playwright JSON report and write a Markdown summary')
    .argument('<report>', 'path to the Playwright JSON report')
    .option('--cwd <path>', 'project directory', process.cwd())
    .option('--out <file>', 'write Markdown to this file instead of stdout')
    .option('--use-claude-code', 'require the local Claude CLI (subscription billing); fail if not installed', false)
    .option('--force-api', 'force ANTHROPIC_API_KEY billing, bypassing any local Claude Code subscription', false)
    .option('--max-cost <usd>', 'abort the command once aggregate cost crosses this USD value', parseFloat)
    .action(async (report: string, opts: { cwd: string; out?: string; useClaudeCode: boolean; forceApi: boolean; maxCost?: number }) => {
      const code = await runAnalyze({
        cwd: opts.cwd,
        reportPath: report,
        outFile: opts.out,
        useClaudeCode: opts.useClaudeCode,
        forceApi: opts.forceApi,
        ...(opts.maxCost !== undefined ? { maxCost: opts.maxCost } : {}),
      });
      process.exitCode = code;
    });
  program
    .command('diff')
    .description('semantic diff between two persisted runs (P12)')
    .argument('<runIdA>', 'baseline run id (under .reactlens/runs)')
    .argument('<runIdB>', 'comparison run id (under .reactlens/runs)')
    .option('--cwd <path>', 'project directory', process.cwd())
    .option('--json', 'emit SemanticDiff[] as JSON instead of text', false)
    .action(async (runIdA: string, runIdB: string, opts: { cwd: string; json: boolean }) => {
      const code = await runDiff({ cwd: opts.cwd, runIdA, runIdB, json: opts.json });
      process.exitCode = code;
    });
  program
    .command('regen')
    .description('regenerate tests for changed components')
    .option('--cwd <path>', 'project directory', process.cwd())
    .option('--use-claude-code', 'require the local Claude CLI (subscription billing); fail if not installed', false)
    .option('--force-api', 'force ANTHROPIC_API_KEY billing, bypassing any local Claude Code subscription', false)
    .option('--max-cost <usd>', 'abort the command once aggregate cost crosses this USD value', parseFloat)
    .option('--pattern <kind>', 'override config.pattern: pom | component-object', parsePattern)
    .action(async (opts: { cwd: string; useClaudeCode: boolean; forceApi: boolean; maxCost?: number; pattern?: 'pom' | 'component-object' }) => {
      const code = await runRegen({
        cwd: opts.cwd,
        useClaudeCode: opts.useClaudeCode,
        forceApi: opts.forceApi,
        ...(opts.maxCost !== undefined ? { maxCost: opts.maxCost } : {}),
        ...(opts.pattern !== undefined ? { pattern: opts.pattern } : {}),
      });
      process.exitCode = code;
    });

  // `reactlens eval` — eval-set tooling (slice #15 of v0.3 #7).
  // Subcommands live under this parent so future eval helpers
  // (export-baseline, etc.) can land without polluting the top level.
  const evalCmd = program.command('eval').description('eval-set tooling (harvest, dogfood, baseline)');
  evalCmd
    .command('add-from-last-failure')
    .description('turn the most recent failing test from .reactlens/runs/ into a stub eval case under synthetic-from-corpus/dogfood/')
    .option('--cwd <path>', 'project directory', process.cwd())
    .action(async (opts: { cwd: string }) => {
      const code = await runEvalAddFromLastFailure({ cwd: opts.cwd });
      process.exitCode = code;
    });

  // Maintainer/CI probe — verifies every prompt that ships in the
  // bundled package can be loaded by the agent-bearing path. Hidden
  // from --help by the `internal:` prefix convention (commander has
  // no native hide flag for subcommands prior to v13). Emits a single
  // JSON line to stdout; exits 1 if any prompt fails to load. Wired
  // by tests/integration/tarball-install.test.ts.
  program
    .command('internal:probe-bundle')
    .description('internal: verify bundled artifacts load from this install (CI/maintainers)')
    .action(async () => {
      const result = await runInternalProbeBundle({ version: readPackageVersion() });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.exitCode = result.ok ? 0 : 1;
    });

  return program;
}

async function main(argv: readonly string[]): Promise<number> {
  const program = buildProgram();
  try {
    await program.parseAsync(argv as string[]);
    return 0;
  } catch (err) {
    if (err instanceof ReactLensError) {
      // helpUrl is surfaced both as structured metadata (for JSON logger
      // consumers) AND inline in the message so a human reading stderr can
      // jump straight to the remediation page without scanning fields.
      const message = err.helpUrl !== undefined ? `${err.message}\n  see: ${err.helpUrl}` : err.message;
      logger.error({ code: err.code, helpUrl: err.helpUrl }, message);
      return 1;
    }
    logger.error({ err }, 'unexpected error');
    return 2;
  }
}

void main(process.argv).then((code) => {
  process.exit(code);
});
