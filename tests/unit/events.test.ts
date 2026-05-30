// Covers parseRunEvent end-to-end: every variant of the discriminated union
// has a happy-path + rejection coverage, plus the loose-extra-fields contract,
// plus the recursive ComponentNode / AxNode shapes, plus the wire-vs-disk
// frame shape duality. The single boundary parser is the seam every untyped
// ingestion point goes through, so its matrix has to be tight.
import { describe, expect, it } from 'vitest';
import { parseRunEvent, type RunEvent } from '../../src/runner/events';

describe('parseRunEvent — happy path per variant', () => {
  it('parses run:start', () => {
    const out = parseRunEvent({ t: 'run:start', runId: 'r1', totalTests: 3, timestamp: 1700000000000 });
    expect(out).toEqual({ t: 'run:start', runId: 'r1', totalTests: 3, timestamp: 1700000000000 });
  });

  it('parses run:start with the suite roster (v0.3)', () => {
    const tests = [
      { id: 't1', title: 'cart shows the correct subtotal', file: '/app/e2e/cart.spec.ts', suite: 'cart.spec.ts' },
      { id: 't2', title: 'CartPage shows idle', file: '/app/e2e/cart.spec.ts', suite: 'CartPage' },
    ];
    const out = parseRunEvent({ t: 'run:start', runId: 'r1', totalTests: 2, timestamp: 0, tests });
    expect(out).toEqual({ t: 'run:start', runId: 'r1', totalTests: 2, timestamp: 0, tests });
  });

  it('parses run:end', () => {
    const out = parseRunEvent({ t: 'run:end', passed: 2, failed: 1, skipped: 0, duration: 1234 });
    expect(out).toMatchObject({ t: 'run:end', passed: 2, failed: 1, skipped: 0, duration: 1234 });
  });

  it('parses test:start', () => {
    const out = parseRunEvent({ t: 'test:start', id: 't1', title: 'a', file: 'a.spec.ts', suite: 's' });
    expect(out?.t).toBe('test:start');
  });

  it('parses test:end with optional error and attachments', () => {
    const out = parseRunEvent({
      t: 'test:end',
      id: 't1',
      status: 'failed',
      duration: 200,
      error: 'expected x to be y',
      attachments: [{ name: 'screenshot', path: '/tmp/s.png', contentType: 'image/png' }],
    });
    expect(out?.t).toBe('test:end');
    if (out?.t === 'test:end') {
      expect(out.status).toBe('failed');
      expect(out.attachments?.[0]?.contentType).toBe('image/png');
    }
  });

  it('parses test:end without optional fields', () => {
    const out = parseRunEvent({ t: 'test:end', id: 't1', status: 'passed', duration: 50 });
    expect(out).toMatchObject({ t: 'test:end', status: 'passed' });
  });

  it('parses step:start and step:end', () => {
    expect(parseRunEvent({ t: 'step:start', testId: 't1', stepId: 's1', title: 'click' }))
      .toMatchObject({ t: 'step:start' });
    expect(parseRunEvent({ t: 'step:end', testId: 't1', stepId: 's1', status: 'passed' }))
      .toMatchObject({ t: 'step:end', status: 'passed' });
  });

  it('parses WIRE frame (data only)', () => {
    const out = parseRunEvent({ t: 'frame', testId: 't1', sessionId: 'sess-1', data: 'BASE64==' });
    expect(out?.t).toBe('frame');
    if (out?.t === 'frame') {
      expect(out.data).toBe('BASE64==');
      expect(out.frameRef).toBeUndefined();
    }
  });

  it('preserves an optional source discriminator on a frame event', () => {
    // P6: lets the dashboard pick a renderer (BrowserPreview vs DevicePreview)
    // per frame. Absent on legacy / web-only frames; nativelens sets it.
    const out = parseRunEvent({
      t: 'frame',
      testId: 't1',
      sessionId: 'sess-1',
      data: 'BASE64==',
      source: 'native',
    });
    expect(out?.t).toBe('frame');
    if (out?.t === 'frame') {
      expect(out.source).toBe('native');
    }
  });

  it('parses DISK frame (frameRef + stepId, no data)', () => {
    const out = parseRunEvent({
      t: 'frame',
      testId: 't1',
      stepId: 's1',
      sessionId: 'sess-1',
      frameRef: 'frames/t1/s1.jpg',
    });
    expect(out?.t).toBe('frame');
    if (out?.t === 'frame') {
      expect(out.frameRef).toBe('frames/t1/s1.jpg');
      expect(out.data).toBeUndefined();
      expect(out.stepId).toBe('s1');
    }
  });

  it('parses component:snapshot with a recursive tree', () => {
    const out = parseRunEvent({
      t: 'component:snapshot',
      testId: 't1',
      stepId: 's1',
      tree: {
        id: 'root',
        name: 'App',
        props: { title: 'hi' },
        children: [
          { id: 'a', name: 'Header', props: {}, children: [] },
          {
            id: 'b',
            name: 'Main',
            props: {},
            children: [{ id: 'c', name: 'Item', props: {}, children: [] }],
          },
        ],
      },
      testIdIndex: { 'submit-btn': 'c' },
    });
    expect(out?.t).toBe('component:snapshot');
    if (out?.t === 'component:snapshot') {
      expect(out.tree.children).toHaveLength(2);
      expect(out.tree.children[1]?.children[0]?.name).toBe('Item');
      expect(out.testIdIndex?.['submit-btn']).toBe('c');
    }
  });

  it('parses component:snapshot without testIdIndex (pre-P9 back-compat)', () => {
    const out = parseRunEvent({
      t: 'component:snapshot',
      testId: 't1',
      stepId: 's1',
      tree: { name: 'App', props: {}, children: [] },
    });
    expect(out?.t).toBe('component:snapshot');
  });

  it('parses component:event', () => {
    expect(parseRunEvent({
      t: 'component:event',
      testId: 't1',
      stepId: 's1',
      kind: 'mount',
      componentName: 'Foo',
      props: { x: 1 },
    })).toMatchObject({ t: 'component:event', kind: 'mount' });
  });

  it('parses a11y:snapshot with a recursive AxNode tree', () => {
    const out = parseRunEvent({
      t: 'a11y:snapshot',
      testId: 't1',
      stepId: 's1',
      tree: {
        role: 'WebArea',
        name: 'page',
        children: [
          {
            role: 'button',
            name: 'Submit',
            disabled: false,
            children: [],
          },
        ],
      },
    });
    expect(out?.t).toBe('a11y:snapshot');
    if (out?.t === 'a11y:snapshot') {
      expect(out.tree.children[0]?.role).toBe('button');
    }
  });

  it('parses a11y:violation with impact = string and impact = null', () => {
    const withImpact = parseRunEvent({
      t: 'a11y:violation',
      testId: 't1',
      stepId: 's1',
      ruleId: 'color-contrast',
      impact: 'serious',
      description: 'low contrast',
      help: 'fix it',
      helpUrl: 'https://x',
      targets: ['button.a'],
    });
    expect(withImpact?.t).toBe('a11y:violation');
    const withNullImpact = parseRunEvent({
      t: 'a11y:violation',
      testId: 't1',
      stepId: 's1',
      ruleId: 'r',
      impact: null,
      description: 'd',
      help: 'h',
      helpUrl: 'u',
      targets: [],
    });
    expect(withNullImpact?.t).toBe('a11y:violation');
    if (withNullImpact?.t === 'a11y:violation') expect(withNullImpact.impact).toBeNull();
  });

  it('parses diagnosis:start, diagnosis:chunk, diagnosis:end', () => {
    expect(parseRunEvent({ t: 'diagnosis:start', testId: 't1' })?.t).toBe('diagnosis:start');
    expect(parseRunEvent({ t: 'diagnosis:chunk', testId: 't1', text: 'thinking…' })?.t)
      .toBe('diagnosis:chunk');
    const end = parseRunEvent({
      t: 'diagnosis:end',
      testId: 't1',
      result: {
        classification: 'real-bug',
        confidence: 'high',
        rootCause: 'x',
        evidence: ['e1'],
        suggestedFix: 'do y',
      },
    });
    expect(end?.t).toBe('diagnosis:end');
    if (end?.t === 'diagnosis:end') {
      expect(end.result.classification).toBe('real-bug');
    }
  });

  it('parses diagnosis:end with optional patch and gitContext', () => {
    const end = parseRunEvent({
      t: 'diagnosis:end',
      testId: 't1',
      result: {
        classification: 'test-bug',
        confidence: 'medium',
        rootCause: 'stale spec',
        evidence: ['e'],
        suggestedFix: 'update spec',
        patch: [{ file: 'a.spec.ts', oldStr: 'X', newStr: 'Y', rationale: 'z' }],
        gitContext: {
          specLastChanged: { sha: 'abc', author: 'rey', date: '2026-05-01', message: 'msg' },
        },
      },
    });
    expect(end?.t).toBe('diagnosis:end');
    if (end?.t === 'diagnosis:end') {
      expect(end.result.patch?.[0]?.file).toBe('a.spec.ts');
      expect(end.result.gitContext?.specLastChanged?.sha).toBe('abc');
    }
  });

  // Slice #11 phase 1 — Apply Fix WS round-trip.
  //
  // patch:applied carries enough provenance (file + oldStr + newStr) for
  // the persisted JSONL to be re-run-able. patch:rejected carries the
  // PatchApplier reason verbatim so the dashboard can switch on it
  // without reconstructing the failure mode from a free-form string.
  it('parses patch:applied with the full apply provenance', () => {
    const out = parseRunEvent({
      t: 'patch:applied',
      testId: 't1',
      file: 'src/Counter.tsx',
      oldStr: 'count + 1',
      newStr: 'count - 1',
    });
    expect(out?.t).toBe('patch:applied');
    if (out?.t === 'patch:applied') {
      expect(out.file).toBe('src/Counter.tsx');
      expect(out.oldStr).toBe('count + 1');
      expect(out.newStr).toBe('count - 1');
    }
  });

  it('parses patch:rejected with each reason variant', () => {
    for (const reason of ['oldStr-not-found', 'oldStr-not-unique', 'fs-error'] as const) {
      const out = parseRunEvent({
        t: 'patch:rejected',
        testId: 't1',
        file: 'src/Counter.tsx',
        reason,
      });
      expect(out?.t).toBe('patch:rejected');
      if (out?.t === 'patch:rejected') expect(out.reason).toBe(reason);
    }
  });

  it('parses patch:rejected with optional detail string', () => {
    const out = parseRunEvent({
      t: 'patch:rejected',
      testId: 't1',
      file: 'src/Counter.tsx',
      reason: 'oldStr-not-unique',
      detail: '3',
    });
    expect(out?.t).toBe('patch:rejected');
    if (out?.t === 'patch:rejected') expect(out.detail).toBe('3');
  });

  // Re-run-request WS round-trip (apply-fix loop closure).
  //
  // After Apply Fix mutates a source file, the dashboard's DiagnosticsPanel
  // needs to be able to ask the server "please re-run just this test so I
  // can see whether the fix worked". The wire shape is symmetric to the
  // patch:apply pattern: the WS request itself is server-internal (not a
  // RunEvent); the server's acknowledgement is `test:rerun-requested`,
  // a bus event that flows back to every dashboard client + persists.
  //
  // Actually spawning the re-run is its own slice (runner orchestration);
  // this event is the wire infrastructure that closes the diagnosis loop
  // visually (UI sees the request was accepted) and on disk (operator
  // scrubbing events.jsonl can audit which re-runs were requested).
  it('parses test:rerun-requested', () => {
    const out = parseRunEvent({ t: 'test:rerun-requested', testId: 't1' });
    expect(out?.t).toBe('test:rerun-requested');
    if (out?.t === 'test:rerun-requested') expect(out.testId).toBe('t1');
  });

  it('rejects test:rerun-requested with missing testId', () => {
    expect(parseRunEvent({ t: 'test:rerun-requested' })).toBeNull();
  });

  it('rejects test:rerun-requested with non-string testId', () => {
    expect(parseRunEvent({ t: 'test:rerun-requested', testId: 42 })).toBeNull();
  });

  it('rejects patch:rejected with an unknown reason value', () => {
    // The enum must stay closed — a downstream consumer switching on
    // reason can't have a "what is this?" branch silently appear.
    expect(parseRunEvent({
      t: 'patch:rejected',
      testId: 't1',
      file: 'x.ts',
      reason: 'made-up-reason',
    })).toBeNull();
  });
});

