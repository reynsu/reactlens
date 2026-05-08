import express from 'express';
import { createServer, type Server as HttpServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { logger } from '../utils/logger';
import { EventBus } from '../runner/event-bus';
import type { RunEvent } from '../runner/events';

export type DashboardServerOptions = {
  port: number;
  bus: EventBus;
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

  // Subscribe the bus → dashboard clients. Returns a disposer for shutdown.
  const disposers: Array<() => void> = [];
  const eventTypes: Array<RunEvent['t']> = [
    'run:start',
    'run:end',
    'test:start',
    'test:end',
    'step:start',
    'step:end',
    'frame',
    'component:snapshot',
    'component:event',
    'diagnosis:start',
    'diagnosis:chunk',
    'diagnosis:end',
  ];
  for (const t of eventTypes) {
    disposers.push(opts.bus.on(t, (e) => bufferAndBroadcast(e as RunEvent)));
  }

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
        // Echo onto the bus so other subscribers (frontend, diagnostics) see it.
        opts.bus.emit(event);
      } catch (err) {
        logger.warn({ err }, 'invalid probe message');
      }
    });
    client.on('error', (err) => logger.warn({ err }, 'probe client error'));
  });

  server.on('upgrade', (req, socket, head) => {
    const url = req.url ?? '';
    if (url.startsWith('/ws/dashboard')) {
      dashboardWss.handleUpgrade(req, socket, head, (ws) => dashboardWss.emit('connection', ws, req));
    } else if (url.startsWith('/ws/probe')) {
      probeWss.handleUpgrade(req, socket, head, (ws) => probeWss.emit('connection', ws, req));
    } else {
      socket.destroy();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const port = opts.port;
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
