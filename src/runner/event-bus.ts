import type { RunEvent, RunEventByType, RunEventType } from './events';

type Handler<T extends RunEventType> = (event: RunEventByType<T>) => void;

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
