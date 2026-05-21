import express from 'express';
import { createServer, type Server as HttpServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { z } from 'zod';
import { WebSocketServer, type WebSocket } from 'ws';
import { applyPatch } from '../applier/patch-applier';
import { logger } from '../utils/logger';
import { EventBus } from '../runner/event-bus';
import { ALL_EVENT_TYPES, parseRunEvent, type RunEvent } from '../runner/events';
import { frameExists, type RunsArea } from '../runs/run-paths';

// WS apply request schema. The dashboard client sends this in over the
// `/ws/dashboard` socket to ask the server to apply a diagnosis patch
// to a real file. Validated at the boundary; malformed inputs are
// dropped silently (no patch:rejected emit) because there's no testId
// to attribute the error to. Well-formed-but-unsafe requests (path
// escapes cwd, no runsArea context) emit a patch:rejected so the UI
// can render the refusal.
const applyRequestSchema = z.object({
  kind: z.literal('patch:apply'),
  testId: z.string(),
  patch: z.object({
    file: z.string(),
    oldStr: z.string(),
    newStr: z.string(),
  }),
});

// WS rerun-request schema (apply-fix loop closure). The dashboard sends
// `{ kind: 'test:rerun-request', testId }` after Apply Fix lands; the
// server validates and emits `test:rerun-requested` onto the bus as the
// acknowledgement. Symmetric to applyRequestSchema. Malformed inputs
// drop silently (no testId to attribute the error to).
//
// Wire-level only — actually spawning a re-targeted Playwright run is
// the consumer's job (a future bus subscriber), not this handler's.
const rerunRequestSchema = z.object({
  kind: z.literal('test:rerun-request'),
  testId: z.string(),
});

export type DashboardServerOptions = {
  port: number;
  bus: EventBus;
  // RunsArea owning <cwd>/.reactlens/runs/, used by the past-runs API routes.
  // When omitted, those routes return 404 (server still serves the live run).
  runsArea?: RunsArea;
};

export type DashboardServer = {
  port: number;
  wsUrl: string;
  probeWsUrl: string;
  close: () => Promise<void>;
};

const EVENT_BUFFER_LIMIT = 500;

function findStaticDir(): string | null {
  // The dashboard SPA now lives in @reynsu/reactlens-dashboard-ui (per ADR
  // 0007's shared-package strategy). Resolve the package's manifest at
  // runtime so we don't have to hardcode a relative path; the bundle lives
  // alongside it at dist/web/.
  try {
    const pkgPath = require.resolve('@reynsu/reactlens-dashboard-ui/package.json');
    const webDir = join(pkgPath, '..', 'dist', 'web');
    readFileSync(join(webDir, 'index.html'));
    return webDir;
  } catch {
    return null;
  }
}

const FALLBACK_HTML = `<!doctype html><html><body><h1>reactlens dashboard</h1>
<p>Frontend bundle not found. Reinstall to pull <code>@reynsu/reactlens-dashboard-ui</code>.</p>
<script>const ws=new WebSocket('ws://'+location.host+'/ws/dashboard');ws.onmessage=(m)=>console.log(JSON.parse(m.data));</script>
</body></html>`;

export async function startDashboardServer(opts: DashboardServerOptions): Promise<DashboardServer> {
  const app = express();
  const staticDir = findStaticDir();
  if (staticDir !== null) {
    app.use(express.static(staticDir));
  } else {
    app.get('/', (_req, res) => res.type('html').send(FALLBACK_HTML));
  }
  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  // Past-runs API. Mounted before the static handler so /api/* never falls
  // through to the SPA. When runsArea is unset the routes 404 — keeps the
  // server usable without persistence wired (e.g. legacy callers).
  if (opts.runsArea !== undefined) {
    const area = opts.runsArea;
    app.get('/api/runs', async (_req, res, next) => {
      try {
        res.json(await area.list());
      } catch (err) {
        next(err);
      }
    });
    app.get('/api/runs/:id/events', async (req, res, next) => {
      try {
        const body = await area.loadEvents(req.params.id);
        res.type('application/x-ndjson').send(body);
      } catch (err) {
        const message = (err as Error).message;
        if (/invalid run id/i.test(message)) {
          res.status(400).type('text').send(message);
          return;
        }
        if (/run not found/i.test(message)) {
          res.status(404).type('text').send(message);
          return;
        }
        next(err);
      }
    });
    app.get('/api/runs/:id/frames/:testId/:filename', async (req, res, next) => {
      try {
        const abs = area.resolveFramePath(req.params.id, req.params.testId, req.params.filename);
        if (!(await frameExists(abs))) {
          res.status(404).type('text').send('frame not found');
          return;
        }
        // dotfiles: 'allow' because our path includes ".reactlens/" — `send`
        // defaults to rejecting any path segment that starts with a dot.
        res.type('image/jpeg').sendFile(abs, { dotfiles: 'allow' });
      } catch (err) {
        if (/invalid /i.test((err as Error).message)) {
          res.status(400).type('text').send((err as Error).message);
          return;
        }
        next(err);
      }
    });
  }

  const server = createServer(app);
  const dashboardWss = new WebSocketServer({ noServer: true });
  const probeWss = new WebSocketServer({ noServer: true });

  // Ring buffer of recent events so dashboards connecting mid-run get history.
  const buffer: RunEvent[] = [];
  function bufferAndBroadcast(event: RunEvent): void {
    buffer.push(event);
    if (buffer.length > EVENT_BUFFER_LIMIT) buffer.shift();
    const payload = JSON.stringify(event);
    for (const client of dashboardWss.clients) {
      if (client.readyState === client.OPEN) {
        try {
          client.send(payload);
        } catch (err) {
          logger.warn({ err }, 'failed to send to dashboard client');
        }
      }
    }
  }

  // Track the active Playwright step per test so we can tag probe-side
  // component:snapshot/event payloads with the real stepId. The probe doesn't
  // know about steps (it sees the React fiber commits, not the test runner),
  // so the fixture sets stepId = testId once at mount time and we overwrite
  // here as step:start events flow through the bus.
  //
  // v0.2 time-travel needs this granularity — without it every snapshot in
  // a test would scrub to the same row. Cleaning up on test:end keeps the
  // map bounded across long runs.
  const activeStep = new Map<string, string>();

  const disposers: Array<() => void> = [];
  for (const t of ALL_EVENT_TYPES) {
    disposers.push(opts.bus.on(t, (e) => bufferAndBroadcast(e as RunEvent)));
  }
  disposers.push(opts.bus.on('step:start', (e) => activeStep.set(e.testId, e.stepId)));
  disposers.push(opts.bus.on('test:end', (e) => activeStep.delete(e.id)));

  dashboardWss.on('connection', (client: WebSocket) => {
    // Replay buffered history so a late-joining dashboard isn't blank.
    for (const e of buffer) {
      try {
        client.send(JSON.stringify(e));
      } catch {
        /* ignore */
      }
    }
    // Slice #11 phase 1 — Apply Fix WS round-trip. Dashboard clients
    // can post `{ kind: 'patch:apply', testId, patch }` to ask the
    // server to apply a diagnosis patch. The server invokes
    // PatchApplier and emits the resulting patch:applied or
    // patch:rejected event onto the bus, which the broadcaster sends
    // back to every connected dashboard (including the one that asked).
    client.on('message', (data) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        // Unparseable JSON — no testId means no patch:rejected; just drop.
        return;
      }
      const applyResult = applyRequestSchema.safeParse(parsed);
      if (applyResult.success) {
        handleApplyRequest(applyResult.data, opts.bus, opts.runsArea);
        return;
      }
      // Apply-fix loop closure: a separate inbound message kind asks
      // the server to re-run a single test by id. Wire-only here; an
      // actual re-run spawn is its own slice. The handler just emits
      // the acknowledgement event onto the bus.
      const rerunResult = rerunRequestSchema.safeParse(parsed);
      if (rerunResult.success) {
        opts.bus.emit({ t: 'test:rerun-requested', testId: rerunResult.data.testId });
        return;
      }
      // Neither schema matched. Could be a future client→server message
      // we don't yet recognise; drop silently. Strict rejection here would
      // break forward compat with newer dashboard-ui versions.
    });
    client.on('error', (err) => logger.warn({ err }, 'dashboard client error'));
  });

  probeWss.on('connection', (client: WebSocket) => {
    client.on('message', (data) => {
      try {
        const event = parseRunEvent(JSON.parse(data.toString()));
        if (event === null) {
          logger.warn({ preview: data.toString().slice(0, 200) }, 'probe message failed schema validation; dropped');
          return;
        }
        // Rewrite stepId on component-* events so it reflects the active
        // Playwright step rather than the testId-shaped default the probe
        // baked in at addInitScript time. See the activeStep comment above
        // for the why.
        if (event.t === 'component:snapshot' || event.t === 'component:event') {
          const active = activeStep.get(event.testId);
          if (active !== undefined) (event as { stepId: string }).stepId = active;
        }
        // Echo onto the bus so other subscribers (frontend, diagnostics) see it.
        opts.bus.emit(event);
      } catch (err) {
        logger.warn({ err }, 'invalid probe message');
      }
    });
    client.on('error', (err) => logger.warn({ err }, 'probe client error'));
  });

  // Express error middleware: a safety net for any future route that throws.
  // Existing routes are trivial sends and can't fail, but registering this
  // means a regression doesn't silently 500 — it lands in our pino stream
  // with the same {err, route} shape as our WS handlers. Must come AFTER
  // all routes are mounted, which is the case here.
  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.warn({ err, method: req.method, path: req.path }, 'dashboard route error');
    if (!res.headersSent) res.status(500).type('text').send('internal error');
  });

  server.on('upgrade', (req, socket, head) => {
    try {
      const url = req.url ?? '';
      if (url.startsWith('/ws/dashboard')) {
        dashboardWss.handleUpgrade(req, socket, head, (ws) => dashboardWss.emit('connection', ws, req));
      } else if (url.startsWith('/ws/probe')) {
        probeWss.handleUpgrade(req, socket, head, (ws) => probeWss.emit('connection', ws, req));
      } else {
        socket.destroy();
      }
    } catch (err) {
      // handleUpgrade can throw on malformed requests. Log and drop the socket
      // rather than letting the exception bubble into the http server.
      logger.warn({ err, url: req.url }, 'ws upgrade failed');
      try {
        socket.destroy();
      } catch {
        /* already dead */
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  // When opts.port is 0, the OS assigns an ephemeral port. Read it back from
  // server.address() rather than echoing opts.port — otherwise tests using
  // port 0 (e.g. the dashboard-routes suite) get a reported port of 0 and
  // their fetch() calls fail with EADDRNOTAVAIL.
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : opts.port;
  const close = async (): Promise<void> => {
    for (const d of disposers) d();
    for (const c of dashboardWss.clients) c.close();
    for (const c of probeWss.clients) c.close();
    await new Promise<void>((resolve) => dashboardWss.close(() => resolve()));
    await new Promise<void>((resolve) => probeWss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  return {
    port,
    wsUrl: `ws://localhost:${port}/ws/dashboard`,
    probeWsUrl: `ws://localhost:${port}/ws/probe`,
    close,
  };
}

// Apply-request handler. Resolves the patch's file path under cwd (path-
// traversal defence), invokes PatchApplier, and emits the resulting
// patch:applied or patch:rejected event onto the bus. The broadcaster
// loop above subscribes to ALL_EVENT_TYPES so the events flow back to
// every dashboard client + get persisted to events.jsonl via the run
// command's persistor subscription.
//
// Refuses two boundary cases:
//   - runsArea undefined: dashboard was started in legacy mode without
//     a project root, so we have no cwd to resolve patch.file against.
//     Emit a clear patch:rejected so the UI explains the refusal.
//   - resolved path escapes cwd: patch.file = '../etc/passwd' or an
//     absolute path. Same defence the diff route applies elsewhere in
//     this file via assertSafeId/resolveFramePath.
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
  const result = applyPatch({
    file: absPath,
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

async function shutdownOn(server: DashboardServer, signals: NodeJS.Signals[]): Promise<void> {
  for (const sig of signals) {
    process.once(sig, () => {
      void server.close().then(() => process.exit(0));
    });
  }
}

export { shutdownOn };
