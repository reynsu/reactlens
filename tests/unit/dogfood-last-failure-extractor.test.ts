// TDD for the last-failure extractor (slice #15 of v0.3 #7).
//
// Given a single run's events.jsonl text, find the MOST RECENT failing
// test:end event and gather the artifacts the dogfood `add-from-last-
// failure` subcommand needs:
//
//   - testId + testTitle + spec file (from test:start)
//   - error message (from test:end.error)
//   - the LAST component:snapshot for that testId (snapshot at failure)
//
// Pure: parse-text-return-object. Caller is responsible for reading
// the events.jsonl from disk and for handling the no-failure case.
//
// The extractor's loud-throw / soft-return contract:
//   - returns null when no failing test:end exists (caller surfaces
//     a clear message to the operator; not an error condition)
//   - throws on malformed JSON lines (these are corruption signals
//     per Principle 2 — a partial-line write or a probe regression
//     should surface, not be silently skipped)
import { describe, expect, it } from 'vitest';
import { extractLastFailure } from '../../src/eval/dogfood-last-failure-extractor';

// JSONL string builder for inline test fixtures. Each event is a
// canonical RunEvent shape per CLAUDE.md §9.
function jsonl(...events: object[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

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
    // SAMPLE_RUN has a CartBanner snapshot for the passing t1 and a
    // CheckoutPage snapshot for the failing t2. The extractor must
    // attribute the right snapshot to the failure — mixing them
    // would feed CartBanner data into a CheckoutPage diagnosis.
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
