// TDD for the file-backed AblationCache — issue #8 acceptance criterion:
// results are cached by `(case-hash, variant)` content hash so re-running
// with no input changes does not re-invoke the agent.
//
// The harness sees only the `AblationCache` interface (get + set). The
// file-backed factory in src/eval/ablation-cache.ts owns the hashing,
// serialization, and on-disk layout — keep both concerns separate so
// future cache strategies (in-memory LRU, sharded, content-addressable
// across repos) drop in without touching the harness.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Diagnosis } from '@reynsu/reactlens-diagnosis-prompts';
import { createFileCache } from '../../src/eval/ablation-cache';
import type { EvalCase } from '../../src/eval/eval-case-loader';

function makeCase(dir: string, name: string, opts: { component?: string; spec?: string } = {}): EvalCase {
  const caseDir = join(dir, name);
  mkdirSync(caseDir, { recursive: true });
  writeFileSync(
    join(caseDir, 'component.tsx'),
    opts.component ?? 'export function C(): null { return null; }\n',
  );
  writeFileSync(
    join(caseDir, 'spec.ts'),
    opts.spec ?? 'import {test} from "@playwright/test"; test("x", () => {});\n',
  );
  writeFileSync(
    join(caseDir, 'truth.json'),
    JSON.stringify({ expectedClassification: 'real-bug', minimumConfidence: 'high' }),
  );
  return {
    name,
    path: caseDir,
    truth: { expectedClassification: 'real-bug', minimumConfidence: 'high' },
    curated: true,
  };
}

function makeDiagnosis(overrides: Partial<Diagnosis> = {}): Diagnosis {
  return {
    classification: 'real-bug',
    confidence: 'high',
    rootCause: 'cached',
    evidence: ['evidence'],
    suggestedFix: 'fix',
    ...overrides,
  };
}

describe('createFileCache', () => {
  // Tracer bullet: set+get round-trip. Validates file I/O, hash
  // computation, serialization, deserialization, and miss semantics
  // in one path — if this passes, the cache plumbing is at least
  // structurally sound.
  it('round-trips a diagnosis through the file-backed cache', async () => {
    const root = mkdtempSync(join(tmpdir(), 'reactlens-cache-root-'));
    const caseRoot = mkdtempSync(join(tmpdir(), 'reactlens-cache-case-'));
    const cache = createFileCache({ root });
    const c = makeCase(caseRoot, 'case-x');
    const diag = makeDiagnosis({ rootCause: 'first write' });

    // Miss on a virgin cache.
    expect(await cache.get({ case: c, variant: 'with-snapshot' })).toBeUndefined();

    // Write, then read back: same payload, deep-equal.
    await cache.set({ case: c, variant: 'with-snapshot', diagnosis: diag });
    expect(await cache.get({ case: c, variant: 'with-snapshot' })).toEqual(diag);
  });

  // The variant is part of the key. Storing under 'with-snapshot' must
  // NOT make 'without-snapshot' look like a hit — otherwise the whole
  // ablation collapses (we'd read the same diagnosis for both legs and
  // report a 0 delta on every run, masking real moat-contribution).
  it('keys separately by variant', async () => {
    const root = mkdtempSync(join(tmpdir(), 'reactlens-cache-root-'));
    const caseRoot = mkdtempSync(join(tmpdir(), 'reactlens-cache-case-'));
    const cache = createFileCache({ root });
    const c = makeCase(caseRoot, 'case-x');

    await cache.set({
      case: c,
      variant: 'with-snapshot',
      diagnosis: makeDiagnosis({ rootCause: 'with' }),
    });

    expect(await cache.get({ case: c, variant: 'without-snapshot' })).toBeUndefined();
  });

  // The whole point of content-hashing (vs name-keying) is automatic
  // invalidation when a case input changes. If we mutate component.tsx,
  // the previously cached diagnosis must no longer be served — otherwise
  // the eval gate would happily report stale "everything's fine" on a
  // case the developer just edited, exactly the false-confidence
  // Principle 2 / ADR-0008 forbid.
  it('invalidates the cache when component.tsx content changes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'reactlens-cache-root-'));
    const caseRoot = mkdtempSync(join(tmpdir(), 'reactlens-cache-case-'));
    const cache = createFileCache({ root });
    const c = makeCase(caseRoot, 'case-x', { component: 'export const A = 1;\n' });
    const diag = makeDiagnosis({ rootCause: 'pre-mutation' });

    // Warm the cache for the pre-mutation content.
    await cache.set({ case: c, variant: 'with-snapshot', diagnosis: diag });
    expect(await cache.get({ case: c, variant: 'with-snapshot' })).toEqual(diag);

    // Mutate component.tsx (developer edits the case).
    writeFileSync(join(c.path, 'component.tsx'), 'export const A = 2;\n');

    // Now the same EvalCase object hashes to a different key — miss.
    expect(await cache.get({ case: c, variant: 'with-snapshot' })).toBeUndefined();
  });
});
