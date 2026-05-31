// #77: the per-test frame track. A run's screencast is no longer collapsed to
// one overwritten still per step — every received frame is preserved as a
// monotonic per-test sequence (frames/<testId>/<seq>.jpg) plus a per-frame
// JSONL index line. This module owns three things: the sequence numbering,
// the index-line shape, and (delegated to RunPath, the layout owner) the
// on-disk path. The EventPersistor does the actual I/O around it.
//
// This is the recording substrate the dashboard later turns back into video
// (#78 builder + reducer, #79 VideoTransport). Kept deliberately deep and
// pure (only the in-memory seq counters mutate) so it can be unit-tested in
// isolation without touching the filesystem.
import type { RunPath } from '../runs/run-paths';

// One persisted per-frame index line. Same `t: 'frame'` DISK shape the
// persistor has always written, but `frameRef` now points at a per-frame
// sequence file instead of one overwritten still per step, and the line
// always carries the step it belongs to + (when known) the capture time.
export type FrameIndexLine = {
  t: 'frame';
  testId: string;
  stepId: string;
  sessionId: string;
  frameRef: string;
  timestamp?: number;
};

// What allocate() hands back to the persistor: the absolute path the JPEG
// bytes go to, the index line to append, and the seq (exposed for tests /
// retention bookkeeping).
export type AllocatedFrame = {
  seq: number;
  diskPath: string;
  line: FrameIndexLine;
};

export class FrameTrack {
  private readonly seqByTest = new Map<string, number>();

  constructor(private readonly runPath: RunPath) {}

  // Allocate the next monotonic seq for a test, returning the disk path to
  // write and the index line to persist. Mutates only the in-memory counter.
  allocate(args: {
    testId: string;
    stepId: string;
    sessionId: string;
    timestamp?: number;
  }): AllocatedFrame {
    const seq = this.seqByTest.get(args.testId) ?? 0;
    this.seqByTest.set(args.testId, seq + 1);

    const line: FrameIndexLine = {
      t: 'frame',
      testId: args.testId,
      stepId: args.stepId,
      sessionId: args.sessionId,
      frameRef: this.runPath.frameSeqRef(args.testId, seq),
      ...(args.timestamp !== undefined ? { timestamp: args.timestamp } : {}),
    };

    return { seq, diskPath: this.runPath.frameSeqPath(args.testId, seq), line };
  }
}
