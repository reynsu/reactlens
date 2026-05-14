import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ensureGitignore } from '../../src/utils/paths';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'reactlens-gitignore-'));
});

describe('ensureGitignore', () => {
  it('creates the parent dir and writes a wildcard .gitignore when none exists', async () => {
    const target = join(dir, 'fresh-subdir');
    await ensureGitignore(target);
    const content = await readFile(join(target, '.gitignore'), 'utf8');
    expect(content.trimEnd()).toBe('*');
  });

  it('leaves an existing .gitignore untouched (no clobbering user edits)', async () => {
    const existing = '# user notes\n!important.json\n';
    await writeFile(join(dir, '.gitignore'), existing);
    await ensureGitignore(dir);
    expect(await readFile(join(dir, '.gitignore'), 'utf8')).toBe(existing);
  });

  it('is idempotent — repeated calls do not throw or change the file', async () => {
    await ensureGitignore(dir);
    await ensureGitignore(dir);
    await ensureGitignore(dir);
    const content = await readFile(join(dir, '.gitignore'), 'utf8');
    expect(content.trimEnd()).toBe('*');
  });
});
