// TDD for the dogfoodAddFromLastFailure orchestrator (slice #15 of v0.3 #7).
//
// Composes: RunsArea (discover most recent run) → extractLastFailure
// (pure parsing) → HarvestCaseEmitter (write stub case dir).
//
// Returns a discriminated result so the CLI can map each outcome to a
// specific exit code + message without inferring from null/undefined:
//
//   { kind: 'ok',          caseDir, runId, testId }
//   { kind: 'no-runs' }                          // .reactlens/runs missing or empty
//   { kind: 'no-failure',  runId }               // most recent run had no failing test
//
// Tests use mkdtempSync'd repo roots seeded with hand-written
// .reactlens/runs/<id>/events.jsonl fixtures. No real reactlens spin-
// up; the integration test (separate file) does the end-to-end exercise.
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dogfoodAddFromLastFailure } from '../../src/eval/dogfood-orchestrator';

function freshRepo(): string {
  return mkdtempSync(join(tmpdir(), 'reactlens-dogfood-test-'));
}

// Helper to seed a run dir under <repoRoot>/.reactlens/runs/<runId>/
// with the given events.jsonl content.
function seedRun(repoRoot: string, runId: string, eventsJsonl: string): void {
  const runDir = join(repoRoot, '.reactlens', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'events.jsonl'), eventsJsonl);
}

