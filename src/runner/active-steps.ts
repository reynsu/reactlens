// Pure value object that tracks "what step is each test currently in" by
// consuming RunEvents the caller routes through `observe()`. Lives here
// rather than as inline Maps inside EventPersistor + ProbeIngestor because
// both need the same shape (Map<testId, stepId>) and the same `step:start`
// update rule — and because the cleanup variants both modules need
// (`step:end` with the match-guard vs. unconditional `test:end`) are
// surprising enough that centralizing them avoids a future caller
// reinventing the wrong one.
//
// Pure on purpose: no bus dependency. Callers route events via their own
// subscription (EventPersistor from inside `accept()`; ProbeIngestor from
// two `bus.on()` handlers) so testing the tracker doesn't require a bus
// and the bus subscription strategy stays the caller's concern.
import type { RunEvent } from './events';

export type ClearPolicy =
  // EventPersistor — clear only when the step:end matches the current
  // step. Defensive: a late step:end for an older step must not clobber a
  // newer step:start that already overwrote.
  | 'step:end'
  // ProbeIngestor — clear unconditionally on test:end. Broader: the probe
  // just wants the latest step for stamping; within-test step transitions
  // are handled by step:start overwrites.
  | 'test:end';

export interface ActiveSteps {
  // Returns the current stepId for the testId, or undefined if no
  // step:start has fired yet for that testId.
  get(testId: string): string | undefined;
  // Routes one RunEvent through the tracker. Caller decides where to call
  // this from (sink `accept()`, bus subscription handler, etc.). Events
  // outside the tracker's vocabulary (frame, run:start, etc.) are silently
  // ignored.
  observe(event: RunEvent): void;
}

export function createActiveSteps(opts: { clearOn: ClearPolicy }): ActiveSteps {
  const map = new Map<string, string>();
  return {
    get: (testId) => map.get(testId),
    observe: (event) => {
      if (event.t === 'step:start') {
        map.set(event.testId, event.stepId);
        return;
      }
      if (opts.clearOn === 'step:end' && event.t === 'step:end') {
        if (map.get(event.testId) === event.stepId) map.delete(event.testId);
        return;
      }
      if (opts.clearOn === 'test:end' && event.t === 'test:end') {
        map.delete(event.id);
      }
    },
  };
}
