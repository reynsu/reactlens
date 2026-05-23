// Module Interface tests for CorpusSource (HarvestSource adapter).
//
// The end-to-end real-fixture exercise lives in
// tests/integration/harvest-eval.test.ts (it consumes the runHarvest
// wrapper in scripts/harvest-eval.ts). This file covers the things
// that wrapper sits ON TOP OF:
//   - iterate() yields one artifact per successfully processed entry
//   - describeWhyEmpty() distinguishes manifest-empty vs entry-name-no-match
//   - getSkippedEntries() records per-entry plant failures without
//     aborting the whole sweep
//   - the Source does NOT write to disk during iterate (per HarvestSource
//     design pick (i))
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HarvestArtifacts } from '../../src/eval/harvest-source';
import { CorpusSource } from '../../src/eval/corpus-source';

function freshRepo(): string {
  return mkdtempSync(join(tmpdir(), 'reactlens-corpus-test-'));
}

// Seeds a local-fixture corpus entry: a synthetic source tree + a
// harvest-corpus.json that points at it with a file-replace plant.
function seedFixtureCorpus(repoRoot: string, entryName: string): string {
  const fixtureDir = join(repoRoot, 'fixtures', entryName);
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(
    join(fixtureDir, 'Counter.tsx'),
    `import { useState } from 'react';\nexport function Counter() {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(count + 1)}>{count}</button>;\n}\n`,
  );
  writeFileSync(
    join(fixtureDir, 'spec.ts'),
    `import { test, expect } from '@playwright/test';\ntest('counter increments', async ({ page }) => { /* synthetic */ });\n`,
  );
  const manifestPath = join(repoRoot, 'harvest-corpus.json');
  writeFileSync(
    manifestPath,
    JSON.stringify({
      entries: [
        {
          name: entryName,
          localFixturePath: `fixtures/${entryName}`,
          candidateComponent: 'Counter.tsx',
          candidateSpec: 'spec.ts',
          plantedFailure: {
            kind: 'file-replace',
            path: 'Counter.tsx',
            oldString: 'setCount(count + 1)',
            newString: 'setCount(count - 1)',
            description: 'increment regressed to decrement',
          },
        },
      ],
    }),
  );
  return manifestPath;
}

async function collect(source: CorpusSource): Promise<HarvestArtifacts[]> {
  const out: HarvestArtifacts[] = [];
  for await (const art of source.iterate()) out.push(art);
  return out;
}

describe('CorpusSource — iterate yields one artifact per entry', () => {
  it('yields a single HarvestArtifacts for a single-entry corpus', async () => {
    const repoRoot = freshRepo();
    seedFixtureCorpus(repoRoot, 'counter-fixture');
    const source = new CorpusSource({ repoRoot });
    const artifacts = await collect(source);

    expect(artifacts).toHaveLength(1);
    const m = artifacts[0]!.manifest;
    expect(m.entryName).toBe('counter-fixture');
    expect(m.sourceMode).toBe('local-fixture');
    expect(m.plantedFailure?.kind).toBe('file-replace');
  });

  it('reads the planted (failing) component source into componentSrc', async () => {
    const repoRoot = freshRepo();
    seedFixtureCorpus(repoRoot, 'counter-fixture');
    const source = new CorpusSource({ repoRoot });
    const [art] = await collect(source);
    // The recipe replaced count + 1 with count - 1. If the plant didn't
    // happen, the artifact ships the passing code, which is the
    // calibration poison Principle 2 forbids.
    expect(art!.componentSrc).toContain('setCount(count - 1)');
    expect(art!.componentSrc).not.toContain('setCount(count + 1)');
  });

  it('reads the spec source into specSrc unchanged', async () => {
    const repoRoot = freshRepo();
    seedFixtureCorpus(repoRoot, 'counter-fixture');
    const source = new CorpusSource({ repoRoot });
    const [art] = await collect(source);
    expect(art!.specSrc).toContain("test('counter increments'");
  });

  it('filters to the matching entry when entryName is set', async () => {
    const repoRoot = freshRepo();
    // Two entries — only one matches the filter.
    seedFixtureCorpus(repoRoot, 'counter-fixture-a');
    // Append a second entry to the same manifest.
    const fixtureDir = join(repoRoot, 'fixtures', 'counter-fixture-b');
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(join(fixtureDir, 'X.tsx'), 'export const X = () => null;\n');
    writeFileSync(join(fixtureDir, 's.ts'), 'test("x", () => {});\n');
    writeFileSync(
      join(repoRoot, 'harvest-corpus.json'),
      JSON.stringify({
        entries: [
          {
            name: 'counter-fixture-a',
            localFixturePath: 'fixtures/counter-fixture-a',
            candidateComponent: 'Counter.tsx',
            candidateSpec: 'spec.ts',
            plantedFailure: {
              kind: 'file-replace',
              path: 'Counter.tsx',
              oldString: 'setCount(count + 1)',
              newString: 'setCount(count - 1)',
              description: 'a',
            },
          },
          {
            name: 'counter-fixture-b',
            localFixturePath: 'fixtures/counter-fixture-b',
            candidateComponent: 'X.tsx',
            candidateSpec: 's.ts',
            plantedFailure: {
              kind: 'file-replace',
              path: 'X.tsx',
              oldString: 'null',
              newString: 'true',
              description: 'b',
            },
          },
        ],
      }),
    );

    const source = new CorpusSource({ repoRoot, entryName: 'counter-fixture-b' });
    const artifacts = await collect(source);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]!.manifest.entryName).toBe('counter-fixture-b');
  });
});

