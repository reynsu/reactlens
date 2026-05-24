// Module Interface tests for tryIngestRunEvent — the single-function
// ingestion boundary that converts an untyped data source (stdin line,
// WS frame, JSONL line) into a typed RunEvent.
//
// Per LANGUAGE.md "two adapters = real seam": today there are 5
// production ingestion call sites, ALL soft-semantics. The originally-
// proposed `mustIngestRunEvent` (hard-throw variant) was dropped
// because no current caller justifies it — adding it would be a
// hypothetical seam. When a "must" caller appears (CI artifact import
// is the canonical example), introduce the second function then.
import { describe, expect, it } from 'vitest';
import { tryIngestRunEvent } from '../../src/runner/event-ingestion';

const VALID_RUN_START = JSON.stringify({
  t: 'run:start',
  runId: '2026-05-23T22-00-00Z-deadbeef',
  totalTests: 1,
  timestamp: 1747789200000,
});

describe('tryIngestRunEvent — happy path', () => {
  it('parses a valid JSON string into a typed RunEvent', () => {
    const ev = tryIngestRunEvent(VALID_RUN_START);
    if (ev === null) throw new Error('expected non-null');
    expect(ev.t).toBe('run:start');
    if (ev.t !== 'run:start') throw new Error('discriminant narrowing failed');
    expect(ev.runId).toBe('2026-05-23T22-00-00Z-deadbeef');
    expect(ev.totalTests).toBe(1);
  });

  it('accepts Buffer input (the shape WS clients give us)', () => {
    const ev = tryIngestRunEvent(Buffer.from(VALID_RUN_START, 'utf8'));
    if (ev === null) throw new Error('expected non-null');
    expect(ev.t).toBe('run:start');
  });
});

describe('tryIngestRunEvent — soft failure paths return null', () => {
  it('returns null on malformed JSON (probe-side bug or partial write)', () => {
    expect(tryIngestRunEvent('this is not json')).toBeNull();
  });

  it('returns null on truncated JSON', () => {
    expect(tryIngestRunEvent('{"t":"run:start","runId":"x"')).toBeNull();
  });

  it('returns null on empty string', () => {
    expect(tryIngestRunEvent('')).toBeNull();
  });

  it('returns null on valid JSON that fails the RunEvent schema', () => {
    // Parses as JSON but `t` is not a known discriminant.
    expect(tryIngestRunEvent(JSON.stringify({ t: 'not-a-real-event-type' }))).toBeNull();
  });

  it('returns null on JSON missing required fields for its event kind', () => {
    // `run:start` requires runId + totalTests + timestamp.
    expect(tryIngestRunEvent(JSON.stringify({ t: 'run:start' }))).toBeNull();
  });
});

