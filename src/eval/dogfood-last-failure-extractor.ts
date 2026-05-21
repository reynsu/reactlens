// Extracts the last failing test from a single run's events.jsonl.
//
// Slice #15 of v0.3 #7: the `reactlens eval add-from-last-failure`
// dogfood subcommand turns the most recent real-world failure the
// developer hit into a candidate eval case. This module is the
// extraction step — given the raw JSONL text of the persisted run,
// return the failing test's artifacts (or null if nothing failed).
//
// Pure: text-in, object-out. Caller (the orchestrator) reads the
// JSONL from disk via RunsArea.loadEvents() and decides what to do
// with the null path.
//
// Contract:
//   - returns null when no failing test:end exists. Caller surfaces
//     a clear operator message — null is not an error condition,
//     just "nothing to harvest".
//   - throws on malformed JSON lines. Per Principle 2 this is a
//     corruption signal (partial-line write, probe regression) that
//     must surface; silently skipping bad lines would feed wrong
//     artifacts into the harvested case.
import type { ComponentNode } from '../runner/events';

export type LastFailure = {
  testId: string;
  testTitle: string;
  // Absolute path to the spec file from the test:start event.
  // Caller may slice it to a repo-relative path; we don't presume.
  specFile: string;
  // The error message from test:end.error, when Playwright surfaced one.
  // Some failure modes (timeouts, env errors) ship a useful message;
  // others (assertion failures) may or may not. undefined when absent.
  errorMessage: string | undefined;
  // The LAST component:snapshot observed for this testId. null when
  // the probe never connected (env-issue runs) or the test failed
  // before any step:snapshot was emitted. The case-emitter handles
  // the null path gracefully.
  snapshot: ComponentNode | null;
};

// Status values that count as a failure for the purposes of dogfood.
// Playwright's test:end status enum is 'passed' | 'failed' | 'skipped' |
// 'timedOut'. We include timedOut because to the developer who hit
// the timeout, the test absolutely failed — surfacing it as a candidate
// eval case is the whole point.
const FAILURE_STATUSES = new Set(['failed', 'timedOut']);

export function extractLastFailure(eventsJsonl: string): LastFailure | null {
  // Stream-style accumulator: walk every line in order, building up
  // per-testId records (title, spec file, snapshots), and remembering
  // the LAST failing test:end as we go. Single pass; no allocation
  // beyond the per-test record map.
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