describe('CorpusSource — describeWhyEmpty', () => {
  it('returns null when at least one artifact was yielded', async () => {
    const repoRoot = freshRepo();
    seedFixtureCorpus(repoRoot, 'counter-fixture');
    const source = new CorpusSource({ repoRoot });
    await collect(source);
    expect(source.describeWhyEmpty()).toBeNull();
  });

  it('throws (via Zod) when the corpus has zero entries — schema-level operator-error guard', async () => {
    // CorpusManifestSchema rejects empty `entries` at parse time. The
    // Source never gets to describeWhyEmpty for this case — schema
    // throws first. This test pins that contract so an attempt to
    // "fix" the throw by zero-iterating silently would surface here.
    const repoRoot = freshRepo();
    writeFileSync(join(repoRoot, 'harvest-corpus.json'), JSON.stringify({ entries: [] }));
    const source = new CorpusSource({ repoRoot });
    await expect(collect(source)).rejects.toThrow();
  });

  it('returns "entry-name-no-match" when --entry filters to zero matches', async () => {
    const repoRoot = freshRepo();
    seedFixtureCorpus(repoRoot, 'counter-fixture');
    const source = new CorpusSource({ repoRoot, entryName: 'does-not-exist' });
    const artifacts = await collect(source);
    expect(artifacts).toEqual([]);
    expect(source.describeWhyEmpty()).toBe('entry-name-no-match');
  });

  it('returns null before iterate() has been called', async () => {
    const repoRoot = freshRepo();
    seedFixtureCorpus(repoRoot, 'counter-fixture');
    const source = new CorpusSource({ repoRoot });
    expect(source.describeWhyEmpty()).toBeNull();
  });
});

describe('CorpusSource — getSkippedEntries records per-entry failures', () => {
  it('records the failure reason when planting fails (oldString not found)', async () => {
    const repoRoot = freshRepo();
    const fixtureDir = join(repoRoot, 'fixtures', 'broken');
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(join(fixtureDir, 'Counter.tsx'), 'export const Counter = () => null;\n');
    writeFileSync(join(fixtureDir, 'spec.ts'), 'test("x", () => {});\n');
    writeFileSync(
      join(repoRoot, 'harvest-corpus.json'),
      JSON.stringify({
        entries: [
          {
            name: 'broken',
            localFixturePath: 'fixtures/broken',
            candidateComponent: 'Counter.tsx',
            candidateSpec: 'spec.ts',
            plantedFailure: {
              kind: 'file-replace',
              path: 'Counter.tsx',
              oldString: 'this-substring-is-not-in-the-file',
              newString: 'replacement',
              description: 'will fail to plant',
            },
          },
        ],
      }),
    );
    const source = new CorpusSource({ repoRoot });
    const artifacts = await collect(source);
    expect(artifacts).toEqual([]);
    const skipped = source.getSkippedEntries();
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.name).toBe('broken');
    // The reason is the applier error message; we only check it
    // mentions the entry was not processed cleanly.
    expect(skipped[0]!.reason.length).toBeGreaterThan(0);
  });

  it('continues processing remaining entries after one fails', async () => {
    const repoRoot = freshRepo();
    // First entry will fail (bad oldString); second is healthy.
    const broken = join(repoRoot, 'fixtures', 'broken');
    const healthy = join(repoRoot, 'fixtures', 'healthy');
    mkdirSync(broken, { recursive: true });
    mkdirSync(healthy, { recursive: true });
    writeFileSync(join(broken, 'C.tsx'), 'export const C = () => null;\n');
    writeFileSync(join(broken, 's.ts'), 'test("x", () => {});\n');
    writeFileSync(
      join(healthy, 'Counter.tsx'),
      `import { useState } from 'react';\nexport function Counter() {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(count + 1)}>{count}</button>;\n}\n`,
    );
    writeFileSync(join(healthy, 'spec.ts'), `test('counts', () => {});\n`);
    writeFileSync(
      join(repoRoot, 'harvest-corpus.json'),
      JSON.stringify({
        entries: [
          {
            name: 'broken',
            localFixturePath: 'fixtures/broken',
            candidateComponent: 'C.tsx',
            candidateSpec: 's.ts',
            plantedFailure: {
              kind: 'file-replace',
              path: 'C.tsx',
              oldString: 'not-present',
              newString: 'replacement',
              description: 'will fail',
            },
          },
          {
            name: 'healthy',
            localFixturePath: 'fixtures/healthy',
            candidateComponent: 'Counter.tsx',
            candidateSpec: 'spec.ts',
            plantedFailure: {
              kind: 'file-replace',
              path: 'Counter.tsx',
              oldString: 'setCount(count + 1)',
              newString: 'setCount(count - 1)',
              description: 'healthy plant',
            },
          },
        ],
      }),
    );
    const source = new CorpusSource({ repoRoot });
    const artifacts = await collect(source);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]!.manifest.entryName).toBe('healthy');
    expect(source.getSkippedEntries()).toHaveLength(1);
    expect(source.getSkippedEntries()[0]!.name).toBe('broken');
  });
});

describe('CorpusSource — caller controls disk I/O (build only)', () => {
  it('does NOT write any files under outputRoot during iteration', async () => {
    // Per design pick (i): Sources are pure data producers. CorpusSource
    // does need a tmpdir for the per-entry clone/copy, but those are
    // OS-tmp paths, not anything inside the repo. The sentinel here is
    // the synthetic-from-corpus tree under the repo root, which the
    // Source must NOT touch.
    const repoRoot = freshRepo();
    seedFixtureCorpus(repoRoot, 'counter-fixture');
    const sentinelDir = join(repoRoot, 'tests', 'diagnostic-eval');
    const source = new CorpusSource({ repoRoot });
    await collect(source);
    expect(existsSync(sentinelDir)).toBe(false);
  });
});
