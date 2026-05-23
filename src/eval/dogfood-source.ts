// DogfoodSource — HarvestSource adapter that walks `.reactlens/runs/`,
// finds the most recent test failure, and yields a single HarvestArtifacts
// stub describing it.
//
// Replaces the pre-PR pair of `dogfood-orchestrator.ts` (the entry that
// composed the pipeline + emitted to disk) and `dogfood-last-failure-
// extractor.ts` (the JSONL parser). Both fold here: the extractor stays
// exported for its rich edge-case tests, the orchestration moves into
// the `iterate()` generator, and disk-emission moves OUT to the caller
// (per HarvestSource design pick (i) — Source is build-only).
//
// `reactlens eval add-from-last-failure` (the CLI) constructs one of
// these and consumes its iterate() output. Reasons for an empty
// iteration are surfaced via describeWhyEmpty() so the CLI can map
// 'no-runs' / 'no-failure' to distinct exit codes + messages.
//
// Per ADR-0003: no telemetry, no network, no writes inside the Source.
import { existsSync, readFileSync } from 'node:fs';
import { openRunsArea } from '../runs/run-paths';
import type { ComponentNode } from '../runner/events';
import type {
  HarvestArtifacts,
  HarvestManifest,
  HarvestSource,
} from './harvest-source';
import { slugify } from './slug';

export type DogfoodSourceOpts = {
  // Project root — `.reactlens/runs/` is read from here. The Source
  // does NOT decide where the eventual case directory lands; the caller
  // owns mkdir + emitHarvestedCase (per HarvestSource design pick (i)).
  cwd: string;
};

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

export class DogfoodSource implements HarvestSource {
  private readonly opts: DogfoodSourceOpts;
  // null until iterate() runs. After iterate(), either:
  //   - the iterator yielded ≥ 1 artifact → stays null (no reason)
  //   - the iterator yielded 0 → set to 'no-runs' or 'no-failure'
  // The "null before iterate()" invariant is part of the Interface
  // contract (see tests/unit/dogfood-source.test.ts) — callers must
  // not introspect the reason before attempting iteration.
  private whyEmpty: 'no-runs' | 'no-failure' | null = null;

  constructor(opts: DogfoodSourceOpts) {
    this.opts = opts;
  }

  describeWhyEmpty(): 'no-runs' | 'no-failure' | null {
    return this.whyEmpty;
  }

  async *iterate(): AsyncIterable<HarvestArtifacts> {
    // Reset on every iterate() call so re-invoking a single Source
    // doesn't carry stale state from a prior empty walk.
    this.whyEmpty = null;

    const area = await openRunsArea(this.opts.cwd);
    const runs = await area.list();
    if (runs.length === 0) {
      this.whyEmpty = 'no-runs';
      return;
    }
    const newest = runs[0];
    if (newest === undefined) {
      this.whyEmpty = 'no-runs';
      return;
    }

    const events = await area.loadEvents(newest.runId);
    const failure = extractLastFailure(events);
    if (failure === null) {
      this.whyEmpty = 'no-failure';
      return;
    }

    // Read source files best-effort. snapshot.source.file is set by the
    // probe when it can resolve a fiber back to its source-mapped origin;
    // older runs OR probe-disconnected runs lack it and we placeholder.
    const componentSrc = readOrPlaceholder(failure.snapshot?.source?.file, COMPONENT_PLACEHOLDER);
    const specSrc = readOrPlaceholder(failure.specFile, SPEC_PLACEHOLDER);

    const manifest: HarvestManifest = {
      entryName: `dogfood-${slugify(failure.testTitle, 'untitled')}`,
      sourceRepo: this.opts.cwd,
      sourceMode: 'dogfood',
      discoveredFailure: {
        testId: failure.testId,
        testTitle: failure.testTitle,
        ...(failure.errorMessage !== undefined ? { errorMessage: failure.errorMessage } : {}),
        sourceRunId: newest.runId,
      },
      harvestedAt: new Date().toISOString(),
    };

    const artifacts: HarvestArtifacts = { componentSrc, specSrc, manifest };
    yield artifacts;
  }
}

