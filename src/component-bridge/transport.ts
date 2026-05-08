/// <reference lib="dom" />
// WS client for the in-app probe. Buffers events while connecting, retries
// with exponential backoff on disconnect, throttles outbound snapshots so
// chatty React apps don't flood the dashboard. NEVER blocks the user's app —
// every send is fire-and-forget.

type ProbeEvent =
  | {
      t: 'component:snapshot';
      testId: string;
      stepId: string;
      tree: unknown;
    }
  | {
      t: 'component:event';
      testId: string;
      stepId: string;
      kind: 'mount' | 'unmount' | 'update';
      componentName: string;
      props?: Record<string, unknown>;
    };

const SNAPSHOT_THROTTLE_MS = 100; // 10 events/sec ceiling per CLAUDE.md 3.4
const MAX_BACKOFF_MS = 5_000;
const INITIAL_BACKOFF_MS = 200;

export class Transport {
  private ws: WebSocket | null = null;
  private buffer: ProbeEvent[] = [];
  private opening = false;
  private backoffMs = INITIAL_BACKOFF_MS;
  private lastSnapshotAt = 0;
  private pendingSnapshot: ProbeEvent | null = null;
  private throttleHandle: number | null = null;
  private disposed = false;

  constructor(private readonly url: string) {}

  start(): void {
    if (this.ws !== null || this.opening || this.disposed) return;
    this.opening = true;
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;
    socket.addEventListener('open', () => {
      this.opening = false;
      this.backoffMs = INITIAL_BACKOFF_MS;
      this.flush();
    });
    const reconnect = (): void => {
      if (this.disposed) return;
      this.ws = null;
      this.opening = false;
      this.scheduleReconnect();
    };
    socket.addEventListener('close', reconnect);
    socket.addEventListener('error', () => {
      try {
        socket.close();
      } catch {
        /* already closing */
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    setTimeout(() => this.start(), delay);
  }

  send(event: ProbeEvent): void {
    if (event.t === 'component:snapshot') {
      this.enqueueSnapshotThrottled(event);
      return;
    }
    this.buffer.push(event);
    this.flush();
  }

  private enqueueSnapshotThrottled(event: ProbeEvent): void {
    const now = Date.now();
    const elapsed = now - this.lastSnapshotAt;
    if (elapsed >= SNAPSHOT_THROTTLE_MS) {
      this.lastSnapshotAt = now;
      this.buffer.push(event);
      this.flush();
      return;
    }
    // Coalesce: keep only the most recent snapshot during the throttle window.
    this.pendingSnapshot = event;
    if (this.throttleHandle !== null) return;
    const wait = SNAPSHOT_THROTTLE_MS - elapsed;
    this.throttleHandle = setTimeout(() => {
      this.throttleHandle = null;
      const pending = this.pendingSnapshot;
      this.pendingSnapshot = null;
      if (pending !== null) {
        this.lastSnapshotAt = Date.now();
        this.buffer.push(pending);
        this.flush();
      }
    }, wait) as unknown as number;
  }

  private flush(): void {
    if (this.ws === null || this.ws.readyState !== WebSocket.OPEN) return;
    while (this.buffer.length > 0) {
      const next = this.buffer.shift();
      if (next === undefined) break;
      try {
        this.ws.send(JSON.stringify(next));
      } catch {
        // Reinsert at head; reconnect will retry.
        this.buffer.unshift(next);
        return;
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.throttleHandle !== null) {
      clearTimeout(this.throttleHandle);
      this.throttleHandle = null;
    }
    if (this.ws !== null) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
  }
}
