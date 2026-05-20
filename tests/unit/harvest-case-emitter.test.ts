// TDD for the harvest case emitter (slice #12 of v0.3 #7).
//
// Given the artifacts a harvest run captures from one corpus entry
// (the planted component source, the spec, and a manifest describing
// what was planted), the emitter writes a case directory with the
// same layout as the hand-curated cases under
// `tests/diagnostic-eval/cases/case-*-*/`:
//
//   <outputDir>/
//   ├── component.tsx
//   ├── spec.ts
//   ├── manifest.json     (NEW per slice #12 — harvest provenance)
//   └── truth.json        (stub — curated: false, awaiting human review)
//
// Critically: truth.json starts as a STUB (curated: false). The whole
// point of synthetic-from-corpus is that these cases enter uncurated
// and a human marks them curated only after verifying. Emitting a
// curated truth at harvest time would silently inflate the headline.
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emitHarvestedCase, type HarvestArtifacts } from '../../src/eval/harvest-case-emitter';

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), 'reactlens-emit-test-'));
}

const SAMPLE_ARTIFACTS: HarvestArtifacts = {
  componentSrc: 'export function Counter() { return <div data-testid="count">{0}</div>; }\n',
  specSrc: "import { test } from '@playwright/test';\ntest('counts', async () => {});\n",
  manifest: {
    sourceRepo: 'tests/fixtures/harvest-corpus-counter',
    sourceMode: 'local-fixture',
    plantedFailure: {
      kind: 'file-replace',
      path: 'src/Counter.tsx',
      oldString: 'count + 1',
      newString: 'count - 1',
      description: 'Increment regressed to decrement',
    },
    harvestedAt: '2026-05-20T20:00:00.000Z',
    entryName: 'counter-fixture',
  },
};

describe('emitHarvestedCase — file layout', () => {
  it('writes component.tsx, spec.ts, manifest.json, and a truth.json stub', () => {
    const out = freshDir();
    emitHarvestedCase(out, SAMPLE_ARTIFACTS);
    expect(existsSync(join(out, 'component.tsx'))).toBe(true);
    expect(existsSync(join(out, 'spec.ts'))).toBe(true);
    expect(existsSync(join(out, 'manifest.json'))).toBe(true);
    expect(existsSync(join(out, 'truth.json'))).toBe(true);
  });

  it('component.tsx + spec.ts contain the provided source verbatim', () => {
    const out = freshDir();
    emitHarvestedCase(out, SAMPLE_ARTIFACTS);
    expect(readFileSync(join(out, 'component.tsx'), 'utf8')).toBe(SAMPLE_ARTIFACTS.componentSrc);
    expect(readFileSync(join(out, 'spec.ts'), 'utf8')).toBe(SAMPLE_ARTIFACTS.specSrc);
  });
});

describe('emitHarvestedCase — manifest provenance', () => {
  it('manifest.json round-trips through JSON.parse with all fields intact', () => {
    const out = freshDir();
    emitHarvestedCase(out, SAMPLE_ARTIFACTS);
    const parsed = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    expect(parsed.sourceRepo).toBe(SAMPLE_ARTIFACTS.manifest.sourceRepo);
    expect(parsed.entryName).toBe(SAMPLE_ARTIFACTS.manifest.entryName);
    expect(parsed.plantedFailure.kind).toBe('file-replace');
    expect(parsed.plantedFailure.oldString).toBe('count + 1');
    expect(parsed.harvestedAt).toBe('2026-05-20T20:00:00.000Z');
  });

  it('manifest.json is pretty-printed for human-eyeball review', () => {
    // Manifest is read by humans during the curation step (acceptance
    // criterion #7). A minified blob is unreadable on a PR diff; the
    // emitter must format with 2-space indent like the rest of the
    // case files (truth.json, snapshot.json existing fixtures use
    // the same style).
    const out = freshDir();
    emitHarvestedCase(out, SAMPLE_ARTIFACTS);
    const text = readFileSync(join(out, 'manifest.json'), 'utf8');
    expect(text).toMatch(/\n {2}"sourceRepo":/);
    expect(text.endsWith('\n')).toBe(true);
  });
});

describe('emitHarvestedCase — truth.json stub', () => {
  it('writes a truth.json marked curated:false with placeholder fields', () => {
    // The stub MUST be invalid-looking enough that a human reader can
    // tell it needs curation, but valid enough that parseTruth doesn't
    // throw on load (the loader treats malformed truth as a corruption
    // signal). expectedClassification must be one of the four canonical
    // values — we pick 'env-issue' as the closest to "we don't know yet"
    // and minimumConfidence='low' so the case can't accidentally raise
    // a confident-but-wrong signal if the operator forgets to curate.
    const out = freshDir();
    emitHarvestedCase(out, SAMPLE_ARTIFACTS);
    const truth = JSON.parse(readFileSync(join(out, 'truth.json'), 'utf8'));
    expect(truth.curated).toBe(false);
    expect(truth.expectedClassification).toMatch(/^(real-bug|test-bug|flaky|env-issue)$/);
    expect(truth.minimumConfidence).toBe('low');
    expect(String(truth.notes).toLowerCase()).toContain('uncurated');
  });
});

describe('emitHarvestedCase — preconditions', () => {
  it('throws when outputDir does not exist', () => {
    // The caller is responsible for creating the directory. The
    // emitter does NOT mkdir -p because that hides operator errors
    // (e.g., typo in the path that creates a phantom directory).
    expect(() =>
      emitHarvestedCase('/tmp/reactlens-this-path-truly-does-not-exist-zzz', SAMPLE_ARTIFACTS),
    ).toThrow();
  });
});
