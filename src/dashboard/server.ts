import express from 'express';
import { createServer, type Server as HttpServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { logger } from '../utils/logger';
import { EventBus } from '../runner/event-bus';
import { ALL_EVENT_TYPES, type RunEvent } from '../runner/events';
import { frameExists, type RunsArea } from '../runs/run-paths';

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
  // Resolve the bundled dashboard frontend. We publish dist/web from this
  // package; in dev `pnpm build:web` produces it. If missing, the server
  // serves a tiny inline HTML so users still see something.
  const candidates = [
    join(__dirname, '..', 'web'),
    join(__dirname, '..', '..', 'dist', 'web'),
  ];
  for (const c of candidates) {
    try {
      readFileSync(join(c, 'index.html'));
      return c;
    } catch {
      /* try next */
    }
  }
  return null;
}

const FALLBACK_HTML = `<!doctype html><html><body><h1>reactlens dashboard</h1>
<p>Frontend bundle not found. Run <code>pnpm build:web</code> in the reactlens repo.</p>
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
    client.on('error', (err) => logger.warn({ err }, 'dashboard client error'));
  });

  probeWss.on('connection', (client: WebSocket) => {
    client.on('message', (data) => {
      try {
        const event = JSON.parse(data.toString()) as RunEvent;
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

async function shutdownOn(server: DashboardServer, signals: NodeJS.Signals[]): Promise<void> {
  for (const sig of signals) {
    process.once(sig, () => {
      void server.close().then(() => process.exit(0));
    });
  }
}

export { shutdownOn };