function jsonl(...events: object[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

// A failing run + the source files the failure references — enough
// for the orchestrator to produce a case stub.
function seedFailingRun(repoRoot: string, runId: string): void {
  // Write the source files the snapshot points at so the orchestrator
  // can read them and copy contents into the case stub.
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
}

describe('dogfoodAddFromLastFailure — kind=ok', () => {
  it('emits a case dir under <cwd>/tests/diagnostic-eval/cases/synthetic-from-corpus/dogfood/', async () => {
    const repoRoot = freshRepo();
    seedFailingRun(repoRoot, '2026-05-20T22-00-00Z-deadbeef');
    const result = await dogfoodAddFromLastFailure({ cwd: repoRoot });
    if (result.kind !== 'ok') throw new Error(`expected ok, got ${result.kind}`);
    expect(result.caseDir.includes('synthetic-from-corpus/dogfood/')).toBe(true);
    expect(result.runId).toBe('2026-05-20T22-00-00Z-deadbeef');
    expect(result.testId).toBe('t1');
    expect(existsSync(result.caseDir)).toBe(true);
  });

  it('emits the four standard case files (component.tsx, spec.ts, manifest.json, truth.json)', async () => {
    const repoRoot = freshRepo();
    seedFailingRun(repoRoot, '2026-05-20T22-00-00Z-deadbeef');
    const result = await dogfoodAddFromLastFailure({ cwd: repoRoot });
    if (result.kind !== 'ok') throw new Error(`expected ok, got ${result.kind}`);
    expect(existsSync(join(result.caseDir, 'component.tsx'))).toBe(true);
    expect(existsSync(join(result.caseDir, 'spec.ts'))).toBe(true);
    expect(existsSync(join(result.caseDir, 'manifest.json'))).toBe(true);
    expect(existsSync(join(result.caseDir, 'truth.json'))).toBe(true);
  });

  it('copies the component source file referenced by the snapshot into component.tsx', async () => {
    const repoRoot = freshRepo();
    seedFailingRun(repoRoot, '2026-05-20T22-00-00Z-deadbeef');
    const result = await dogfoodAddFromLastFailure({ cwd: repoRoot });
    if (result.kind !== 'ok') throw new Error('expected ok');
    const component = readFileSync(join(result.caseDir, 'component.tsx'), 'utf8');
    expect(component).toContain('function Counter()');
  });

  it('copies the spec file referenced by test:start into spec.ts', async () => {
    const repoRoot = freshRepo();
    seedFailingRun(repoRoot, '2026-05-20T22-00-00Z-deadbeef');
    const result = await dogfoodAddFromLastFailure({ cwd: repoRoot });
    if (result.kind !== 'ok') throw new Error('expected ok');
    const spec = readFileSync(join(result.caseDir, 'spec.ts'), 'utf8');
    expect(spec).toContain("test('counts'");
  });

  it('writes a manifest with sourceMode=dogfood + discoveredFailure + sourceRunId', async () => {
    const repoRoot = freshRepo();
    seedFailingRun(repoRoot, '2026-05-20T22-00-00Z-deadbeef');
    const result = await dogfoodAddFromLastFailure({ cwd: repoRoot });
    if (result.kind !== 'ok') throw new Error('expected ok');
    const manifest = JSON.parse(readFileSync(join(result.caseDir, 'manifest.json'), 'utf8'));
    expect(manifest.sourceMode).toBe('dogfood');
    expect(manifest.sourceRepo).toBe(repoRoot);
    expect(manifest.discoveredFailure?.testId).toBe('t1');
    expect(manifest.discoveredFailure?.testTitle).toBe('counter increments');
    expect(manifest.discoveredFailure?.errorMessage).toBe('expected 1, got -1');
    // No planted recipe for organically-discovered failures.
    expect(manifest.plantedFailure).toBeUndefined();
  });

  it('writes a truth.json stub flagged curated:false (so headline accuracy is not contaminated)', async () => {
    const repoRoot = freshRepo();
    seedFailingRun(repoRoot, '2026-05-20T22-00-00Z-deadbeef');
    const result = await dogfoodAddFromLastFailure({ cwd: repoRoot });
    if (result.kind !== 'ok') throw new Error('expected ok');
    const truth = JSON.parse(readFileSync(join(result.caseDir, 'truth.json'), 'utf8'));
    expect(truth.curated).toBe(false);
    expect(truth.minimumConfidence).toBe('low');
  });

  it('picks the MOST RECENT run when multiple are persisted', async () => {
    const repoRoot = freshRepo();
    // Older run (sortable runId — alphabetic compare works because the
    // generator format is ISO timestamp + hex suffix per CLAUDE.md §14).
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
    const result = await dogfoodAddFromLastFailure({ cwd: repoRoot });
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.runId).toBe('2026-05-20T22-00-00Z-deadbeef');
    expect(result.testId).toBe('t1');
  });
});

describe('dogfoodAddFromLastFailure — kind=no-runs', () => {
  it('returns no-runs when .reactlens/runs/ does not exist', async () => {
    const repoRoot = freshRepo();
    const result = await dogfoodAddFromLastFailure({ cwd: repoRoot });
    expect(result.kind).toBe('no-runs');
  });

  it('returns no-runs when .reactlens/runs/ exists but is empty', async () => {
    const repoRoot = freshRepo();
    mkdirSync(join(repoRoot, '.reactlens', 'runs'), { recursive: true });
    const result = await dogfoodAddFromLastFailure({ cwd: repoRoot });
    expect(result.kind).toBe('no-runs');
  });
});

describe('dogfoodAddFromLastFailure — kind=no-failure', () => {
  it('returns no-failure with the runId when the most recent run is all-pass', async () => {
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
    const result = await dogfoodAddFromLastFailure({ cwd: repoRoot });
    if (result.kind !== 'no-failure') throw new Error(`expected no-failure, got ${result.kind}`);
    expect(result.runId).toBe('2026-05-20T22-00-00Z-deadbeef');
  });
});

describe('dogfoodAddFromLastFailure — fallbacks for missing source files', () => {
  it('writes a placeholder component.tsx when the snapshot has no source mapping', async () => {
    // Probe-disconnected runs or older persisted runs may carry a
    // snapshot without source.file. The orchestrator must NOT crash —
    // emit a clear placeholder so the operator knows what's missing.
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
    const result = await dogfoodAddFromLastFailure({ cwd: repoRoot });
    if (result.kind !== 'ok') throw new Error(`expected ok, got ${result.kind}`);
    const component = readFileSync(join(result.caseDir, 'component.tsx'), 'utf8');
    expect(component.toLowerCase()).toContain('placeholder');
  });
});
