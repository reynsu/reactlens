// TDD for the planted-failure applier (slice #12 of v0.3 #7).
//
// The applier takes a PlantedFailure recipe and a repo root, mutates
// the named file in-place, and throws loudly on any precondition that
// would silently produce a non-failing case. Loud throw is the whole
// point — per Principle 2, an eval case whose planted failure didn't
// actually plant is worse than no case at all because it pollutes
// the calibration baseline.
//
// Filesystem side-effect, but pure inputs: the repo root is just a
// path the caller manages. Each test writes a fake repo to a fresh
// mkdtempSync directory and asserts.
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  applyPlantedFailure,
  PlantedFailureFileNotFoundError,
  PlantedFailurePatternNotFoundError,
  PlantedFailurePatternAmbiguousError,
} from '../../src/eval/planted-failure-applier';
import type { PlantedFailure } from '../../src/eval/corpus-manifest';

// Create a fresh fake repo at a tmpdir and seed it with `files`
// (path → content). Returns the repo root absolute path.
function makeFakeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'reactlens-harvest-test-'));
  for (const [relPath, content] of Object.entries(files)) {
    const abs = join(root, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

describe('applyPlantedFailure — file-replace happy path', () => {
  it('replaces the exact substring and leaves surrounding bytes unchanged', () => {
    const root = makeFakeRepo({
      'src/Counter.tsx': 'export function add(c: number) { return c + 1; }\n',
    });
    const recipe: PlantedFailure = {
      kind: 'file-replace',
      path: 'src/Counter.tsx',
      oldString: 'c + 1',
      newString: 'c - 1',
      description: 'Increment regressed to decrement',
    };
    applyPlantedFailure(root, recipe);
    const after = readFileSync(join(root, 'src/Counter.tsx'), 'utf8');
    expect(after).toBe('export function add(c: number) { return c - 1; }\n');
  });

  it('only replaces inside the named file — siblings are untouched', () => {
    const root = makeFakeRepo({
      'src/Counter.tsx': 'count + 1',
      'src/OtherCounter.tsx': 'count + 1',
    });
    applyPlantedFailure(root, {
      kind: 'file-replace',
      path: 'src/Counter.tsx',
      oldString: 'count + 1',
      newString: 'count - 1',
      description: 'isolated change',
    });
    expect(readFileSync(join(root, 'src/Counter.tsx'), 'utf8')).toBe('count - 1');
    expect(readFileSync(join(root, 'src/OtherCounter.tsx'), 'utf8')).toBe('count + 1');
  });
});

describe('applyPlantedFailure — loud-throw preconditions', () => {
  it('throws PlantedFailureFileNotFoundError when path does not exist', () => {
    const root = makeFakeRepo({ 'src/Other.tsx': 'noop' });
    expect(() =>
      applyPlantedFailure(root, {
        kind: 'file-replace',
        path: 'src/Counter.tsx',
        oldString: 'a',
        newString: 'b',
        description: 'd',
      }),
    ).toThrow(PlantedFailureFileNotFoundError);
  });

  it('throws PlantedFailurePatternNotFoundError when oldString is absent from the file', () => {
    // Silent no-op would let the harvest emit a case whose component
    // file is unchanged — the "planted failure" never planted, and
    // the case records a passing test as a failing one. Loud throw.
    const root = makeFakeRepo({ 'src/Counter.tsx': 'count + 1' });
    expect(() =>
      applyPlantedFailure(root, {
        kind: 'file-replace',
        path: 'src/Counter.tsx',
        oldString: 'this string is not in the file',
        newString: 'whatever',
        description: 'd',
      }),
    ).toThrow(PlantedFailurePatternNotFoundError);
  });

  it('throws PlantedFailurePatternAmbiguousError when oldString matches more than once', () => {
    // Multiple matches are ambiguous: the applier doesn't know which
    // occurrence to replace, and silently replacing all of them would
    // produce a different planted change than the operator intended.
    // The fix is to widen oldString in the recipe (add surrounding
    // context until it's unique) — the error message guides them.
    const root = makeFakeRepo({
      'src/Counter.tsx': 'count + 1\nconst x = count + 1\n',
    });
    expect(() =>
      applyPlantedFailure(root, {
        kind: 'file-replace',
        path: 'src/Counter.tsx',
        oldString: 'count + 1',
        newString: 'count - 1',
        description: 'd',
      }),
    ).toThrow(PlantedFailurePatternAmbiguousError);
  });

  it('error messages name the path so the operator can fix the recipe without re-deriving', () => {
    const root = makeFakeRepo({ 'src/Counter.tsx': 'count + 1' });
    try {
      applyPlantedFailure(root, {
        kind: 'file-replace',
        path: 'src/Counter.tsx',
        oldString: 'absent string',
        newString: 'whatever',
        description: 'd',
      });
      throw new Error('did not throw');
    } catch (e) {
      expect(String(e)).toContain('src/Counter.tsx');
      expect(String(e)).toContain('absent string');
    }
  });
});
