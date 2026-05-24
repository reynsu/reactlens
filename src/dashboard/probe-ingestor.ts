// ProbeIngestor — accepts component-tree snapshots from the in-app
// probe and stamps each one with the active Playwright stepId before
// emitting onto the bus.
//
// Extracted from `src/dashboard/server.ts` as part of the dashboard
// protocol-separation refactor (architecture review candidate #1).
//
// Owns the whole "stamp probe-side events with the active stepId"
// concern end-to-end:
//   - Maintains `activeStep: Map<testId, stepId>` updated from the
//     bus's step:start / test:end events.
//   - Receives probe WS messages.
//   - Rewrites stepId on component:snapshot / component:event using
//     the current activeStep for that testId.
//   - Emits the rewritten event back onto the bus.
//
// Why the probe needs this: the probe sees React fiber commits, not
// the Playwright step lifecycle. The fixture sets stepId = testId
// once at mount. step:start events flow through the bus during the
// test; we overwrite the probe's default with the real stepId so
// time-travel replay can scrub between distinct steps.
//
// Cleaning up on test:end keeps the map bounded across long runs
// (otherwise every test we ever observed would leak an entry).
//
// The composer (`server.ts`) constructs this, hands the underlying
// WebSocketServer to the upgrade router for `/ws/probe` traffic, and
// calls `close()` on shutdown.
import { WebSocketServer, type WebSocket } from 'ws';
import type { EventBus } from '../runner/event-bus';
import { tryIngestRunEvent } from '../runner/event-ingestion';
import { logger } from '../utils/logger';

export type ProbeIngestorOpts = {
  bus: EventBus;
};

export class ProbeIngestor {
  readonly wss: WebSocketServer;
  private readonly opts: ProbeIngestorOpts;
  // testId → current stepId. Updated by bus subscriptions; consumed
  // on each probe message to rewrite stepId on component-* events.
  private readonly activeStep = new Map<string, string>();
  private readonly disposers: Array<() => void> = [];

  constructor(opts: ProbeIngestorOpts) {
    this.opts = opts;
    this.wss = new WebSocketServer({ noServer: true });

    // Bus subscriptions: every step:start updates the active stepId
    // for its testId; every test:end clears the entry. Owning these
    // here (rather than in the composer) keeps the active-step concern
    // self-contained in the module that needs it.
    this.disposers.push(opts.bus.on('step:start', (e) => this.activeStep.set(e.testId, e.stepId)));
    this.disposers.push(opts.bus.on('test:end', (e) => this.activeStep.delete(e.id)));

    this.wss.on('connection', (client: WebSocket) => this.onConnection(client));
  }

  async close(): Promise<void> {
    for (const d of this.disposers) d();
    for (const c of this.wss.clients) c.close();
    await new Promise<void>((res) => this.wss.close(() => res()));
  }

  private onConnection(client: WebSocket): void {
    client.on('message', (data) => this.onMessage(data));
    client.on('error', (err) => logger.warn({ err }, 'probe client error'));
  }

  private onMessage(data: unknown): void {
    // tryIngestRunEvent handles both Buffer + string and combines
    // JSON.parse + schema validation; returns null on either failure
    // for the soft path the probe pipeline wants (drop bad frames,
    // keep streaming the good ones). Per the event-ingestion module's
    // boundary contract (#57).
    const event = tryIngestRunEvent(data as Buffer);
    if (event === null) {
      logger.warn(
        { preview: (data as { toString(): string }).toString().slice(0, 200) },
        'probe message failed JSON.parse or schema validation; dropped',
      );
      return;
    }

    // Rewrite stepId on component-* events so it reflects the active
    // Playwright step rather than the testId-shaped default the probe
    // baked in at addInitScript time.
    if (event.t === 'component:snapshot' || event.t === 'component:event') {
      const active = this.activeStep.get(event.testId);
      if (active !== undefined) (event as { stepId: string }).stepId = active;
    }
    // Echo onto the bus so other subscribers (DashboardHub broadcast,
    // EventPersistor, diagnosis subscriber) see it.
    this.opts.bus.emit(event);
  }
}
