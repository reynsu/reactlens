// #77: the FrameTrack owns the per-test monotonic frame sequence — the
// numbering, the on-disk path (delegated to RunPath, the layout owner), and
// the DISK-shape index line the persistor appends. Unit-tested here in
// isolation; the persistor's job is purely the I/O around it.
import { describe, expect, it } from 'vitest';
import { FrameTrack } from '../../src/runner/frame-track';
import { RunPath } from '../../src/runs/run-paths';

function track(): FrameTrack {
  return new FrameTrack(new RunPath({ id: 'r1', dir: '/tmp/run' }));
}

describe('FrameTrack — per-test monotonic frame sequence (#77)', () => {
  it('numbers frames per test starting at 0 and increments monotonically across steps', () => {
    const ft = track();
    const a = ft.allocate({ testId: 't1', stepId: 's1', sessionId: 'sess' });
    const b = ft.allocate({ testId: 't1', stepId: 's1', sessionId: 'sess' });
    const c = ft.allocate({ testId: 't1', stepId: 's2', sessionId: 'sess' });
    expect([a.seq, b.seq, c.seq]).toEqual([0, 1, 2]);
  });

  it('keeps independent counters per test', () => {
    const ft = track();
    expect(ft.allocate({ testId: 't1', stepId: 's', sessionId: 'x' }).seq).toBe(0);
    expect(ft.allocate({ testId: 't2', stepId: 's', sessionId: 'x' }).seq).toBe(0);
    expect(ft.allocate({ testId: 't1', stepId: 's', sessionId: 'x' }).seq).toBe(1);
  });

  it('builds a DISK-shape index line pointing at the per-frame seq file', () => {
    const ft = track();
    const { line, diskPath } = ft.allocate({
      testId: 't1',
      stepId: 's1',
      sessionId: 'sess-1',
      timestamp: 1700000000123,
    });
    expect(line).toEqual({
      t: 'frame',
      testId: 't1',
      stepId: 's1',
      sessionId: 'sess-1',
      frameRef: 'frames/t1/0.jpg',
      timestamp: 1700000000123,
    });
    expect(diskPath).toBe('/tmp/run/frames/t1/0.jpg');
  });

  it('omits timestamp from the index line when not provided', () => {
    const ft = track();
    const { line } = ft.allocate({ testId: 't1', stepId: 's1', sessionId: 'sess' });
    expect(line).not.toHaveProperty('timestamp');
    expect(line.frameRef).toBe('frames/t1/0.jpg');
  });

  it('sanitizes a filesystem-hostile testId in the path/ref but preserves stepId verbatim in the line', () => {
    const ft = track();
    const { line, diskPath } = ft.allocate({ testId: 'test:1', stepId: 'hostile "step"', sessionId: 'x' });
    expect(line.frameRef).toBe('frames/test_1/0.jpg');
    expect(diskPath).toBe('/tmp/run/frames/test_1/0.jpg');
    // The seq filename is always safe; only the testId segment needs sanitizing.
    expect(line.stepId).toBe('hostile "step"');
  });
});
