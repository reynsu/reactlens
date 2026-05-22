// End-to-end packaging regression — replicates `npm install
// @reynsu/reactlens` from a clean fixture and exercises the surfaces
// that broke during the v0.3 release runbook:
//
//   - #25: dist CLI crashing on ESM-only @reynsu/* deps (covered by
//     `--version` from the installed binary)
//   - #29: templates pointing at the wrong scope (covered by the
//     subpath export resolutions, which prove the package.json
//     `exports` map publishes the correct paths)
//   - #34: bundled-CLI prompt-loader resolving `../src/<area>/...`
//     from `node_modules/@reynsu/reactlens/dist` (covered by the
//     `internal:probe-bundle` command, which loads every shipped
//     prompt without invoking the agent — so this runs in CI without
//     ANTHROPIC_API_KEY)
//
// Why tarball + npm (not pnpm link / pnpm install --filter): symlinks
// short-circuit the node_modules resolution that broke #25 and #29.
// Only a real tarball install replicates the user-from-npm path.
//
// Cost in CI: pnpm pack (~2s) + npm install of all runtime deps
// (~60-120s fresh, ~10-20s with cache). Generous timeouts on setup;
// per-test work is trivial.
import { execa } from 'execa';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '..', '..');

let installRoot = '';
let tarballPath = '';
let expectedVersion = '';

describe('tarball install replicates the user-from-npm path', () => {
  beforeAll(async () => {
    expectedVersion = (
      JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
        version: string;
      }
    ).version;

    // The tarball reflects whatever lives in dist/. Demand a build first
    // rather than silently rebuilding (CI workflow runs `pnpm build`
    // explicitly; local runs already do it via `pnpm test:integration`'s
    // workflow, but a missing dist/ would silently ship empty code).
    if (!existsSync(join(repoRoot, 'dist', 'cli.js'))) {
      throw new Error(
        'dist/cli.js missing — run `pnpm build` before `pnpm test:integration`.',
      );
    }

    // Pack into a tmpdir we own so afterAll can wipe it clean.
    const packDir = mkdtempSync(join(tmpdir(), 'reactlens-pack-'));
    await execa('pnpm', ['pack', '--pack-destination', packDir], {
      cwd: repoRoot,
    });
    const entries = readdirSync(packDir).filter((n) => n.endsWith('.tgz'));
    if (entries.length !== 1) {
      throw new Error(
        `expected exactly one .tgz under ${packDir}, found: ${JSON.stringify(entries)}`,
      );
    }
    tarballPath = join(packDir, entries[0]!);

    // Install the tarball into a fresh fixture using npm (the
    // realistic consumer path; pnpm would symlink and bypass the
    // resolution checks this test exists to enforce).
    installRoot = mkdtempSync(join(tmpdir(), 'reactlens-install-'));
    writeFileSync(
      join(installRoot, 'package.json'),
      `${JSON.stringify(
        {
          name: 'tarball-install-fixture',
          version: '0.0.0',
          private: true,
        },
        null,
        2,
      )}\n`,
    );
    await execa(
      'npm',
      ['install', '--no-audit', '--no-fund', '--ignore-scripts', tarballPath],
      { cwd: installRoot },
    );
  }, 240_000);

  afterAll(() => {
    if (installRoot !== '') rmSync(installRoot, { recursive: true, force: true });
    if (tarballPath !== '') rmSync(dirname(tarballPath), { recursive: true, force: true });
  });

  it('the installed CLI runs --version without a module-resolution crash (#25)', async () => {
    const binPath = join(installRoot, 'node_modules', '.bin', 'reactlens');
    const { stdout, exitCode } = await execa(binPath, ['--version'], {
      reject: false,
    });
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(expectedVersion);
  });

  it('@reynsu/reactlens/component-object subpath resolves via CJS require (#29)', async () => {
    const script = [
      "const m = require('@reynsu/reactlens/component-object');",
      "if (typeof m.Component !== 'function') throw new Error('Component missing');",
      "if (typeof m.bindTestId !== 'function') throw new Error('bindTestId missing');",
      "console.log('ok');",
    ].join('\n');
    const { stdout } = await execa('node', ['-e', script], { cwd: installRoot });
    expect(stdout.trim()).toBe('ok');
  });

  it('@reynsu/reactlens/component-object subpath resolves via ESM import (#29)', async () => {
    const script = [
      "import('@reynsu/reactlens/component-object').then((m) => {",
      "  if (typeof m.Component !== 'function') throw new Error('Component missing');",
      "  if (typeof m.bindTestId !== 'function') throw new Error('bindTestId missing');",
      "  console.log('ok');",
      "}).catch((err) => { console.error(err.message); process.exit(1); });",
    ].join('\n');
    const { stdout } = await execa('node', ['-e', script], { cwd: installRoot });
    expect(stdout.trim()).toBe('ok');
  });

  it('internal:probe-bundle loads every shipped prompt from the installed package (#34)', async () => {
    const binPath = join(installRoot, 'node_modules', '.bin', 'reactlens');
    const { stdout, exitCode } = await execa(binPath, ['internal:probe-bundle'], {
      reject: false,
    });
    expect(exitCode).toBe(0);

    // The action writes exactly one JSON line. If a stray logger.info
    // ever sneaks in, take the last `{`-prefixed line so this stays
    // robust without coupling to logger config.
    const lines = stdout.trim().split('\n');
    const jsonLine = [...lines].reverse().find((line) => line.trim().startsWith('{'));
    if (jsonLine === undefined) {
      throw new Error(`no JSON line in stdout: ${JSON.stringify(stdout)}`);
    }
    const result = JSON.parse(jsonLine) as {
      ok: boolean;
      version: string;
      prompts: { area: string; name: string; bytes: number }[];
    };

    expect(result.ok).toBe(true);
    expect(result.version).toBe(expectedVersion);
    expect(result.prompts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          area: 'generator',
          name: 'generate-suite.md',
        }),
        expect.objectContaining({
          area: 'generator',
          name: 'generate-suite-component-object.md',
        }),
      ]),
    );
    for (const prompt of result.prompts) {
      expect(prompt.bytes).toBeGreaterThan(0);
    }
  });
});
