// Module Interface tests for DogfoodSource (HarvestSource adapter) +
// internal-helper tests for extractLastFailure (folded from the old
// dogfood-last-failure-extractor module).
//
// Consolidates the pre-PR coverage from:
//   - tests/unit/dogfood-orchestrator.test.ts (12 cases) — rewritten to
//     hit `new DogfoodSource({cwd}).iterate()` + `describeWhyEmpty()`
//     instead of `dogfoodAddFromLastFailure(opts)`.
//   - tests/unit/dogfood-last-failure-extractor.test.ts (12 cases) —
//     re-pointed at the now-internal helper exported from dogfood-source.
//
// Per LANGUAGE.md: a deep module can have internal seams its own tests
// use. The extractor stays exported from dogfood-source so the rich
// edge-case coverage doesn't have to be recreated at the Interface
// boundary, but the production seam is the DogfoodSource Interface.
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HarvestArtifacts } from '../../src/eval/harvest-source';
import { DogfoodSource, extractLastFailure } from '../../src/eval/dogfood-source';

function freshRepo(): string {
  return mkdtempSync(join(tmpdir(), 'reactlens-dogfood-test-'));
}

function seedRun(repoRoot: string, runId: string, eventsJsonl: string): void {
  const runDir = join(repoRoot, '.reactlens', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'events.jsonl'), eventsJsonl);
}

