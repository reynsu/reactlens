// DashboardHub — manages dashboard-client WebSocket connections.
//
// Extracted from `src/dashboard/server.ts` as part of the dashboard
// protocol-separation refactor (architecture review candidate #1).
//
// Owns three coupled concerns that all serve dashboard clients
// specifically:
//
//   1. **Broadcast pipeline.** Subscribes to every bus event type and
//      forwards each event to every connected client. The ring buffer
//      below provides replay for late-joining clients.
//
//   2. **Replay buffer.** Bounded ring (EVENT_BUFFER_LIMIT) of recent
//      RunEvents so a dashboard that connects mid-run still sees the
//      preceding history. Pre-refactor this was a closure variable; here
//      it's per-instance private state, but the observable behavior is
//      identical.
//
//   3. **Inbound messages.** Two client→server message kinds:
//      - `patch:apply` — invokes applyPatch + path-traversal defence,
//        emits patch:applied or patch:rejected on the bus.
//      - `test:rerun-request` — wire-only ack; emits test:rerun-requested
//        on the bus (an external consumer actually re-runs the test).
//
// The probe → server WS is a separate concern: see ProbeIngestor.
//
// The composer (`server.ts`) constructs this, hands the underlying
// WebSocketServer to the upgrade router for `/ws/dashboard` traffic,
// and calls `close()` on shutdown to release bus subscriptions and
// terminate connections.
import { realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { z } from 'zod';
import { WebSocketServer, type WebSocket } from 'ws';
import { applyPatch } from '../applier/patch-applier';
import type { EventBus } from '../runner/event-bus';
import { ALL_EVENT_TYPES, type RunEvent } from '../runner/events';
import { logger } from '../utils/logger';
import type { RunsArea } from '../runs/run-paths';

const EVENT_BUFFER_LIMIT = 500;

// Inbound `patch:apply` schema. Dashboard clients send this over the
// `/ws/dashboard` socket to ask the server to apply a diagnosis patch
// to a real file. Validated at the boundary; malformed inputs are
// dropped silently (no testId to attribute the error to). Well-formed-
// but-unsafe requests (path escapes cwd, no runsArea context) emit a
// patch:rejected so the UI can render the refusal.
const applyRequestSchema = z.object({
  kind: z.literal('patch:apply'),
  testId: z.string(),
  patch: z.object({
    file: z.string(),
    oldStr: z.string(),
    newStr: z.string(),
  }),
});

// Inbound `test:rerun-request` schema (apply-fix loop closure). The
// dashboard sends `{ kind: 'test:rerun-request', testId }` after Apply
// Fix lands; the server validates and emits `test:rerun-requested` onto
// the bus as the acknowledgement. Symmetric to applyRequestSchema.
//
// Wire-level only — actually spawning a re-targeted Playwright run is
// the consumer's job (a future bus subscriber), not this handler's.
const rerunRequestSchema = z.object({
  kind: z.literal('test:rerun-request'),
  testId: z.string(),
});

export type DashboardHubOpts = {
  bus: EventBus;
  // When omitted, `patch:apply` requests are rejected with a
  // 'fs-error' patch:rejected event explaining that there's no cwd
  // to resolve patch.file against. Same fallback the pre-refactor
  // code had.
  runsArea?: RunsArea;
};

export class DashboardHub {
  readonly wss: WebSocketServer;
  private readonly opts: DashboardHubOpts;
  private readonly buffer: RunEvent[] = [];
  private readonly disposers: Array<() => void> = [];

  constructor(opts: DashboardHubOpts) {
    this.opts = opts;
    this.wss = new WebSocketServer({ noServer: true });

    // Subscribe broadcast pipeline first so any event emitted while
    // wiring (test reruns + immediate patch-apply round-trips) lands
    // in the buffer.
    for (const t of ALL_EVENT_TYPES) {
      this.disposers.push(opts.bus.on(t, (e) => this.bufferAndBroadcast(e as RunEvent)));
    }

    this.wss.on('connection', (client: WebSocket) => this.onConnection(client));
  }

  // Closes all client sockets, releases bus subscriptions, and shuts
  // down the WebSocketServer. Idempotent enough — the composer awaits
  // this once during shutdown.
  async close(): Promise<void> {
    for (const d of this.disposers) d();
    for (const c of this.wss.clients) c.close();
    await new Promise<void>((res) => this.wss.close(() => res()));
  }

  private bufferAndBroadcast(event: RunEvent): void {
    this.buffer.push(event);
    if (this.buffer.length > EVENT_BUFFER_LIMIT) this.buffer.shift();
    const payload = JSON.stringify(event);
    for (const client of this.wss.clients) {
      if (client.readyState === client.OPEN) {
        try {
          client.send(payload);
        } catch (err) {
          logger.warn({ err }, 'failed to send to dashboard client');
        }
      }
    }
  }

  private onConnection(client: WebSocket): void {
    // Replay buffered history so a late-joining dashboard isn't blank.
    for (const e of this.buffer) {
      try {
        client.send(JSON.stringify(e));
      } catch {
        /* ignore */
      }
    }

    client.on('message', (data) => this.onMessage(data));
    client.on('error', (err) => logger.warn({ err }, 'dashboard client error'));
  }

  private onMessage(data: unknown): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse((data as { toString(): string }).toString());
    } catch {
      // Unparseable JSON — no testId means no patch:rejected; just drop.
      return;
    }
    const applyResult = applyRequestSchema.safeParse(parsed);
    if (applyResult.success) {
      handleApplyRequest(applyResult.data, this.opts.bus, this.opts.runsArea);
      return;
    }
    const rerunResult = rerunRequestSchema.safeParse(parsed);
    if (rerunResult.success) {
      this.opts.bus.emit({ t: 'test:rerun-requested', testId: rerunResult.data.testId });
      return;
    }
    // Neither schema matched. Could be a future client→server message
    // kind we don't yet recognise; drop silently. Strict rejection
    // would break forward compat with newer dashboard-ui versions.
  }
}

