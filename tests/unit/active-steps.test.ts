// Active-step tracker — pure value object that callers (EventPersistor +
// ProbeIngestor) route RunEvents into so each can resolve "what step is
// this test currently in" for events that arrive without a stepId.
//
// Two callers with different cleanup policies (the whole reason this is a
// shared module rather than two inline Maps):
//   - 'step:end' (EventPersistor) — clear only when the step:end matches
//     the current step. Defensive: a late step:end for an older step must
//     not clobber a newer step:start that already overwrote.
//   - 'test:end' (ProbeIngestor) — clear unconditionally on test:end.
//     Broader: the probe just wants the latest step for stamping; within-
//     test step transitions are handled by step:start overwrites.
import { describe, expect, it } from 'vitest';
import { createActiveSteps } from '../../src/runner/active-steps';

describe('ActiveSteps — pure value object', () => {
  it('get() returns undefined when nothing has been set for the testId', () => {
    const steps = createActiveSteps({ clearOn: 'step:end' });
    expect(steps.get('t1')).toBeUndefined();
  });

  it('observe(step:start) records the stepId; get() returns it', () => {
    const steps = createActiveSteps({ clearOn: 'step:end' });
    steps.observe({ t: 'step:start', testId: 't1', stepId: 's1', title: 'click' });
    expect(steps.get('t1')).toBe('s1');
  });

  it('a second step:start overwrites the prior step for the same testId', () => {
    const steps = createActiveSteps({ clearOn: 'step:end' });
    steps.observe({ t: 'step:start', testId: 't1', stepId: 's1', title: 'click' });
    steps.observe({ t: 'step:start', testId: 't1', stepId: 's2', title: 'type' });
    expect(steps.get('t1')).toBe('s2');
  });

  it('tracks distinct testIds independently', () => {
    const steps = createActiveSteps({ clearOn: 'step:end' });
    steps.observe({ t: 'step:start', testId: 't1', stepId: 's-a', title: 'a' });
    steps.observe({ t: 'step:start', testId: 't2', stepId: 's-b', title: 'b' });
    expect(steps.get('t1')).toBe('s-a');
    expect(steps.get('t2')).toBe('s-b');
  });

  it('ignores irrelevant event types (frame, test:start, etc.)', () => {
    const steps = createActiveSteps({ clearOn: 'step:end' });
    steps.observe({ t: 'step:start', testId: 't1', stepId: 's1', title: 'click' });
    steps.observe({ t: 'test:start', id: 't2', title: 'x', file: 'x.spec.ts', suite: 's' });
    steps.observe({ t: 'frame', testId: 't1', data: 'abc', sessionId: 'sess-1' });
    // The step is still 's1' — nothing irrelevant cleared or overwrote it.
    expect(steps.get('t1')).toBe('s1');
  });
});

describe('ActiveSteps — clearOn: "step:end" (EventPersistor policy)', () => {
  it('step:end matching the current stepId clears the testId', () => {
    const steps = createActiveSteps({ clearOn: 'step:end' });
    steps.observe({ t: 'step:start', testId: 't1', stepId: 's1', title: 'click' });
    steps.observe({ t: 'step:end', testId: 't1', stepId: 's1', status: 'passed' });
    expect(steps.get('t1')).toBeUndefined();
  });

  it('step:end with a NON-matching stepId is ignored (a late step:end for an older step must not clobber a newer step:start)', () => {
    const steps = createActiveSteps({ clearOn: 'step:end' });
    steps.observe({ t: 'step:start', testId: 't1', stepId: 's-old', title: 'a' });
    steps.observe({ t: 'step:start', testId: 't1', stepId: 's-new', title: 'b' });
    // Late step:end for the OLD step lands AFTER the new step:start.
    steps.observe({ t: 'step:end', testId: 't1', stepId: 's-old', status: 'passed' });
    // The new step is still active.
    expect(steps.get('t1')).toBe('s-new');
  });

  it('test:end is IGNORED under this policy (persistor cares about step lifecycle, not test lifecycle)', () => {
    const steps = createActiveSteps({ clearOn: 'step:end' });
    steps.observe({ t: 'step:start', testId: 't1', stepId: 's1', title: 'click' });
    steps.observe({ t: 'test:end', id: 't1', status: 'passed', duration: 12 });
    expect(steps.get('t1')).toBe('s1');
  });
});

describe('ActiveSteps — clearOn: "test:end" (ProbeIngestor policy)', () => {
  it('test:end clears the testId unconditionally', () => {
    const steps = createActiveSteps({ clearOn: 'test:end' });
    steps.observe({ t: 'step:start', testId: 't1', stepId: 's1', title: 'click' });
    steps.observe({ t: 'test:end', id: 't1', status: 'passed', duration: 12 });
    expect(steps.get('t1')).toBeUndefined();
  });

  it('test:end for one testId does not affect siblings', () => {
    const steps = createActiveSteps({ clearOn: 'test:end' });
    steps.observe({ t: 'step:start', testId: 't1', stepId: 's-a', title: 'a' });
    steps.observe({ t: 'step:start', testId: 't2', stepId: 's-b', title: 'b' });
    steps.observe({ t: 'test:end', id: 't1', status: 'passed', duration: 1 });
    expect(steps.get('t1')).toBeUndefined();
    expect(steps.get('t2')).toBe('s-b');
  });

  it('step:end is IGNORED under this policy (the probe just wants the latest step for stamping)', () => {
    const steps = createActiveSteps({ clearOn: 'test:end' });
    steps.observe({ t: 'step:start', testId: 't1', stepId: 's1', title: 'click' });
    steps.observe({ t: 'step:end', testId: 't1', stepId: 's1', status: 'passed' });
    expect(steps.get('t1')).toBe('s1');
  });
});
