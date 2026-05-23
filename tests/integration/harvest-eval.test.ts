// Smoke integration test for scripts/harvest-eval.ts (slice #12 of v0.3 #7).
//
// Exercises the harvest orchestrator against the local fixture entry
// `counter-fixture` end-to-end:
//   - reads the real harvest-corpus.json at the repo root
//   - copies tests/fixtures/harvest-corpus-counter to a tmpdir
//   - applies the planted-failure recipe
//   - emits a case directory with the standard layout
//
// Writes the output into a per-test mkdtempSync directory rather than
// the real synthetic-from-corpus/ tree so the test doesn't pollute the
// repo. The real `synthetic-from-corpus/` cases are produced by the
// CLI invocation an operator runs manually, not by this test.
//
// Does NOT exercise the real-clone path — those entries need network
// + a real upstream commit SHA and would make this test flaky. The
// applier + emitter + manifest schema are unit-tested in isolation;
// what this test adds on top is the assembly of those parts.
import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runHarvest } from '../../scripts/harvest-eval';

// Repo root resolved from this test file's location. The integration
// suite has fileParallelism: false (vitest.config.ts) so a process-
// wide cwd would also work, but resolving explicitly keeps the test
// robust against future config changes.
const REPO_ROOT = resolve(__dirname, '..', '..');

// Narrows `runHarvest().emittedCaseDirs[0]` from string|undefined to
// string under noUncheckedIndexedAccess. Throws (failing the test) if
// the harvest produced zero cases — which is itself a regression
// signal, not a soft fallback.
function firstEmittedCase(dirs: readonly string[]): string {
  const d = dirs[0];
  if (d === undefined) throw new Error('runHarvest emitted zero cases');
  return d;
}

