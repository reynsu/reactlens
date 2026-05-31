// On-disk layout of `.reactlens/` and the helpers that touch it. Two value
// objects:
//
//   RunsArea — per-cwd. Knows where `.reactlens/` and `.reactlens/runs/`
//     live, ensures the self-defensive .gitignore exists once at open time,
//     and owns read-side ops (list / loadEvents / resolveFramePath) and the
//     factory for new RunPath instances.
//
//   RunPath  — per-run. Holds id + dir + eventsPath + framesDir computed up
//     front. Knows how to compute a frame's path with sanitized testId /
//     stepId. Constructed via RunsArea.startRun() so the id-shape invariant
//     is enforced before any caller can touch the paths.
//
// Co-locates the two halves of the seam — sanitizeSegment (lossy, for
// write-side identifiers from Playwright) and assertSafeId (lossless, for
// read-side identifiers from HTTP / user input). Same module = obvious
// contract: anyone joining a path goes through one of these.
import { createHash } from 'node:crypto';
import { access, readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { tryIngestRunEvent } from '../runner/event-ingestion';
import { ensureGitignore } from '../utils/paths';
import { generateRunId } from '../utils/run-id';

// === ID validation: lossless, for read-side ===
//
// Run identifiers come from generateRunId() (only ISO chars, digits, hex,
// dash). The same regex applies to testIds (Playwright assigns from a hash)
// and to filenames the persistor wrote via sanitizeSegment.
const ID_PATTERN = /^[A-Za-z0-9_.-]+$/;

export function assertSafeId(kind: string, value: string): void {
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

// === Filename sanitization: lossy, for write-side ===
//
// Sanitize step/test identifiers for use as filesystem names. Playwright
// synthesizes stepIds with the step's start timestamp + title — strings that
// often contain ":", `"`, "?", "*", and other chars Windows rejects.
//
// Two passes (preserved verbatim from the original toSafeSegment):
//   1. visible Windows-forbidden chars + all C0 controls (0x00-0x1f, which
//      includes tab/newline/CR — each replaced 1:1 with '_')
//   2. \s+ collapses runs of remaining whitespace (i.e. spaces, U+0020)
//      into a single '_'
// Notes: dashes and spaces survive the first pass intentionally, so legible
// identifiers like 'test-1' and 'step-a' remain readable. When the result
// exceeds 80 chars (Windows MAX_PATH headroom), keep a 64-char prefix and
// append an 8-char content hash for uniqueness.
const FORBIDDEN_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;

export function sanitizeSegment(raw: string): string {
  const replaced = raw.replace(FORBIDDEN_FILENAME_CHARS, '_').replace(/\s+/g, '_');
  if (replaced.length <= 80) return replaced;
  const digest = createHash('sha1').update(raw).digest('hex').slice(0, 8);
  return `${replaced.slice(0, 64)}-${digest}`;
}

// === Run summary (read-side, surfaced by RunsArea.list) ===

export type RunSummary = {
  runId: string;
  startedAt?: number;
  totalTests?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
  duration?: number;
};

// === RunPath: per-run value object ===
//
// Constructed by RunsArea.startRun(). Tests that need one in isolation can
// also construct directly with a synthetic id — the constructor enforces the
// id-shape invariant either way.
export class RunPath {
  readonly id: string;
  readonly dir: string;
  readonly eventsPath: string;
  readonly framesDir: string;

  constructor(args: { id: string; dir: string }) {
    assertSafeId('run id', args.id);
    this.id = args.id;
    this.dir = args.dir;
    this.eventsPath = join(args.dir, 'events.jsonl');
    this.framesDir = join(args.dir, 'frames');
  }

  // #77: absolute path for one frame in the per-test monotonic sequence.
  // Every received screencast frame is preserved here (keyed by `seq`),
  // replacing the pre-#77 one-overwritten-still-per-step scheme. testId is
  // sanitized; seq is an integer and never needs sanitizing. The path-shape
  // rule belongs to this value object — the persistor never joins by hand.
  frameSeqPath(testId: string, seq: number): string {
    return join(this.framesDir, sanitizeSegment(testId), `${seq}.jpg`);
  }

  // #77: the POSIX-style relative ref stored in the JSONL index line for a
  // sequenced frame. Always uses `/` (it is a URL-ish ref the dashboard
  // server route + frontend consume), and stays in lock-step with
  // frameSeqPath above so the on-disk file and the ref never diverge.
  frameSeqRef(testId: string, seq: number): string {
    return `frames/${sanitizeSegment(testId)}/${seq}.jpg`;
  }
}

// === RunsArea: per-cwd surface ===

export class RunsArea {
  readonly cwd: string;
  readonly reactlensDir: string;
  readonly runsDir: string;

  // Sync constructor — no I/O. Use openRunsArea() to also write
  // `.reactlens/.gitignore` (idempotent).
  constructor(cwd: string) {
    this.cwd = cwd;
    this.reactlensDir = join(cwd, '.reactlens');
    this.runsDir = join(this.reactlensDir, 'runs');
  }

  // Generates a fresh runId and returns a RunPath. No I/O — mkdir is lazy
  // (EventPersistor.ensureRunDir handles it on first append).
  startRun(): RunPath {
    const id = generateRunId();
    return new RunPath({ id, dir: join(this.runsDir, id) });
  }

  // Read-side: enumerate persisted runs, newest first. Skips dirs without
  // an events.jsonl (a partially-created run that crashed before the first
  // append). Returns empty when runsDir does not yet exist.
  async list(): Promise<RunSummary[]> {
    let entries: string[];
    try {
      entries = await readdir(this.runsDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }

    const summaries: RunSummary[] = [];
    for (const id of entries) {
      if (!ID_PATTERN.test(id)) continue;
      const eventsPath = join(this.runsDir, id, 'events.jsonl');
      try {
        await access(eventsPath);
      } catch {
        continue;
      }
      summaries.push(await summarizeRun(id, eventsPath));
    }
    return summaries.sort((a, b) => (a.runId < b.runId ? 1 : -1));
  }

  // Read-side: return the raw NDJSON for a single run.
  async loadEvents(runId: string): Promise<string> {
    assertSafeId('run id', runId);
    const eventsPath = join(this.runsDir, runId, 'events.jsonl');
    try {
      return await readFile(eventsPath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`run not found: ${runId}`);
      }
      throw err;
    }
  }

  // Read-side: resolve a frame's absolute path with belt-and-suspenders
  // path-traversal defence. Caller (the express route) maps thrown errors
  // to 400 / 404 as appropriate.
  resolveFramePath(runId: string, testId: string, filename: string): string {
    assertSafeId('run id', runId);
    assertSafeId('test id', testId);
    assertSafeId('frame filename', filename);
    const candidate = resolve(this.runsDir, runId, 'frames', testId, filename);
    const base = resolve(this.runsDir);
    if (!candidate.startsWith(base + sep)) {
      throw new Error(`resolved path escapes runsDir: ${candidate}`);
    }
    return candidate;
  }
}

// Entry point. Constructs the area and writes `.reactlens/.gitignore` if it
// does not already exist (idempotent — safe across watch iterations even
// though only the first call does the write).
export async function openRunsArea(cwd: string): Promise<RunsArea> {
  const area = new RunsArea(cwd);
  await ensureGitignore(area.reactlensDir);
  return area;
}

// Independent of RunsArea — checks any absolute path. Used by the dashboard's
// static frame route to convert "missing file" into a 404 without raising.
export async function frameExists(absPath: string): Promise<boolean> {
  try {
    const s = await stat(absPath);
    return s.isFile();
  } catch {
    return false;
  }
}

// === Internals ===

async function summarizeRun(runId: string, eventsPath: string): Promise<RunSummary> {
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
  // First/last-line spot-checks. tryIngestRunEvent returns null on
  // either JSON.parse failure OR schema mismatch — both branches mean
  // "skip the metadata extraction, leave the field unset" for this
  // partial-corruption-tolerant code path (the runs picker must not
  // blow up when one persisted run has a malformed events.jsonl).
  const first = tryIngestRunEvent(lines[0]!);
  if (first?.t === 'run:start') {
    summary.totalTests = first.totalTests;
    summary.startedAt = first.timestamp;
  }
  const last = tryIngestRunEvent(lines[lines.length - 1]!);
  if (last?.t === 'run:end') {
    summary.passed = last.passed;
    summary.failed = last.failed;
    summary.skipped = last.skipped;
    summary.duration = last.duration;
  }
  return summary;
}
