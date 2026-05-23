// Dashboard server composer.
//
// Three concrete modules do the actual work:
//   - RunsRestApi   — Express routes for /healthz + past-runs API
//   - DashboardHub  — dashboard-client WS: buffer + broadcast +
//                     patch:apply + test:rerun-request handler
//   - ProbeIngestor — probe WS: receives RunEvents, rewrites stepId
//                     using its own activeStep map, emits to bus
//
// This file's job: wire them together. Create an Express app + HTTP
// server, mount the REST routes, construct Hub + Ingestor, route WS
// upgrades to the right WSS by path, and aggregate close().
//
// The split landed via the dashboard protocol-separation refactor
// (architecture review candidate #1). Pre-refactor this file was
// 432 lines mixing three protocols + shared state. Post-refactor it's
// pure composition — adding a fourth ingestion source (CI artifact
// streaming, replay-from-disk WS) means adding a fourth module and a
// fourth upgrade-router branch, not editing this file's middle.
import express from 'express';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../utils/logger';
import { EventBus } from '../runner/event-bus';
import { type RunsArea } from '../runs/run-paths';
import { DashboardHub } from './dashboard-hub';
import { ProbeIngestor } from './probe-ingestor';
import { mountRunsRestApi } from './runs-rest-api';

export type DashboardServerOptions = {
  port: number;
  bus: EventBus;
  // RunsArea owning <cwd>/.reactlens/runs/, used by the past-runs API
  // routes AND by patch:apply path-resolution. When omitted, those
  // routes return 404 (server still serves the live run) and
  // patch:apply requests get rejected with a clear 'fs-error' explaining
  // why.
  runsArea?: RunsArea;
};

export type DashboardServer = {
  port: number;
  wsUrl: string;
  probeWsUrl: string;
  close: () => Promise<void>;
};

function findStaticDir(): string | null {
  // The dashboard SPA lives in @reynsu/reactlens-dashboard-ui (per
  // ADR-0007's shared-package strategy). Resolve the package's
  // manifest at runtime so we don't hardcode a relative path; the
  // bundle sits alongside it at dist/web/.
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

  // Static SPA + fallback. Mounted before any /api routes via the
  // mount-order convention; mountRunsRestApi adds /api/* below.
  const staticDir = findStaticDir();
  if (staticDir !== null) {
    app.use(express.static(staticDir));
  } else {
    app.get('/', (_req, res) => res.type('html').send(FALLBACK_HTML));
  }

  // Past-runs API + /healthz. The mount function decides which routes
  // to register based on whether runsArea is provided.
  mountRunsRestApi({
    app,
    ...(opts.runsArea !== undefined ? { runsArea: opts.runsArea } : {}),
  });

  // Express error middleware: safety net for any route that throws.
  // Must come AFTER all routes; mountRunsRestApi above is the last
  // route registration so this is the right place.
  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.warn({ err, method: req.method, path: req.path }, 'dashboard route error');
    if (!res.headersSent) res.status(500).type('text').send('internal error');
  });

  // HTTP + WS modules.
  const server = createServer(app);
  const hub = new DashboardHub({
    bus: opts.bus,
    ...(opts.runsArea !== undefined ? { runsArea: opts.runsArea } : {}),
  });
  const probe = new ProbeIngestor({ bus: opts.bus });

  // Upgrade router — routes WS connections to the right WSS by path.
  // handleUpgrade can throw on malformed requests; log and drop the
  // socket rather than letting the exception bubble.
  server.on('upgrade', (req, socket, head) => {
    try {
      const url = req.url ?? '';
      if (url.startsWith('/ws/dashboard')) {
        hub.wss.handleUpgrade(req, socket, head, (ws) => hub.wss.emit('connection', ws, req));
      } else if (url.startsWith('/ws/probe')) {
        probe.wss.handleUpgrade(req, socket, head, (ws) => probe.wss.emit('connection', ws, req));
      } else {
        socket.destroy();
      }
    } catch (err) {
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

  // When opts.port is 0, the OS assigns an ephemeral port. Read it
  // back from server.address() rather than echoing opts.port —
  // otherwise tests using port 0 (e.g. the dashboard-routes suite)
  // get a reported port of 0 and their fetch() calls fail with
  // EADDRNOTAVAIL.
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : opts.port;

  const close = async (): Promise<void> => {
    await hub.close();
    await probe.close();
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