describe('runHarvest — fixture-mode end-to-end', async () => {
  it('processes the counter-fixture entry and emits exactly one case', async () => {
    const outRoot = mkdtempSync(join(tmpdir(), 'reactlens-harvest-smoke-'));
    const result = await runHarvest({
      repoRoot: REPO_ROOT,
      outputRoot: outRoot,
      entryName: 'counter-fixture',
    });
    expect(result.skippedEntries).toEqual([]);
    expect(result.emittedCaseDirs).toHaveLength(1);
  });

  it('emitted case directory has the expected file layout', async () => {
    const outRoot = mkdtempSync(join(tmpdir(), 'reactlens-harvest-smoke-'));
    const { emittedCaseDirs } = await runHarvest({
      repoRoot: REPO_ROOT,
      outputRoot: outRoot,
      entryName: 'counter-fixture',
    });
    const caseDir = firstEmittedCase(emittedCaseDirs);
    expect(statSync(caseDir).isDirectory()).toBe(true);
    expect(existsSync(join(caseDir, 'component.tsx'))).toBe(true);
    expect(existsSync(join(caseDir, 'spec.ts'))).toBe(true);
    expect(existsSync(join(caseDir, 'manifest.json'))).toBe(true);
    expect(existsSync(join(caseDir, 'truth.json'))).toBe(true);
  });

  it('emitted component.tsx contains the planted change (count + 1 became count - 1)', async () => {
    // The whole point: if the plant didn't actually plant, the harvested
    // case is a passing test mislabeled as failing — the calibration
    // poison that Principle 2 forbids. This assertion is the contract.
    const outRoot = mkdtempSync(join(tmpdir(), 'reactlens-harvest-smoke-'));
    const { emittedCaseDirs } = await runHarvest({
      repoRoot: REPO_ROOT,
      outputRoot: outRoot,
      entryName: 'counter-fixture',
    });
    const component = readFileSync(join(firstEmittedCase(emittedCaseDirs), 'component.tsx'), 'utf8');
    expect(component).toContain('setCount(count - 1)');
    expect(component).not.toContain('setCount(count + 1)');
  });

  it('manifest.json records sourceMode=local-fixture + the planted recipe', async () => {
    const outRoot = mkdtempSync(join(tmpdir(), 'reactlens-harvest-smoke-'));
    const { emittedCaseDirs } = await runHarvest({
      repoRoot: REPO_ROOT,
      outputRoot: outRoot,
      entryName: 'counter-fixture',
    });
    const manifest = JSON.parse(readFileSync(join(firstEmittedCase(emittedCaseDirs), 'manifest.json'), 'utf8'));
    expect(manifest.entryName).toBe('counter-fixture');
    expect(manifest.sourceMode).toBe('local-fixture');
    expect(manifest.plantedFailure.kind).toBe('file-replace');
    expect(manifest.plantedFailure.oldString).toBe('setCount(count + 1)');
    expect(manifest.plantedFailure.newString).toBe('setCount(count - 1)');
    // commitSha absent for fixture-mode (the schema makes it optional).
    expect(manifest.commitSha).toBeUndefined();
    // harvestedAt is ISO-8601 — sanity check the format, not the value.
    expect(manifest.harvestedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('emitted truth.json is the uncurated stub', async () => {
    const outRoot = mkdtempSync(join(tmpdir(), 'reactlens-harvest-smoke-'));
    const { emittedCaseDirs } = await runHarvest({
      repoRoot: REPO_ROOT,
      outputRoot: outRoot,
      entryName: 'counter-fixture',
    });
    const truth = JSON.parse(readFileSync(join(firstEmittedCase(emittedCaseDirs), 'truth.json'), 'utf8'));
    expect(truth.curated).toBe(false);
    expect(truth.minimumConfidence).toBe('low');
    expect(String(truth.notes).toLowerCase()).toContain('uncurated');
  });

  it('case directory lands under <outRoot>/<entry-slug>/case-NNN-<plant-slug>/', async () => {
    const outRoot = mkdtempSync(join(tmpdir(), 'reactlens-harvest-smoke-'));
    const { emittedCaseDirs } = await runHarvest({
      repoRoot: REPO_ROOT,
      outputRoot: outRoot,
      entryName: 'counter-fixture',
    });
    // Path shape: <outRoot>/counter-fixture/case-001-increment-regressed-to-decrement
    const caseDir = firstEmittedCase(emittedCaseDirs);
    expect(caseDir.startsWith(join(outRoot, 'counter-fixture'))).toBe(true);
    const tail = caseDir.split('/').pop();
    if (tail === undefined) throw new Error('caseDir has no trailing path segment');
    expect(tail).toMatch(/^case-\d{3}-/);
    expect(tail).toContain('increment-regressed-to-decrement');
  });

  it('re-running the harvest adds case-002-* rather than overwriting case-001-*', async () => {
    // Idempotence-via-incrementing: an operator running the harvest
    // twice should not lose the first run's output. The emitter scans
    // existing case-N-* dirs to pick max(N)+1 — this test locks that.
    const outRoot = mkdtempSync(join(tmpdir(), 'reactlens-harvest-smoke-'));
    await runHarvest({ repoRoot: REPO_ROOT, outputRoot: outRoot, entryName: 'counter-fixture' });
    await runHarvest({ repoRoot: REPO_ROOT, outputRoot: outRoot, entryName: 'counter-fixture' });
    const repoSlugDir = join(outRoot, 'counter-fixture');
    const cases = readdirSync(repoSlugDir).filter((n) => n.startsWith('case-'));
    expect(cases).toHaveLength(2);
    expect(cases.some((n) => n.startsWith('case-001-'))).toBe(true);
    expect(cases.some((n) => n.startsWith('case-002-'))).toBe(true);
  });
});

describe('runHarvest — operator-error surfacing', async () => {
  it('throws when --entry matches no corpus entry (silent zero-iteration would be a footgun)', async () => {
    const outRoot = mkdtempSync(join(tmpdir(), 'reactlens-harvest-smoke-'));
    await expect(
      runHarvest({
        repoRoot: REPO_ROOT,
        outputRoot: outRoot,
        entryName: 'this-entry-does-not-exist',
      }),
    ).rejects.toThrow(/matched no corpus entries/);
  });
});
