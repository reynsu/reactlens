// Dogfood orchestrator (slice #15 of v0.3 #7).
//
// `reactlens eval add-from-last-failure` turns the most recent real-
// world failure the developer hit into a candidate eval case in two
// seconds. This module is the engine; the CLI command is a thin
// argv parser around it.
//
// Pipeline (all sync-ish except the RunsArea file reads):
//   1. RunsArea.list() → newest run first
//   2. RunsArea.loadEvents(newest.runId) → JSONL text
//   3. extractLastFailure(text) → LastFailure | null
//   4. Read componentSrc from snapshot.source.file if present + reachable
//   5. Read specSrc from failure.specFile if reachable
//   6. emitHarvestedCase to <cwd>/tests/diagnostic-eval/cases/synthetic-
//      from-corpus/dogfood/<slug>/ with sourceMode='dogfood'
//
// Returns a discriminated result so the CLI can map each outcome to
// a specific exit code + message — null/undefined sentinels would
// invite swallowed-failure handling at the caller.
//
// Per ADR-0003: no telemetry, no network, no writes outside the repo.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openRunsArea } from '../runs/run-paths';
import { extractLastFailure } from './dogfood-last-failure-extractor';
import { emitHarvestedCase, type HarvestArtifacts, type HarvestManifest } from './harvest-case-emitter';

export type DogfoodResult =
  | { kind: 'ok'; caseDir: string; runId: string; testId: string }
  | { kind: 'no-runs' }
  | { kind: 'no-failure'; runId: string };

export type DogfoodOpts = {
  // Project root — `.reactlens/runs/` is read from here, and the
  // emitted case lands under `<cwd>/tests/diagnostic-eval/cases/
  // synthetic-from-corpus/dogfood/` unless overridden.
  cwd: string;
  // Override for the emitted-case root. Tests use mkdtempSync paths;
  // production defaults to the standard cases tree.
  casesRoot?: string;
};

// Filesystem-safe slug derivation matching the convention in
// scripts/harvest-eval.ts (slice #12): lowercase, non-alnum → hyphen,
// trim. Empty-string fallback ensures we always have SOMETHING — the
// dogfood path needs to land at SOME directory even for weird titles.
function slugify(s: string): string {
  const out = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return out.length > 0 ? out : 'untitled';
}

const COMPONENT_PLACEHOLDER = `// PLACEHOLDER — the dogfood capture did not include a source mapping
// for this component (snapshot lacked source.file). The operator
// curating this case should paste the relevant component source here,
// then promote the case out of synthetic-from-corpus/dogfood/ once
// the truth.json is verified.
`;

const SPEC_PLACEHOLDER = `// PLACEHOLDER — the dogfood capture's spec file was not reachable
// at the path test:start recorded. The operator should paste the
// relevant failing test here before promoting.
`;

// Best-effort read: returns the file contents if present, the
// placeholder otherwise. Never throws — the dogfood path is the
// "two-seconds" UX, not the "fail loudly on a stale path" UX.
function readOrPlaceholder(absPath: string | undefined, placeholder: string): string {
  if (absPath === undefined) return placeholder;
  try {
    if (!existsSync(absPath)) return placeholder;
    return readFileSync(absPath, 'utf8');
  } catch {
    return placeholder;
  }
}

export async function dogfoodAddFromLastFailure(opts: DogfoodOpts): Promise<DogfoodResult> {
  const area = await openRunsArea(opts.cwd);
  const runs = await area.list();
  if (runs.length === 0) return { kind: 'no-runs' };

  const newest = runs[0];
  if (newest === undefined) return { kind: 'no-runs' };

  const events = await area.loadEvents(newest.runId);
  const failure = extractLastFailure(events);
  if (failure === null) return { kind: 'no-failure', runId: newest.runId };

  // Read source files best-effort. snapshot.source.file is set by the
  // probe when it can resolve a fiber back to its source-mapped origin;
  // older runs OR probe-disconnected runs lack it and we placeholder.
  const componentSrc = readOrPlaceholder(failure.snapshot?.source?.file, COMPONENT_PLACEHOLDER);
  const specSrc = readOrPlaceholder(failure.specFile, SPEC_PLACEHOLDER);

  const manifest: HarvestManifest = {
    entryName: `dogfood-${slugify(failure.testTitle)}`,
    sourceRepo: opts.cwd,
    sourceMode: 'dogfood',
    discoveredFailure: {
      testId: failure.testId,
      testTitle: failure.testTitle,
      ...(failure.errorMessage !== undefined ? { errorMessage: failure.errorMessage } : {}),
      sourceRunId: newest.runId,
    },
    harvestedAt: new Date().toISOString(),
  };

  // Output path: <cwd>/tests/diagnostic-eval/cases/synthetic-from-
  // corpus/dogfood/case-<runId-slug>-<test-slug>/. RunId is included
  // so re-running the dogfood command on the same failure twice
  // overwrites in the same directory (idempotent) — and so an
  // operator-eyeball on `ls` immediately shows which run a case came
  // from.
  const casesRoot = opts.casesRoot
    ?? join(opts.cwd, 'tests', 'diagnostic-eval', 'cases', 'synthetic-from-corpus', 'dogfood');
  const slug = slugify(`${newest.runId}-${failure.testTitle}`);
  const caseDir = join(casesRoot, `case-${slug}`);
  // mkdir -p here, not in the emitter — the emitter throws on missing
  // outputDir to catch typo'd paths in operator-direct calls. The
  // orchestrator is the legitimate path that pre-creates the dir.
  mkdirSync(caseDir, { recursive: true });

  const artifacts: HarvestArtifacts = { componentSrc, specSrc, manifest };
  emitHarvestedCase(caseDir, artifacts);

  return { kind: 'ok', caseDir, runId: newest.runId, testId: failure.testId };
}
