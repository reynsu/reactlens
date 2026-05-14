// Pure parser that walks a run's events.jsonl and produces the per-test
// TimelineStep[] structure the slider scrubs over.
//
// Lives in its own module — separate from App.tsx — so both the live
// loadPastRun() path and the integration test can call the exact same
// function. No React, no fetch, no DOM.
import type { ComponentNode, TimelineStep } from './types';

export type Timeline = Map<string, TimelineStep[]>;

// Build URL for a frame ref. Exposed so callers in different environments
// (production fetch base = origin; integration test = explicit baseUrl)
// can plug in their own prefix.
export type FrameUrlBuilder = (frameRef: string) => string;

export function buildTimelineFromEvents(ndjson: string, frameUrl: FrameUrlBuilder): Timeline {
  const timelineByTest: Timeline = new Map();
  // Currently-open step index per test. Frame events lack stepId, so we use
  // this to attach freshly-arrived frames to the right entry. component:snapshot
  // carries its own stepId; we prefer that when present.
  const openStepIdx = new Map<string, number>();

  for (const line of ndjson.split('\n')) {
    if (line.length === 0) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const t = parsed['t'];
    const testId = parsed['testId'] as string | undefined;

    if (t === 'step:start' && testId !== undefined) {
      const arr = timelineByTest.get(testId) ?? [];
      arr.push({
        stepId: (parsed['stepId'] as string | undefined) ?? '',
        title: (parsed['title'] as string | undefined) ?? '',
      });
      timelineByTest.set(testId, arr);
      openStepIdx.set(testId, arr.length - 1);
    } else if (t === 'frame' && testId !== undefined) {
      const frameRef = parsed['frameRef'] as string | undefined;
      const arr = timelineByTest.get(testId);
      const idx = openStepIdx.get(testId);
      if (arr !== undefined && idx !== undefined && frameRef !== undefined) {
        const step = arr[idx];
        if (step !== undefined) step.frame = { kind: 'url', url: frameUrl(frameRef) };
      }
    } else if (t === 'component:snapshot' && testId !== undefined) {
      const stepId = parsed['stepId'] as string | undefined;
      const arr = timelineByTest.get(testId);
      if (arr !== undefined && arr.length > 0) {
        const matched = stepId !== undefined ? arr.findIndex((s) => s.stepId === stepId) : -1;
        const idx = matched >= 0 ? matched : (openStepIdx.get(testId) ?? arr.length - 1);
        const step = arr[idx];
        if (step !== undefined) step.tree = parsed['tree'] as ComponentNode;
      }
    }
  }

  return timelineByTest;
}
