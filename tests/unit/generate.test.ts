import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runGenerate } from '../../src/commands/generate';
import { ReactLensError } from '../../src/utils/errors';

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'reactlens-generate-'));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('generate — no components matched', () => {
  it('throws GENERATE_NO_COMPONENTS naming the unmatched globs', async () => {
    // Empty cwd + an explicit --pages pattern that matches nothing. This must
    // throw a typed ReactLensError BEFORE any agent is acquired, so the test
    // needs no credentials.
    const err = await runGenerate({
      cwd: tmp,
      pages: 'src/does-not-exist/**/*.tsx',
    }).then(
      () => {
        throw new Error('expected runGenerate to throw, but it resolved');
      },
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(ReactLensError);
    const rle = err as ReactLensError;
    expect(rle.code).toBe('GENERATE_NO_COMPONENTS');
    // Message names the offending glob and points at config.
    expect(rle.message).toContain('src/does-not-exist/**/*.tsx');
    expect(rle.message).toContain('componentGlobs');
  });
});
