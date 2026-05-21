// Regression test for the dist CJS/ESM mismatch bug.
//
// Symptom (pre-fix): `node bin/reactlens.js --version` crashed with
//   ERR_PACKAGE_PATH_NOT_EXPORTED because dist/cli.js (CJS) tried to
//   require() the ESM-only @reynsu/reactlens-diagnosis-prompts package.
//
// Exercises the published surface — the same code path a user installing
// `@reynsu/reactlens` from npm would hit. Assumes `pnpm build` has run.
import { execa } from 'execa';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '..', '..');
const binPath = join(repoRoot, 'bin', 'reactlens.js');
const distCli = join(repoRoot, 'dist', 'cli.js');

function assertBuilt(): void {
  if (!existsSync(distCli)) {
    throw new Error(
      `dist/cli.js missing — run \`pnpm build\` before \`pnpm test:integration\`.`,
    );
  }
}

describe('built CLI smoke', () => {
  it('runs --version without a module-resolution crash', async () => {
    assertBuilt();
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      version: string;
    };
    const { stdout, exitCode } = await execa('node', [binPath, '--version'], {
      reject: false,
    });
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(pkg.version);
  });

  it('runs --help without crashing', async () => {
    assertBuilt();
    const { stdout, exitCode } = await execa('node', [binPath, '--help'], {
      reject: false,
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('reactlens');
    expect(stdout).toContain('generate');
    expect(stdout).toContain('run');
  });
});
