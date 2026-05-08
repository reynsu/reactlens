import { execa } from 'execa';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gatherGitContext } from '../../src/analyzer/git-context';

let tmp: string;

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execa('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, stdio: 'ignore' });
}

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'reactlens-git-'));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('gatherGitContext', () => {
  it('returns empty object outside a git repo', async () => {
    const ctx = await gatherGitContext({ cwd: tmp, componentFile: 'a.tsx', specFile: 'b.spec.ts' });
    expect(ctx).toEqual({});
  });

  it('returns last-change info for files inside a git repo', async () => {
    await git(tmp, 'init');
    await writeFile(join(tmp, 'comp.tsx'), 'export const X = 1;');
    await git(tmp, 'add', 'comp.tsx');
    await git(tmp, 'commit', '-m', 'add comp');
    const ctx = await gatherGitContext({ cwd: tmp, componentFile: 'comp.tsx' });
    expect(ctx.componentLastChanged).toBeDefined();
    expect(ctx.componentLastChanged?.message).toBe('add comp');
  });

  it('returns undefined for files that do not exist', async () => {
    await git(tmp, 'init');
    const ctx = await gatherGitContext({ cwd: tmp, componentFile: 'missing.tsx' });
    expect(ctx.componentLastChanged).toBeUndefined();
  });
});
