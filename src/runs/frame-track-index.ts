// #78 (reactlens side): read-side extraction of a run's per-frame index from
// its persisted NDJSON. Backs GET /api/runs/:id/frame-track — the dashboard
// fetches this on replay and its (pure) builder orders the entries into a
// playable per-test track. Live frames take the WS path instead; this is the
// hydrate-from-disk half.
//
// Goes through parseRunEvent (the boundary parser) per CLAUDE.md §13: reading
// persisted JSONL is an ingestion point. Only DISK-shape frame lines (those
// carrying a frameRef) are included — WIRE frames never reach disk, and a
// line that fails the parser is skipped (partial-corruption tolerant, like
// RunsArea's run summarizer).
import { parseRunEvent } from '../runner/events';

export type FrameTrackIndexEntry = {
  testId: string;
  stepId: string;
  frameRef: string;
  timestamp?: number;
};

export function extractFrameTrackIndex(ndjson: string): FrameTrackIndexEntry[] {
  const out: FrameTrackIndexEntry[] = [];
  for (const line of ndjson.split('\n')) {
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const event = parseRunEvent(parsed);
    if (event?.t === 'frame' && typeof event.frameRef === 'string') {
      out.push({
        testId: event.testId,
        // Disk frames always carry a stepId in practice; fall back to the
        // testId for any pre-step / malformed line so the track stays usable.
        stepId: event.stepId ?? event.testId,
        frameRef: event.frameRef,
        ...(event.timestamp !== undefined ? { timestamp: event.timestamp } : {}),
      });
    }
  }
  return out;
}
