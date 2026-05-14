// Read-only index over the on-disk run history (.reactlens/runs/<runId>/...).
// Pure helpers — the dashboard server mounts these behind HTTP routes. Keeping
// them pure (no Express types) lets the unit suite verify path-traversal
// defences without spinning up a real server.
import { access, readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';

export type RunSummary = {
  runId: string;
  startedAt?: number;
  totalTests?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
  duration?: number;
};

// Run identifiers are produced by generateRunId() — only ISO chars, digits,
// hex, and dash. Same regex applies to testId (Playwright assigns it from
// its hash) and to filenames (the persistor sanitizes via toSafeSegment).
const ID_PATTERN = /^[A-Za-z0-9_.-]+$/;

function assertSafeId(kind: string, value: string): void {
  if (
    !ID_PATTERN.test(value) ||
    value === '.' ||
    value === '..' ||
    isAbsolute(value) ||
    value.includes('/') ||
    value.includes('\\')
  ) {
    throw new Error(`invalid ${kind}: ${value}`);
  }
}

export async function listRuns(runsDir: string): Promise<RunSummary[]> {
  let entries: string[];
  try {
    entries = await readdir(runsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const summaries: RunSummary[] = [];
  for (const id of entries) {
    if (!ID_PATTERN.test(id)) continue;
    const eventsPath = join(runsDir, id, 'events.jsonl');
    try {
      await access(eventsPath);
    } catch {
      continue;
    }
    summaries.push(await summarize(id, eventsPath));
  }
  return summaries.sort((a, b) => (a.runId < b.runId ? 1 : -1));
}

async function summarize(runId: string, eventsPath: string): Promise<RunSummary> {
  // Whole-file read is fine at this scale: a typical run is well under 10 MB
  // and the metadata sits on the first + last non-empty lines. Streaming
  // optimization is a later concern.
  let raw: string;
  try {
    raw = await readFile(eventsPath, 'utf8');
  } catch {
    return { runId };
  }
  const lines = raw.split('\n').filter((l) => l.length > 0);
  if (lines.length === 0) return { runId };

  const summary: RunSummary = { runId };
  try {
    const first = JSON.parse(lines[0]!) as Record<string, unknown>;
    if (first['t'] === 'run:start') {
      if (typeof first['totalTests'] === 'number') summary.totalTests = first['totalTests'];
      if (typeof first['timestamp'] === 'number') summary.startedAt = first['timestamp'];
    }
  } catch {
    /* malformed first line — skip metadata */
  }
  try {
    const last = JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>;
    if (last['t'] === 'run:end') {
      if (typeof last['passed'] === 'number') summary.passed = last['passed'];
      if (typeof last['failed'] === 'number') summary.failed = last['failed'];
      if (typeof last['skipped'] === 'number') summary.skipped = last['skipped'];
      if (typeof last['duration'] === 'number') summary.duration = last['duration'];
    }
  } catch {
    /* malformed last line — leave end stats unset */
  }
  return summary;
}

export async function loadRunEvents(runsDir: string, runId: string): Promise<string> {
  assertSafeId('run id', runId);
  const eventsPath = join(runsDir, runId, 'events.jsonl');
  try {
    return await readFile(eventsPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`run not found: ${runId}`);
    }
    throw err;
  }
}

// Used by the static frame handler. Returns the absolute path or throws.
// Caller (the express route) maps thrown errors to 400/404 as appropriate.
export function resolveFramePath(
  runsDir: string,
  runId: string,
  testId: string,
  filename: string,
): string {
  assertSafeId('run id', runId);
  assertSafeId('test id', testId);
  assertSafeId('frame filename', filename);
  // Final defence: resolve and verify the result still lives under runsDir.
  // Belt-and-suspenders against any future ID_PATTERN regression.
  const candidate = resolve(runsDir, runId, 'frames', testId, filename);
  const base = resolve(runsDir);
  if (!candidate.startsWith(base + sep)) {
    throw new Error(`resolved path escapes runsDir: ${candidate}`);
  }
  return candidate;
}

export async function frameExists(absPath: string): Promise<boolean> {
  try {
    const s = await stat(absPath);
    return s.isFile();
  } catch {
    return false;
  }
}
