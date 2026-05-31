// #78 (reactlens side): the read-side extraction that backs
// GET /api/runs/:id/frame-track. Turns a run's persisted NDJSON into the
// per-frame index the dashboard builder later orders into a playable track.
import { describe, expect, it } from 'vitest';
import { extractFrameTrackIndex } from '../../src/runs/frame-track-index';

function ndjson(events: unknown[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

describe('extractFrameTrackIndex (#78)', () => {
  it('extracts disk-shape frame lines in file order with ts + stepId + frameRef', () => {
    const raw = ndjson([
      { t: 'run:start', runId: 'r', totalTests: 1, timestamp: 0 },
      { t: 'step:start', testId: 't1', stepId: 's1', title: 'a' },
      { t: 'frame', testId: 't1', stepId: 's1', sessionId: 'x', frameRef: 'frames/t1/0.jpg', timestamp: 1700000000001 },
      { t: 'frame', testId: 't1', stepId: 's1', sessionId: 'x', frameRef: 'frames/t1/1.jpg', timestamp: 1700000000002 },
      { t: 'step:start', testId: 't1', stepId: 's2', title: 'b' },
      { t: 'frame', testId: 't1', stepId: 's2', sessionId: 'x', frameRef: 'frames/t1/2.jpg', timestamp: 1700000000003 },
      { t: 'run:end', passed: 1, failed: 0, skipped: 0, duration: 10 },
    ]);
    expect(extractFrameTrackIndex(raw)).toEqual([
      { testId: 't1', stepId: 's1', frameRef: 'frames/t1/0.jpg', timestamp: 1700000000001 },
      { testId: 't1', stepId: 's1', frameRef: 'frames/t1/1.jpg', timestamp: 1700000000002 },
      { testId: 't1', stepId: 's2', frameRef: 'frames/t1/2.jpg', timestamp: 1700000000003 },
    ]);
  });

  it('tolerates a pre-feature run (per-step stills, no timestamp) — degenerate but non-empty', () => {
    const raw = ndjson([
      { t: 'frame', testId: 't1', stepId: 'step-a', sessionId: 'x', frameRef: 'frames/t1/step-a.jpg' },
    ]);
    expect(extractFrameTrackIndex(raw)).toEqual([
      { testId: 't1', stepId: 'step-a', frameRef: 'frames/t1/step-a.jpg' },
    ]);
  });

  it('skips WIRE frames (data, no frameRef), malformed lines, and non-frame events', () => {
    const raw =
      ndjson([
        { t: 'frame', testId: 't1', sessionId: 'x', data: 'BASE64==' }, // wire — no frameRef
        { t: 'component:snapshot', testId: 't1', stepId: 's1', tree: { name: 'A', props: {}, children: [] } },
      ]) + 'not json\n';
    expect(extractFrameTrackIndex(raw)).toEqual([]);
  });

  it('falls back stepId → testId when a frame line somehow lacks a stepId', () => {
    const raw = ndjson([
      { t: 'frame', testId: 't1', sessionId: 'x', frameRef: 'frames/t1/0.jpg' },
    ]);
    expect(extractFrameTrackIndex(raw)).toEqual([
      { testId: 't1', stepId: 't1', frameRef: 'frames/t1/0.jpg' },
    ]);
  });

  it('returns [] for empty input', () => {
    expect(extractFrameTrackIndex('')).toEqual([]);
  });
});