describe('parseRunEvent — rejection cases', () => {
  it('returns null for unknown t', () => {
    expect(parseRunEvent({ t: 'foo:bar', testId: 't1' })).toBeNull();
  });

  it('returns null when t is missing', () => {
    expect(parseRunEvent({ runId: 'r1', totalTests: 3, timestamp: 0 })).toBeNull();
  });

  it('returns null when a required string field is wrong type', () => {
    expect(parseRunEvent({ t: 'run:start', runId: 123, totalTests: 1, timestamp: 0 })).toBeNull();
  });

  it('returns null when a required number field is missing', () => {
    expect(parseRunEvent({ t: 'run:end', passed: 1, failed: 0, skipped: 0 })).toBeNull();
  });

  it('returns null when a discriminated enum value is invalid', () => {
    expect(parseRunEvent({
      t: 'test:end', id: 't1', status: 'aborted', duration: 1,
    })).toBeNull();
  });

  it('returns null when a nested ComponentNode child has wrong shape', () => {
    expect(parseRunEvent({
      t: 'component:snapshot',
      testId: 't1',
      stepId: 's1',
      tree: {
        name: 'A',
        props: {},
        children: [{ name: 42, props: {}, children: [] }],
      },
    })).toBeNull();
  });

  it('returns null for non-object inputs', () => {
    expect(parseRunEvent(null)).toBeNull();
    expect(parseRunEvent(undefined)).toBeNull();
    expect(parseRunEvent('not an object')).toBeNull();
    expect(parseRunEvent(42)).toBeNull();
    expect(parseRunEvent([])).toBeNull();
  });
});

