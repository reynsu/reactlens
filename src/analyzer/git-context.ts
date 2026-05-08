// Gathers git history for the files involved in a failure. Diagnosis uses
// this to anchor confidence: if the spec just changed but the component
// hasn't, that points to a test-bug; vice versa for a real-bug.
import { execa } from 'execa';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export type GitChange = { sha: string; author: string; date: string; message: string };

export type GitContext = {
  componentLastChanged?: GitChange;
  specLastChanged?: GitChange;
};

async function isInGitRepo(cwd: string): Promise<boolean> {
  try {
    const { exitCode } = await execa('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd,
      reject: false,
    });
    return exitCode === 0;
  } catch {
    return false;
  }
}

async function lastChange(cwd: string, file: string): Promise<GitChange | undefined> {
  if (!existsSync(file)) return undefined;
  try {
    const { stdout, exitCode } = await execa(
      'git',
      ['log', '-1', '--pretty=format:%H%x09%an%x09%aI%x09%s', '--', file],
      { cwd, reject: false },
    );
    if (exitCode !== 0 || stdout.trim().length === 0) return undefined;
    const [sha, author, date, ...rest] = stdout.split('\t');
    if (sha === undefined || author === undefined || date === undefined) return undefined;
    return { sha, author, date, message: rest.join('\t') };
  } catch {
    return undefined;
  }
}

export async function gatherGitContext(opts: {
  cwd: string;
  componentFile?: string;
  specFile?: string;
}): Promise<GitContext> {
  const cwd = resolve(opts.cwd);
  if (!(await isInGitRepo(cwd))) return {};
  const out: GitContext = {};
  if (opts.componentFile !== undefined) {
    const f = isAbsolute(opts.componentFile) ? opts.componentFile : join(cwd, opts.componentFile);
    out.componentLastChanged = await lastChange(cwd, f);
  }
  if (opts.specFile !== undefined) {
    const f = isAbsolute(opts.specFile) ? opts.specFile : join(cwd, opts.specFile);
    out.specLastChanged = await lastChange(cwd, f);
  }
  return out;
}

// Helper for tests: useful to build small fake repos.
export const _internal = { isInGitRepo, lastChange, dirname };
