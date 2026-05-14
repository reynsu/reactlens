import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { EventBus } from '../../src/runner/event-bus';
import type { RunEvent } from '../../src/runner/events';

describe('EventBus', () => {
  it('delivers events to subscribers of matching `t`', () => {
    const bus = new EventBus();
    const onTestEnd = vi.fn();
    const onRunEnd = vi.fn();
    bus.on('test:end', onTestEnd);
    bus.on('run:end', onRunEnd);

    bus.emit({ t: 'test:end', id: 't1', status: 'passed', duration: 12 });
    expect(onTestEnd).toHaveBeenCalledTimes(1);
    expect(onRunEnd).not.toHaveBeenCalled();
  });

  it('unsubscribes via the returned disposer', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const dispose = bus.on('run:start', handler);
    bus.emit({ t: 'run:start', runId: 'test-run-id', totalTests: 1, timestamp: 0 });
    expect(handler).toHaveBeenCalledTimes(1);
    dispose();
    bus.emit({ t: 'run:start', runId: 'test-run-id', totalTests: 1, timestamp: 0 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not let one subscriber crash break delivery to others', () => {
    const bus = new EventBus();
    const good = vi.fn();
    bus.on('run:start', () => {
      throw new Error('boom');
    });
    bus.on('run:start', good);
    bus.emit({ t: 'run:start', runId: 'test-run-id', totalTests: 1, timestamp: 0 });
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('handler arg is narrowed to the matching variant at compile time', () => {
    const bus = new EventBus();
    bus.on('test:end', (event) => {
      expectTypeOf(event.t).toEqualTypeOf<'test:end'>();
      expectTypeOf(event.status).toEqualTypeOf<'passed' | 'failed' | 'skipped' | 'timedOut'>();
      // `event.title` only exists on test:start — accessing it must NOT compile.
      // @ts-expect-error event variant has no `title` property
      void event.title;
    });
    bus.emit({ t: 'test:end', id: 't1', status: 'passed', duration: 1 });
  });

  it('rejects emitting an event shape that does not match its `t`', () => {
    const bus = new EventBus();
    // @ts-expect-error missing required fields `runId` and `totalTests` for run:start
    const bad: RunEvent = { t: 'run:start', timestamp: 0 };
    void bad;
  });
});