// Apply-request handler. Resolves the patch's file path under cwd (path-
// traversal defence), invokes PatchApplier, and emits the resulting
// patch:applied or patch:rejected event onto the bus. The Hub's
// broadcaster loop subscribes to ALL_EVENT_TYPES so the events flow
// back to every dashboard client + get persisted to events.jsonl via
// the run command's persistor subscription.
//
// Refuses two boundary cases:
//   - runsArea undefined: dashboard was started in legacy mode without
//     a project root, so we have no cwd to resolve patch.file against.
//     Emit a clear patch:rejected so the UI explains the refusal.
//   - resolved path escapes cwd: patch.file = '../etc/passwd' or an
//     absolute path. Same defence the diff route applies elsewhere.
//
// Lives at module scope rather than as a private method because it's
// pure-ish I/O — keeps the class small + matches the testability shape
// of the pre-refactor helper. Hub-internal (not exported) per
// LANGUAGE.md "one adapter = hypothetical seam": only DashboardHub
// calls it, no other adapter justifies exposing it.
function handleApplyRequest(
  req: z.infer<typeof applyRequestSchema>,
  bus: EventBus,
  runsArea: RunsArea | undefined,
): void {
  if (runsArea === undefined) {
    bus.emit({
      t: 'patch:rejected',
      testId: req.testId,
      file: req.patch.file,
      reason: 'fs-error',
      detail: 'dashboard started without a runsArea — no cwd context for path resolution',
    });
    return;
  }
  const absPath = resolve(runsArea.cwd, req.patch.file);
  if (absPath !== runsArea.cwd && !absPath.startsWith(runsArea.cwd + sep)) {
    bus.emit({
      t: 'patch:rejected',
      testId: req.testId,
      file: req.patch.file,
      reason: 'fs-error',
      detail: `resolved path escapes project root: ${absPath}`,
    });
    return;
  }
  // Defensive depth on top of the lexical guard above. A file whose
  // path is under cwd but is a symlink pointing OUTSIDE cwd would have
  // passed startsWith() and let the agent mutate /etc/anything. Resolve
  // symlinks via realpath and re-check containment against the realpath
  // of cwd (cwd itself may be a symlink — e.g. macOS /tmp -> /private/tmp).
  //
  // If realpath fails on the patch.file (typically ENOENT — the user
  // patched a file that doesn't exist yet, or it was deleted between
  // resolve and realpath), fall through. The applier downstream will
  // surface a clean 'fs-error' for the missing file; rejecting here on
  // realpath failure would regress the existing "target file does not
  // exist" test path and confuse the operator with a wrong reason.
  //
  // If realpath fails on cwd itself, that's a real environment problem
  // worth surfacing — don't paper over it.
  let realCwd: string;
  try {
    realCwd = realpathSync(runsArea.cwd);
  } catch (err) {
    bus.emit({
      t: 'patch:rejected',
      testId: req.testId,
      file: req.patch.file,
      reason: 'fs-error',
      detail: `realpath(cwd) failed: ${(err as Error).message}`,
    });
    return;
  }
  let realPath: string | null;
  try {
    realPath = realpathSync(absPath);
  } catch {
    realPath = null; // file probably doesn't exist yet; let applier handle it
  }
  if (realPath !== null && realPath !== realCwd && !realPath.startsWith(realCwd + sep)) {
    bus.emit({
      t: 'patch:rejected',
      testId: req.testId,
      file: req.patch.file,
      reason: 'fs-error',
      detail: `symlink target escapes project root: ${realPath}`,
    });
    return;
  }
  // Hand the applier the realpath when we have it (so the atomic-rename
  // step lands on the real underlying file rather than replacing the
  // symlink itself, which would silently break legitimate intra-cwd
  // symlinks). Otherwise stick with the lexical path the applier will
  // honestly fail on with 'fs-error'.
  const file = realPath ?? absPath;
  const result = applyPatch({
    file,
    oldStr: req.patch.oldStr,
    newStr: req.patch.newStr,
  });
  if (result.ok) {
    bus.emit({
      t: 'patch:applied',
      testId: req.testId,
      file: req.patch.file,
      oldStr: req.patch.oldStr,
      newStr: req.patch.newStr,
    });
    return;
  }
  bus.emit({
    t: 'patch:rejected',
    testId: req.testId,
    file: req.patch.file,
    reason: result.reason,
    ...(result.detail !== undefined ? { detail: result.detail } : {}),
  });
}