// =============================================================================
// extractLastFailure — internal helper, folded from
// src/eval/dogfood-last-failure-extractor.ts (deleted in this PR).
//
// Pure: parse JSONL text, return the most-recent failing test's artifacts
// (or null). Exported so the rich edge-case coverage in dogfood-source.test.ts
// can test it directly without going through the full iterate() flow.
//
// Contract:
//   - returns null when no failing test:end exists (caller surfaces a
//     "nothing to harvest" message; not an error condition)
//   - throws on malformed JSON lines — corruption signal per Principle 2,
//     never silently skipped
// =============================================================================

export type LastFailure = {
  testId: string;
  testTitle: string;
  specFile: string;
  errorMessage: string | undefined;
  snapshot: ComponentNode | null;
};

// Playwright's test:end status enum is 'passed' | 'failed' | 'skipped' |
// 'timedOut'. timedOut counts as a failure because to the developer who
// hit the timeout, the test absolutely failed — surfacing it as a
// candidate eval case is the whole point.
const FAILURE_STATUSES = new Set(['failed', 'timedOut']);

export function extractLastFailure(eventsJsonl: string): LastFailure | null {
  type TestRecord = {
    testId: string;
    testTitle?: string;
    specFile?: string;
    lastSnapshot?: ComponentNode;
  };
  const records = new Map<string, TestRecord>();
  let lastFailure: { testId: string; errorMessage: string | undefined } | null = null;

  for (const rawLine of eventsJsonl.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch (err) {
      throw new Error(
        `extractLastFailure: malformed JSON line in events.jsonl: ${(err as Error).message}. Line: ${line.slice(0, 120)}${line.length > 120 ? '…' : ''}`,
      );
    }

    // Narrow by discriminant `t`. We do NOT run parseRunEvent here
    // because that's strict-schema validation; the extractor is
    // resilient to extra fields and tolerant of older event shapes
    // that may live in persisted runs from earlier reactlens versions.
    const e = event as { t?: string; [k: string]: unknown };
    if (typeof e.t !== 'string') continue;

    switch (e.t) {
      case 'test:start': {
        const id = e.id as string | undefined;
        if (id === undefined) continue;
        const r = records.get(id) ?? { testId: id };
        r.testTitle = typeof e.title === 'string' ? e.title : r.testTitle;
        r.specFile = typeof e.file === 'string' ? e.file : r.specFile;
        records.set(id, r);
        break;
      }
      case 'component:snapshot': {
        const id = e.testId as string | undefined;
        if (id === undefined) continue;
        const r = records.get(id) ?? { testId: id };
        // Trust the persisted tree shape — it was validated at write
        // time by the snapshot persistor. Tolerant cast intentional.
        r.lastSnapshot = e.tree as ComponentNode;
        records.set(id, r);
        break;
      }
      case 'test:end': {
        const id = e.id as string | undefined;
        const status = e.status as string | undefined;
        if (id === undefined || status === undefined) continue;
        if (FAILURE_STATUSES.has(status)) {
          // Overwrite — we want the LAST failing test:end in the file.
          lastFailure = {
            testId: id,
            errorMessage: typeof e.error === 'string' ? e.error : undefined,
          };
        }
        break;
      }
      default:
        // Other event types (run:start, run:end, step:*, frame, a11y:*,
        // diagnosis:*) carry no signal the extractor needs. Skip silently.
        break;
    }
  }

  if (lastFailure === null) return null;

  const record = records.get(lastFailure.testId);
  if (record === undefined || record.testTitle === undefined || record.specFile === undefined) {
    // Mismatched test:end without a preceding test:start is a
    // corruption signal — Playwright always pairs them. Throw so the
    // operator notices instead of receiving a half-populated case stub.
    throw new Error(
      `extractLastFailure: test:end for testId=${lastFailure.testId} has no matching test:start in the events.jsonl. The run is malformed.`,
    );
  }

  return {
    testId: lastFailure.testId,
    testTitle: record.testTitle,
    specFile: record.specFile,
    errorMessage: lastFailure.errorMessage,
    snapshot: record.lastSnapshot ?? null,
  };
}