describe('parseRunEvent — loose contract on extra fields', () => {
  it('accepts events with unknown extra fields and drops them silently', () => {
    const out = parseRunEvent({
      t: 'run:start',
      runId: 'r1',
      totalTests: 1,
      timestamp: 0,
      futureField: 'from a newer reactlens version',
    });
    expect(out).toEqual({ t: 'run:start', runId: 'r1', totalTests: 1, timestamp: 0 });
  });

  it('accepts component:snapshot with extra nested fields on the tree', () => {
    const out = parseRunEvent({
      t: 'component:snapshot',
      testId: 't1',
      stepId: 's1',
      tree: {
        name: 'A',
        props: {},
        children: [],
        futureNodeField: 'extra',
      },
    });
    expect(out?.t).toBe('component:snapshot');
  });
});

describe('parseRunEvent — type-narrowing works after parse', () => {
  it('returns a TS-narrowable RunEvent so consumers can switch exhaustively', () => {
    const out: RunEvent | null = parseRunEvent({
      t: 'frame',
      testId: 't1',
      sessionId: 's',
      data: 'B==',
    });
    if (out === null) throw new Error('expected non-null');
    // The switch below only typechecks if out is a real RunEvent (not unknown).
    let label = '';
    switch (out.t) {
      case 'frame':
        label = `frame ${out.testId}`;
        break;
      default:
        label = 'other';
    }
    expect(label).toBe('frame t1');
  });
});
