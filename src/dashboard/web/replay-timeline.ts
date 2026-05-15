// Pure parser that walks a run's events.jsonl and produces the per-test
// TimelineStep[] structure the slider scrubs over.
//
// Lives in its own module — separate from App.tsx — so both the live
// loadPastRun() path and the integration test can call the exact same
// function. No React, no fetch, no DOM.
import { parseRunEvent } from '../../runner/events';
import type { TimelineStep } from './types';

export type Timeline = Map<string, TimelineStep[]>;

// Build URL for a frame ref. Exposed so callers in different environments
// (production fetch base = origin; integration test = explicit baseUrl)
// can plug in their own prefix.
export type FrameUrlBuilder = (frameRef: string) => string;

export function buildTimelineFromEvents(ndjson: string, frameUrl: FrameUrlBuilder): Timeline {
  const timelineByTest: Timeline = new Map();
  // Currently-open step index per test. Frame events lack stepId on the wire,
  // so we use this to attach freshly-arrived frames to the right entry.
  // component:snapshot carries its own stepId; we prefer that when present.
  const openStepIdx = new Map<string, number>();

  for (const line of ndjson.split('\n')) {
    if (line.length === 0) continue;
    let event;
    try {
      event = parseRunEvent(JSON.parse(line));
    } catch {
      continue;
    }
    if (event === null) continue;

    if (event.t === 'step:start') {
      const arr = timelineByTest.get(event.testId) ?? [];
      arr.push({ stepId: event.stepId, title: event.title });
      timelineByTest.set(event.testId, arr);
      openStepIdx.set(event.testId, arr.length - 1);
    } else if (event.t === 'frame') {
      const arr = timelineByTest.get(event.testId);
      const idx = openStepIdx.get(event.testId);
      if (arr !== undefined && idx !== undefined && event.frameRef !== undefined) {
        const step = arr[idx];
        if (step !== undefined) step.frame = { kind: 'url', url: frameUrl(event.frameRef) };
      }
    } else if (event.t === 'component:snapshot') {
      const arr = timelineByTest.get(event.testId);
      if (arr !== undefined && arr.length > 0) {
        const matched = arr.findIndex((s) => s.stepId === event.stepId);
        const idx = matched >= 0 ? matched : (openStepIdx.get(event.testId) ?? arr.length - 1);
        const step = arr[idx];
        if (step !== undefined) step.tree = event.tree;
      }
    }
  }

  return timelineByTest;
}
