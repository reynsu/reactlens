import { ALL_EVENT_TYPES, type RunEvent, type RunEventByType, type RunEventType } from './events';

type Handler<T extends RunEventType> = (event: RunEventByType<T>) => void;

// A consumer that wants every RunEvent in chronological order. The bus
// owns the subscription protocol — sinks no longer track their own
// disposers or `for (const t of ALL_EVENT_TYPES) bus.on(t, ...)` loops.
//
// Three production adapters in tree today: EventPersistor (writes JSONL +
// frame JPEGs to .reactlens/runs/<id>/), DashboardHub (buffers + broadcasts
// to dashboard-ui WS clients), plus an ad-hoc inline sink in the JSON-
// reporter path of `reactlens run`. The first two are the reason this
// Interface exists (rule of two adapters); the inline one is small enough
// to stay inline.
export interface EventSink {
  accept(event: RunEvent): void;
}

export class EventBus {
  private handlers: { [K in RunEventType]?: Set<Handler<K>> } = {};

  on<T extends RunEventType>(t: T, handler: Handler<T>): () => void {
    let set = this.handlers[t] as Set<Handler<T>> | undefined;
    if (set === undefined) {
      set = new Set<Handler<T>>();
      this.handlers[t] = set as never;
    }
    set.add(handler);
    return () => set?.delete(handler);
  }

  // Subscribes a sink to every RunEvent variant. Returns a single
  // unsubscribe function that releases every per-type subscription;
  // callers store this and call it during their own teardown.
  addSink(sink: EventSink): () => void {
    const unsubs: Array<() => void> = [];
    for (const t of ALL_EVENT_TYPES) {
      unsubs.push(this.on(t, (event) => sink.accept(event as RunEvent)));
    }
    return () => {
      for (const u of unsubs) u();
    };
  }

  emit(event: RunEvent): void {
    const set = this.handlers[event.t] as Set<Handler<RunEventType>> | undefined;
    if (set === undefined) return;
    for (const handler of set) {
      try {
        handler(event as never);
      } catch {
        // Subscribers must not crash the bus. Errors are swallowed here; the
        // dashboard server logs them at error level via its own try/catch.
      }
    }
  }

  removeAll(): void {
    this.handlers = {};
  }
}
