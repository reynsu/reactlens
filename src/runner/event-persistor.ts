// Subscribes to the EventBus and writes every RunEvent to disk under the
// RunPath given at construction. Drives v0.2 time-travel: past runs can be
// replayed from this directory without re-running Playwright.
//
// Persistence shape (P8 task 2; owned by RunPath):
//   <runPath.dir>/events.jsonl                 — NDJSON, one RunEvent per line
//   <runPath.dir>/frames/<testId>/<stepId>.jpg — binary JPEG, last write wins
//
// The `frame` event carries a ~50KB base64 JPEG per tick. Writing that into
// NDJSON would balloon the log and turn `grep` into a memory hazard, so we
// split: binary goes to disk, the log line keeps a `frameRef` pointer.
//
// `frame` events have no `stepId` (CLAUDE.md §9), so the persistor uses
// the shared ActiveSteps tracker (clearOn: 'step:end') to remember the
// latest step:start per testId and key frames against it. Pre-first-step
// frames fall back to a testId-keyed sentinel.
//
// Path-shape rules (sanitization, frame layout, eventsPath name) live in
// src/runs/run-paths.ts on the RunPath value object — the persistor never
// joins paths by hand.
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { logger } from '../utils/logger';
import type { RunPath } from '../runs/run-paths';
import { sanitizeSegment } from '../runs/run-paths';
import { createActiveSteps, type ActiveSteps } from './active-steps';
import type { EventSink } from './event-bus';
import { type RunEvent } from './events';

export type PersistorOptions = {
  runPath: RunPath;
};

export class EventPersistor implements EventSink {
  private readonly runPath: RunPath;
  private readonly steps: ActiveSteps = createActiveSteps({ clearOn: 'step:end' });
  private writeQueue: Promise<void> = Promise.resolve();
  private mkdirP: Promise<void> | null = null;

  constructor(opts: PersistorOptions) {
    this.runPath = opts.runPath;
  }

  // EventSink — the bus calls this once per RunEvent. Callers subscribe
  // via `bus.addSink(persistor)` and keep the returned unsubscribe to
  // release the subscription during teardown. Replaces the prior
  // attach(bus)/detach() pair so the bus owns lifecycle, not the sink.
  accept(event: RunEvent): void {
    this.handle(event);
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }

  private ensureRunDir(): Promise<void> {
    if (this.mkdirP === null) {
      // mkdir returns Promise<string | undefined> (the path of the first
      // dir created, or undefined if it already existed). Discard so the
      // memoized promise matches its declared Promise<void> shape.
      this.mkdirP = mkdir(this.runPath.dir, { recursive: true }).then(() => {});
    }
    return this.mkdirP;
  }

  private handle(event: RunEvent): void {
    this.steps.observe(event);

    if (event.t === 'frame') {
      // The persistor only handles WIRE-shape frames (those carrying base64
      // `data`). DISK-shape frames (carrying `frameRef`) are what we WRITE,
      // not what we re-ingest — if one ever lands on the bus it means the
      // wire/disk boundary leaked, and there's nothing useful to persist.
      if (event.data === undefined) return;
      const stepId = this.steps.get(event.testId) ?? event.testId;
      const safeTestId = sanitizeSegment(event.testId);
      const safeStepId = sanitizeSegment(stepId);
      const frameRef = `frames/${safeTestId}/${safeStepId}.jpg`;
      this.enqueueFrame(event.testId, stepId, event.data);
      this.enqueueLine({
        t: 'frame',
        testId: event.testId,
        stepId,
        sessionId: event.sessionId,
        frameRef,
      });
      return;
    }

    this.enqueueLine(event);
  }

  private enqueueLine(line: unknown): void {
    this.writeQueue = this.writeQueue.then(async () => {
      await this.ensureRunDir();
      try {
        await appendFile(this.runPath.eventsPath, JSON.stringify(line) + '\n');
      } catch (err) {
        logger.error({ err, eventsPath: this.runPath.eventsPath }, 'failed to append to events.jsonl');
      }
    });
  }

  private enqueueFrame(testId: string, stepId: string, base64Jpeg: string): void {
    this.writeQueue = this.writeQueue.then(async () => {
      await this.ensureRunDir();
      const target = this.runPath.framePath(testId, stepId);
      try {
        await mkdir(dirname(target), { recursive: true });
        const buf = Buffer.from(base64Jpeg, 'base64');
        await writeFile(target, buf);
      } catch (err) {
        logger.error({ err, testId, stepId }, 'failed to persist frame');
      }
    });
  }
}