function jsonl(...events: object[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

function seedFailingRun(repoRoot: string, runId: string): { componentPath: string; specPath: string } {
  const componentPath = join(repoRoot, 'src', 'Counter.tsx');
  const specPath = join(repoRoot, 'tests', 'counter.spec.ts');
  mkdirSync(join(repoRoot, 'src'), { recursive: true });
  mkdirSync(join(repoRoot, 'tests'), { recursive: true });
  writeFileSync(
    componentPath,
    'export function Counter(): JSX.Element { return <div>0</div>; }\n',
  );
  writeFileSync(
    specPath,
    "import { test } from '@playwright/test';\ntest('counts', async () => {});\n",
  );
  seedRun(
    repoRoot,
    runId,
    jsonl(
      { t: 'run:start', runId, totalTests: 1, timestamp: 1747789200000 },
      { t: 'test:start', id: 't1', title: 'counter increments', file: specPath, suite: 'counter' },
      {
        t: 'component:snapshot',
        testId: 't1',
        stepId: 's1',
        tree: {
          name: 'Counter',
          props: {},
          children: [],
          hooks: [{ kind: 'state', value: -1, name: 'count' }],
          source: { file: componentPath, line: 1 },
        },
      },
      { t: 'test:end', id: 't1', status: 'failed', duration: 100, error: 'expected 1, got -1' },
      { t: 'run:end', passed: 0, failed: 1, skipped: 0, duration: 100 },
    ),
  );
  return { componentPath, specPath };
}

async function collect(source: DogfoodSource): Promise<HarvestArtifacts[]> {
  const out: HarvestArtifacts[] = [];
  for await (const art of source.iterate()) out.push(art);
  return out;
}

// =============================================================================
// DogfoodSource — Interface (iterate yields HarvestArtifacts when a
// failure exists; describeWhyEmpty surfaces the reason when iteration
// completes with zero items).
// =============================================================================

describe('DogfoodSource — iterate yields one artifact when a failure exists', () => {
  it('yields a single HarvestArtifacts with sourceMode=dogfood + discoveredFailure', async () => {
    const repoRoot = freshRepo();
    seedFailingRun(repoRoot, '2026-05-20T22-00-00Z-deadbeef');
    const source = new DogfoodSource({ cwd: repoRoot });
    const artifacts = await collect(source);

    expect(artifacts).toHaveLength(1);
    const m = artifacts[0]!.manifest;
    expect(m.sourceMode).toBe('dogfood');
    expect(m.sourceRepo).toBe(repoRoot);
    expect(m.discoveredFailure?.testId).toBe('t1');
    expect(m.discoveredFailure?.testTitle).toBe('counter increments');
    expect(m.discoveredFailure?.errorMessage).toBe('expected 1, got -1');
    expect(m.discoveredFailure?.sourceRunId).toBe('2026-05-20T22-00-00Z-deadbeef');
    // No planted recipe for organically-discovered failures.
    expect(m.plantedFailure).toBeUndefined();
  });

  it('reads the component source file referenced by the snapshot into componentSrc', async () => {
    const repoRoot = freshRepo();
    seedFailingRun(repoRoot, '2026-05-20T22-00-00Z-deadbeef');
    const source = new DogfoodSource({ cwd: repoRoot });
    const [art] = await collect(source);
    expect(art!.componentSrc).toContain('function Counter()');
  });

  it('reads the spec file referenced by test:start into specSrc', async () => {
    const repoRoot = freshRepo();
    seedFailingRun(repoRoot, '2026-05-20T22-00-00Z-deadbeef');
    const source = new DogfoodSource({ cwd: repoRoot });
    const [art] = await collect(source);
    expect(art!.specSrc).toContain("test('counts'");
  });

  it('picks the MOST RECENT run when multiple are persisted', async () => {
    const repoRoot = freshRepo();
    seedRun(
      repoRoot,
      '2025-01-01T00-00-00Z-aaaaaaaa',
      jsonl(
        { t: 'run:start', runId: '2025-01-01T00-00-00Z-aaaaaaaa', totalTests: 1, timestamp: 0 },
        { t: 'test:start', id: 'old', title: 'old failure', file: '/old.ts', suite: 'old' },
        { t: 'test:end', id: 'old', status: 'failed', duration: 1, error: 'old error' },
      ),
    );
    seedFailingRun(repoRoot, '2026-05-20T22-00-00Z-deadbeef');
    const source = new DogfoodSource({ cwd: repoRoot });
    const [art] = await collect(source);
    expect(art!.manifest.discoveredFailure?.sourceRunId).toBe('2026-05-20T22-00-00Z-deadbeef');
    expect(art!.manifest.discoveredFailure?.testId).toBe('t1');
  });

  it('writes a placeholder componentSrc when the snapshot has no source mapping', async () => {
    // Probe-disconnected runs or older persisted runs may carry a
    // snapshot without source.file. DogfoodSource must NOT crash —
    // yield an artifact whose componentSrc is the placeholder so the
    // operator knows what's missing.
    const repoRoot = freshRepo();
    seedRun(
      repoRoot,
      '2026-05-20T22-00-00Z-deadbeef',
      jsonl(
        { t: 'run:start', runId: '2026-05-20T22-00-00Z-deadbeef', totalTests: 1, timestamp: 0 },
        { t: 'test:start', id: 't1', title: 'no-source case', file: '/nonexistent-spec.ts', suite: 's' },
        { t: 'component:snapshot', testId: 't1', stepId: 's1', tree: { name: 'Mystery', props: {}, children: [] } },
        { t: 'test:end', id: 't1', status: 'failed', duration: 1, error: 'something' },
      ),
    );
    const source = new DogfoodSource({ cwd: repoRoot });
    const [art] = await collect(source);
    expect(art!.componentSrc.toLowerCase()).toContain('placeholder');
  });
});

describe('DogfoodSource — iterate yields nothing when there is no failure', () => {
  it('yields zero artifacts when .reactlens/runs/ does not exist', async () => {
    const repoRoot = freshRepo();
    const source = new DogfoodSource({ cwd: repoRoot });
    const artifacts = await collect(source);
    expect(artifacts).toEqual([]);
  });

  it('describeWhyEmpty returns "no-runs" when .reactlens/runs/ does not exist', async () => {
    const repoRoot = freshRepo();
    const source = new DogfoodSource({ cwd: repoRoot });
    await collect(source);
    expect(source.describeWhyEmpty()).toBe('no-runs');
  });

  it('describeWhyEmpty returns "no-runs" when .reactlens/runs/ is empty', async () => {
    const repoRoot = freshRepo();
    mkdirSync(join(repoRoot, '.reactlens', 'runs'), { recursive: true });
    const source = new DogfoodSource({ cwd: repoRoot });
    await collect(source);
    expect(source.describeWhyEmpty()).toBe('no-runs');
  });

  it('describeWhyEmpty returns "no-failure" when the most recent run is all-pass', async () => {
    const repoRoot = freshRepo();
    seedRun(
      repoRoot,
      '2026-05-20T22-00-00Z-deadbeef',
      jsonl(
        { t: 'run:start', runId: '2026-05-20T22-00-00Z-deadbeef', totalTests: 1, timestamp: 0 },
        { t: 'test:start', id: 't1', title: 'happy', file: '/spec.ts', suite: 's' },
        { t: 'test:end', id: 't1', status: 'passed', duration: 50 },
      ),
    );
    const source = new DogfoodSource({ cwd: repoRoot });
    const artifacts = await collect(source);
    expect(artifacts).toEqual([]);
    expect(source.describeWhyEmpty()).toBe('no-failure');
  });

  it('describeWhyEmpty returns null before iterate() has been called', async () => {
    // Defensive: callers shouldn't be able to introspect the reason
    // without first attempting iteration. Returning null prevents a
    // CLI from printing a stale or misleading reason on its first
    // tick.
    const repoRoot = freshRepo();
    const source = new DogfoodSource({ cwd: repoRoot });
    expect(source.describeWhyEmpty()).toBeNull();
  });
});

describe('DogfoodSource — caller controls disk I/O (build only)', () => {
  it('does NOT write any files under cwd during iteration', async () => {
    // Per design pick (i): Sources are pure data producers. The caller
    // (the CLI command) is the one that mkdir + emitHarvestedCase. If
    // a refactor accidentally re-introduces disk I/O into the Source,
    // this test surfaces it.
    const repoRoot = freshRepo();
    seedFailingRun(repoRoot, '2026-05-20T22-00-00Z-deadbeef');
    const sentinelDir = join(repoRoot, 'tests', 'diagnostic-eval');
    const source = new DogfoodSource({ cwd: repoRoot });
    await collect(source);
    // The Source must NOT have touched the cases tree.
    expect(existsSync(sentinelDir)).toBe(false);
  });
});

// =============================================================================
// extractLastFailure — internal helper, folded from
// src/eval/dogfood-last-failure-extractor.ts. Kept exported from
// dogfood-source so the rich JSONL parsing edge cases stay covered
// without recreating each through the Source Interface.
// =============================================================================

const SAMPLE_RUN = jsonl(
  { t: 'run:start', runId: '2026-05-20T22-00-00Z-deadbeef', totalTests: 2, timestamp: 1747789200000 },
  { t: 'test:start', id: 't1', title: 'cart shows declined banner', file: '/abs/cart.spec.ts', suite: 'cart' },
  { t: 'step:start', testId: 't1', stepId: 's1', title: 'click pay' },
  {
    t: 'component:snapshot',
    testId: 't1',
    stepId: 's1',
    tree: { name: 'CartBanner', props: {}, children: [] },
  },
  { t: 'step:end', testId: 't1', stepId: 's1', status: 'passed' },
  { t: 'test:end', id: 't1', status: 'passed', duration: 1200 },
  { t: 'test:start', id: 't2', title: 'checkout succeeds', file: '/abs/checkout.spec.ts', suite: 'checkout' },
  { t: 'step:start', testId: 't2', stepId: 's1', title: 'submit' },
  {
    t: 'component:snapshot',
    testId: 't2',
    stepId: 's1',
    tree: { name: 'CheckoutPage', props: {}, children: [], hooks: [{ kind: 'state', value: '123', name: 'cvv' }] },
  },
  { t: 'step:end', testId: 't2', stepId: 's1', status: 'failed' },
  {
    t: 'test:end',
    id: 't2',
    status: 'failed',
    duration: 3400,
    error: 'Timed out waiting for [data-testid="checkout-success"]',
  },
  { t: 'run:end', passed: 1, failed: 1, skipped: 0, duration: 4600 },
);

describe('extractLastFailure — happy path', () => {
  it('returns the failing test artifacts', () => {
    const result = extractLastFailure(SAMPLE_RUN);
    if (result === null) throw new Error('expected a failure to be found');
    expect(result.testId).toBe('t2');
    expect(result.testTitle).toBe('checkout succeeds');
    expect(result.specFile).toBe('/abs/checkout.spec.ts');
    expect(result.errorMessage).toBe('Timed out waiting for [data-testid="checkout-success"]');
    expect(result.snapshot).not.toBeNull();
    expect(result.snapshot?.name).toBe('CheckoutPage');
  });

  it('extracts the snapshot from the failing testId only (not from a sibling passing test)', () => {
    const result = extractLastFailure(SAMPLE_RUN);
    expect(result?.snapshot?.name).toBe('CheckoutPage');
    expect(result?.snapshot?.name).not.toBe('CartBanner');
  });

  it('finds the MOST RECENT failure when multiple tests failed', () => {
    const twoFailures = jsonl(
      { t: 'run:start', runId: 'r1', totalTests: 2, timestamp: 0 },
      { t: 'test:start', id: 't1', title: 'first failure', file: '/spec1.ts', suite: 's' },
      { t: 'test:end', id: 't1', status: 'failed', duration: 100, error: 'first error' },
      { t: 'test:start', id: 't2', title: 'second failure', file: '/spec2.ts', suite: 's' },
      { t: 'test:end', id: 't2', status: 'failed', duration: 200, error: 'second error' },
      { t: 'run:end', passed: 0, failed: 2, skipped: 0, duration: 300 },
    );
    expect(extractLastFailure(twoFailures)?.testId).toBe('t2');
    expect(extractLastFailure(twoFailures)?.testTitle).toBe('second failure');
  });

  it('counts timedOut as a failure (operator perspective: timeout IS a failure)', () => {
    const timeout = jsonl(
      { t: 'run:start', runId: 'r1', totalTests: 1, timestamp: 0 },
      { t: 'test:start', id: 't1', title: 'too slow', file: '/spec.ts', suite: 's' },
      { t: 'test:end', id: 't1', status: 'timedOut', duration: 30000, error: 'Test timeout of 30000ms exceeded.' },
      { t: 'run:end', passed: 0, failed: 0, skipped: 0, duration: 30000 },
    );
    expect(extractLastFailure(timeout)?.testId).toBe('t1');
  });
});

describe('extractLastFailure — no failure', () => {
  it('returns null when every test passed', () => {
    const allPass = jsonl(
      { t: 'run:start', runId: 'r1', totalTests: 1, timestamp: 0 },
      { t: 'test:start', id: 't1', title: 'happy', file: '/spec.ts', suite: 's' },
      { t: 'test:end', id: 't1', status: 'passed', duration: 100 },
      { t: 'run:end', passed: 1, failed: 0, skipped: 0, duration: 100 },
    );
    expect(extractLastFailure(allPass)).toBeNull();
  });

  it('returns null on an empty events string', () => {
    expect(extractLastFailure('')).toBeNull();
  });

  it('returns null when the only test is skipped (skip is not a failure)', () => {
    const skipped = jsonl(
      { t: 'run:start', runId: 'r1', totalTests: 1, timestamp: 0 },
      { t: 'test:start', id: 't1', title: 'skipped', file: '/spec.ts', suite: 's' },
      { t: 'test:end', id: 't1', status: 'skipped', duration: 0 },
      { t: 'run:end', passed: 0, failed: 0, skipped: 1, duration: 0 },
    );
    expect(extractLastFailure(skipped)).toBeNull();
  });
});

describe('extractLastFailure — robustness', () => {
  it('returns the failure even when no component:snapshot was captured (snapshot is null then)', () => {
    const noSnapshot = jsonl(
      { t: 'run:start', runId: 'r1', totalTests: 1, timestamp: 0 },
      { t: 'test:start', id: 't1', title: 'env failure', file: '/spec.ts', suite: 's' },
      { t: 'test:end', id: 't1', status: 'failed', duration: 100, error: 'net::ERR_CONNECTION_REFUSED' },
      { t: 'run:end', passed: 0, failed: 1, skipped: 0, duration: 100 },
    );
    const result = extractLastFailure(noSnapshot);
    expect(result?.testId).toBe('t1');
    expect(result?.snapshot).toBeNull();
    expect(result?.errorMessage).toBe('net::ERR_CONNECTION_REFUSED');
  });

  it('uses the LAST snapshot for a testId when several were captured (state at failure)', () => {
    const manySnaps = jsonl(
      { t: 'run:start', runId: 'r1', totalTests: 1, timestamp: 0 },
      { t: 'test:start', id: 't1', title: 't', file: '/s.ts', suite: 's' },
      { t: 'component:snapshot', testId: 't1', stepId: 's1', tree: { name: 'Counter', props: {}, children: [], hooks: [{ kind: 'state', value: 0, name: 'count' }] } },
      { t: 'component:snapshot', testId: 't1', stepId: 's2', tree: { name: 'Counter', props: {}, children: [], hooks: [{ kind: 'state', value: -1, name: 'count' }] } },
      { t: 'test:end', id: 't1', status: 'failed', duration: 100, error: 'count was -1' },
    );
    const result = extractLastFailure(manySnaps);
    expect(result?.snapshot?.hooks?.[0]?.value).toBe(-1);
  });

  it('throws on a malformed JSON line (corruption signal, never silently skipped)', () => {
    const corrupt = 'this is not json\n{"t":"test:end","id":"x","status":"failed","duration":1}\n';
    expect(() => extractLastFailure(corrupt)).toThrow();
  });
});
