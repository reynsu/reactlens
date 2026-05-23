// RunsRestApi — Express routes for the past-runs API and /healthz.
//
// Extracted from `src/dashboard/server.ts` as part of the dashboard
// protocol-separation refactor (architecture review candidate #1).
//
// Owns nothing stateful — pure routes that delegate to RunsArea for
// list / loadEvents / resolveFramePath and to frameExists for the
// 404-on-missing-file behavior. The composer (server.ts) mounts it
// onto the express app.
//
// When runsArea is undefined, the past-runs routes are NOT mounted —
// /healthz still works. This matches the pre-refactor behavior: a
// dashboard started in "legacy live-only" mode without a project root
// (no .reactlens/) returns 404 from past-runs without trying to read.
import type { Express } from 'express';
import { frameExists, type RunsArea } from '../runs/run-paths';

export type MountRunsRestApiOpts = {
  app: Express;
  // When omitted, the past-runs routes are NOT mounted (legacy mode).
  // /healthz still gets mounted regardless.
  runsArea?: RunsArea;
};

export function mountRunsRestApi(opts: MountRunsRestApiOpts): void {
  const { app, runsArea } = opts;

  // Always available. Smoke check for the dashboard server itself,
  // separate from any persisted-runs concern.
  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  if (runsArea === undefined) return;

  // Past-runs list. The dashboard's RunPicker fetches this on mount.
  app.get('/api/runs', async (_req, res, next) => {
    try {
      res.json(await runsArea.list());
    } catch (err) {
      next(err);
    }
  });

  // NDJSON stream for a single run. The dashboard's replay reducer
  // hydrates from this.
  app.get('/api/runs/:id/events', async (req, res, next) => {
    try {
      const body = await runsArea.loadEvents(req.params.id);
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

  // Per-step JPEG frame from a persisted run. resolveFramePath does
  // both the safe-id validation and the path-traversal defence in
  // run-paths.ts; this route just maps thrown errors to HTTP codes.
  app.get('/api/runs/:id/frames/:testId/:filename', async (req, res, next) => {
    try {
      const abs = runsArea.resolveFramePath(
        req.params.id,
        req.params.testId,
        req.params.filename,
      );
      if (!(await frameExists(abs))) {
        res.status(404).type('text').send('frame not found');
        return;
      }
      // dotfiles: 'allow' because our path includes ".reactlens/" —
      // `send` defaults to rejecting any path segment that starts
      // with a dot.
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
