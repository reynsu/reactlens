import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ComponentNode, Diagnosis, FrameSource, RunEvent, TestRow, TimelineStep } from './types';
import { TestList } from './components/TestList';
import { BrowserPreview } from './components/BrowserPreview';
import { ComponentInspector } from './components/ComponentInspector';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';
import { RunPicker } from './components/RunPicker';
import { TimelineSlider } from './components/TimelineSlider';

type ActiveStep = { stepId: string; title: string };

type State = {
  // Active run identifier — set on run:start (live) or replay:start (past).
  runId: string | null;
  // 'live': WS events update state. 'replay': WS dropped, state is the
  // hydrated past run. Switched by RunPicker.
  mode: 'live' | 'replay';
  tests: Map<string, TestRow>;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  selectedTestId: string | null;
  framesByTest: Map<string, FrameSource>;
  componentsByTest: Map<string, ComponentNode>;
  diagnosesByTest: Map<string, { streamingText: string; final?: Diagnosis }>;
  // The latest step:start that hasn't been closed by step:end yet, per test.
  // Drives the "currently executing" indicator in the inspector header.
  // Cleared on step:end + test:end.
  activeStepByTest: Map<string, ActiveStep>;
  // Replay-only: per-test step-by-step record of (frame, tree) snapshots.
  // Built by the JSONL loader; empty in live mode. The slider scrubs this.
  timelineByTest: Map<string, TimelineStep[]>;
  // Replay-only: which step index the slider is parked on, per test.
  // Defaults to last step (= end-of-test view) on initial hydration.
  selectedStepIdxByTest: Map<string, number>;
};

const initialState: State = {
  runId: null,
  mode: 'live',
  tests: new Map(),
  totalTests: 0,
  passed: 0,
  failed: 0,
  skipped: 0,
  durationMs: 0,
  selectedTestId: null,
  framesByTest: new Map(),
  componentsByTest: new Map(),
  diagnosesByTest: new Map(),
  activeStepByTest: new Map(),
  timelineByTest: new Map(),
  selectedStepIdxByTest: new Map(),
};

type Action =
  | RunEvent
  | { t: 'select'; id: string }
  // RunPicker → loader pipeline. `replay:start` clears state for a fresh
  // hydration; `replay:frame` writes a URL-backed frame (the persistor
  // JSONL line has frameRef instead of base64 data); `replace` swaps the
  // whole state object in one tick (the loader builds it locally first,
  // then dispatches once to avoid per-event re-renders).
  | { t: 'replay:start'; runId: string }
  | { t: 'replay:frame'; testId: string; url: string }
  | { t: 'live:resume' }
  | { t: 'replace'; state: State }
  // Slider movement during replay. Rewires the head-of-test
  // frame/tree to the chosen step so existing rendering stays unchanged.
  | { t: 'select:step'; testId: string; stepIdx: number };

function reducer(state: State, e: Action): State {
  switch (e.t) {
    case 'select':
      return { ...state, selectedTestId: e.id };
    case 'replace':
      return e.state;
    case 'replay:start':
      return { ...initialState, mode: 'replay', runId: e.runId };
    case 'live:resume':
      return { ...initialState, mode: 'live' };
    case 'replay:frame': {
      const framesByTest = new Map(state.framesByTest);
      framesByTest.set(e.testId, { kind: 'url', url: e.url });
      return { ...state, framesByTest };
    }
    case 'select:step': {
      const steps = state.timelineByTest.get(e.testId);
      if (steps === undefined || steps.length === 0) return state;
      const idx = Math.max(0, Math.min(e.stepIdx, steps.length - 1));
      const step = steps[idx];
      if (step === undefined) return state;
      const selectedStepIdxByTest = new Map(state.selectedStepIdxByTest);
      selectedStepIdxByTest.set(e.testId, idx);
      // Rewire head-of-test maps so BrowserPreview + ComponentInspector
      // re-read the chosen step. If a step never produced a frame/tree
      // we leave the previous value in place to avoid flicker.
      const framesByTest = step.frame !== undefined
        ? new Map(state.framesByTest).set(e.testId, step.frame)
        : state.framesByTest;
      const componentsByTest = step.tree !== undefined
        ? new Map(state.componentsByTest).set(e.testId, step.tree)
        : state.componentsByTest;
      return { ...state, selectedStepIdxByTest, framesByTest, componentsByTest };
    }
    case 'run:start':
      return { ...state, runId: e.runId, totalTests: e.totalTests, tests: new Map(), passed: 0, failed: 0, skipped: 0 };
    case 'run:end':
      return { ...state, passed: e.passed, failed: e.failed, skipped: e.skipped, durationMs: e.duration };
    case 'test:start': {
      const tests = new Map(state.tests);
      tests.set(e.id, { id: e.id, title: e.title, file: e.file, suite: e.suite, status: 'running' });
      return { ...state, tests, selectedTestId: state.selectedTestId ?? e.id };
    }
    case 'test:end': {
      const tests = new Map(state.tests);
      const existing = tests.get(e.id);
      if (existing !== undefined) {
        tests.set(e.id, { ...existing, status: e.status, duration: e.duration, error: e.error });
      }
      const activeStepByTest = new Map(state.activeStepByTest);
      activeStepByTest.delete(e.id);
      return { ...state, tests, activeStepByTest };
    }
    case 'step:start': {
      const activeStepByTest = new Map(state.activeStepByTest);
      activeStepByTest.set(e.testId, { stepId: e.stepId, title: e.title });
      return { ...state, activeStepByTest };
    }
    case 'step:end': {
      // Only clear if the closing step matches the active one — protects
      // against out-of-order events where a later step:start arrived before
      // an earlier step:end. In practice Playwright doesn't interleave, but
      // we'd rather show a slightly-stale step than no step at all.
      const current = state.activeStepByTest.get(e.testId);
      if (current === undefined || current.stepId !== e.stepId) return state;
      const activeStepByTest = new Map(state.activeStepByTest);
      activeStepByTest.delete(e.testId);
      return { ...state, activeStepByTest };
    }
    case 'frame': {
      // Live frames ship base64 over WS. The same-data short-circuit keeps
      // React from re-rendering at 30 fps when nothing visible has changed.
      const prev = state.framesByTest.get(e.testId);
      if (prev !== undefined && prev.kind === 'base64' && prev.data === e.data) return state;
      const framesByTest = new Map(state.framesByTest);
      framesByTest.set(e.testId, { kind: 'base64', data: e.data });
      return { ...state, framesByTest };
    }
    case 'component:snapshot': {
      const componentsByTest = new Map(state.componentsByTest);
      componentsByTest.set(e.testId, e.tree);
      return { ...state, componentsByTest };
    }
    case 'diagnosis:start': {
      const diagnosesByTest = new Map(state.diagnosesByTest);
      diagnosesByTest.set(e.testId, { streamingText: '' });
      return { ...state, diagnosesByTest };
    }
    case 'diagnosis:chunk': {
      const diagnosesByTest = new Map(state.diagnosesByTest);
      const existing = diagnosesByTest.get(e.testId) ?? { streamingText: '' };
      diagnosesByTest.set(e.testId, { ...existing, streamingText: existing.streamingText + e.text });
      return { ...state, diagnosesByTest };
    }
    case 'diagnosis:end': {
      const diagnosesByTest = new Map(state.diagnosesByTest);
      const existing = diagnosesByTest.get(e.testId) ?? { streamingText: '' };
      diagnosesByTest.set(e.testId, { ...existing, final: e.result });
      return { ...state, diagnosesByTest };
    }
    default:
      return state;
  }
}

function useDashboardSocket(
  dispatch: React.Dispatch<Action>,
  modeRef: React.MutableRefObject<'live' | 'replay'>,
): { connected: boolean } {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket | null = null;
    let backoff = 200;

    function connect(): void {
      if (cancelled) return;
      const url = `ws://${window.location.host}/ws/dashboard`;
      socket = new WebSocket(url);
      socket.addEventListener('open', () => {
        backoff = 200;
        setConnected(true);
      });
      socket.addEventListener('message', (msg) => {
        // Drop live events while viewing a past run — otherwise a fresh run
        // landing on the WS would overwrite the replay'd state mid-inspection.
        if (modeRef.current === 'replay') return;
        try {
          const event = JSON.parse(typeof msg.data === 'string' ? msg.data : msg.data.toString()) as RunEvent;
          dispatch(event);
        } catch {
          /* ignore */
        }
      });
      socket.addEventListener('close', () => {
        setConnected(false);
        if (cancelled) return;
        const delay = backoff;
        backoff = Math.min(backoff * 2, 5_000);
        setTimeout(connect, delay);
      });
      socket.addEventListener('error', () => socket?.close());
    }

    connect();
    return () => {
      cancelled = true;
      socket?.close();
    };
  }, [dispatch, modeRef]);

  return { connected };
}

// Hydrates state from a past run's events.jsonl. Builds the next state in a
// local variable using the existing reducer, then dispatches one `replace`
// so React only renders once for the whole replay.
//
// Side-builds timelineByTest as it walks lines: step:start pushes a new entry,
// frame/component:snapshot attach to the matching step (by stepId when
// available, otherwise the currently-open step). The slider scrubs this.
async function loadPastRun(runId: string, dispatch: React.Dispatch<Action>): Promise<void> {
  const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/events`);
  if (!res.ok) throw new Error(`failed to load run ${runId}: ${res.status}`);
  const text = await res.text();

  const timelineByTest = new Map<string, TimelineStep[]>();
  // The index of the currently-open step per test. Frame events have no
  // stepId of their own in the standard RunEvent shape, so we lean on this
  // to know which step a freshly-arrived frame belongs to.
  const openStepIdx = new Map<string, number>();

  let next: State = { ...initialState, mode: 'replay', runId };

  for (const line of text.split('\n')) {
    if (line.length === 0) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const t = parsed['t'];
    const testId = parsed['testId'] as string | undefined;

    // Build the timeline side-structure first so frame/snapshot can attach to
    // the right entry below.
    if (t === 'step:start' && testId !== undefined) {
      const arr = timelineByTest.get(testId) ?? [];
      arr.push({
        stepId: (parsed['stepId'] as string | undefined) ?? '',
        title: (parsed['title'] as string | undefined) ?? '',
      });
      timelineByTest.set(testId, arr);
      openStepIdx.set(testId, arr.length - 1);
    } else if (t === 'frame' && testId !== undefined) {
      const frameRef = parsed['frameRef'] as string | undefined;
      const arr = timelineByTest.get(testId);
      const idx = openStepIdx.get(testId);
      if (arr !== undefined && idx !== undefined && frameRef !== undefined) {
        const step = arr[idx];
        if (step !== undefined) {
          step.frame = { kind: 'url', url: `/api/runs/${encodeURIComponent(runId)}/${frameRef}` };
        }
      }
    } else if (t === 'component:snapshot' && testId !== undefined) {
      const stepId = parsed['stepId'] as string | undefined;
      const arr = timelineByTest.get(testId);
      if (arr !== undefined && arr.length > 0) {
        const matched = stepId !== undefined ? arr.findIndex((s) => s.stepId === stepId) : -1;
        const idx = matched >= 0 ? matched : (openStepIdx.get(testId) ?? arr.length - 1);
        const step = arr[idx];
        if (step !== undefined) step.tree = parsed['tree'] as TimelineStep['tree'];
      }
    }

    // Existing reducer pass — keeps head-of-test maps populated as before.
    if (t === 'frame') {
      const frameRef = parsed['frameRef'] as string | undefined;
      if (testId === undefined || frameRef === undefined) continue;
      next = reducer(next, {
        t: 'replay:frame',
        testId,
        url: `/api/runs/${encodeURIComponent(runId)}/${frameRef}`,
      });
    } else {
      next = reducer(next, parsed as unknown as RunEvent);
    }
  }

  // Park each test's slider on its last step — most useful default for the
  // user opening a finished run is "where did it end up".
  const selectedStepIdxByTest = new Map<string, number>();
  for (const [testId, steps] of timelineByTest) {
    selectedStepIdxByTest.set(testId, steps.length - 1);
  }

  next = { ...next, timelineByTest, selectedStepIdxByTest };
  dispatch({ t: 'replace', state: next });
}

export function App(): JSX.Element {
  const [state, dispatch] = useReducer(reducer, initialState);
  const modeRef = useRef<'live' | 'replay'>(state.mode);
  modeRef.current = state.mode;
  const { connected } = useDashboardSocket(dispatch, modeRef);
  const [pickerBusy, setPickerBusy] = useState(false);

  const onSelectRun = useCallback(async (runId: string) => {
    setPickerBusy(true);
    try {
      // Clear first so the user sees the transition; then hydrate from JSONL.
      dispatch({ t: 'replay:start', runId });
      await loadPastRun(runId, dispatch);
    } catch (err) {
      // Loading failed — fall back to live mode rather than leaving the user
      // stranded in a half-loaded state.
      // eslint-disable-next-line no-console
      console.error('past-run load failed', err);
      dispatch({ t: 'live:resume' });
    } finally {
      setPickerBusy(false);
    }
  }, []);

  const onSelectLive = useCallback(() => {
    dispatch({ t: 'live:resume' });
  }, []);

  const onStepChange = useCallback(
    (testId: string, stepIdx: number) => dispatch({ t: 'select:step', testId, stepIdx }),
    [],
  );

  const sortedTests = useMemo(() => Array.from(state.tests.values()), [state.tests]);
  const selected = state.selectedTestId !== null ? state.tests.get(state.selectedTestId) : undefined;
  const selectedFrame = state.selectedTestId !== null ? state.framesByTest.get(state.selectedTestId) : undefined;
  const selectedTree = state.selectedTestId !== null ? state.componentsByTest.get(state.selectedTestId) : undefined;
  const selectedDiagnosis = state.selectedTestId !== null ? state.diagnosesByTest.get(state.selectedTestId) : undefined;
  const selectedActiveStep =
    state.selectedTestId !== null ? state.activeStepByTest.get(state.selectedTestId) : undefined;

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>reactlens</h1>
        </div>
        <RunPicker
          currentRunId={state.mode === 'replay' ? state.runId : null}
          onSelectLive={onSelectLive}
          onSelectRun={onSelectRun}
          busy={pickerBusy}
        />
        <div className="stats">
          <span style={{ color: 'var(--pass)' }}>✓ {state.passed}</span>
          <span style={{ color: 'var(--fail)' }}>✗ {state.failed}</span>
          <span style={{ color: 'var(--skip)' }}>− {state.skipped}</span>
          <span>{state.tests.size}/{state.totalTests} run</span>
          {state.durationMs > 0 && <span>{(state.durationMs / 1000).toFixed(1)}s</span>}
          {state.mode === 'replay' ? (
            <span style={{ color: 'var(--muted)' }}>◐ replay</span>
          ) : (
            <span style={{ color: connected ? 'var(--pass)' : 'var(--fail)' }}>
              ● {connected ? 'live' : 'reconnecting'}
            </span>
          )}
        </div>
      </header>
      <div className="layout">
        <TestList tests={sortedTests} selectedId={state.selectedTestId} onSelect={(id) => dispatch({ t: 'select', id })} />
        <div className="preview-column">
          <BrowserPreview frame={selectedFrame} test={selected} />
          {state.mode === 'replay' && state.selectedTestId !== null && (() => {
            const steps = state.timelineByTest.get(state.selectedTestId);
            if (steps === undefined) return null;
            const currentIdx = state.selectedStepIdxByTest.get(state.selectedTestId) ?? steps.length - 1;
            const testId = state.selectedTestId;
            return (
              <TimelineSlider
                steps={steps}
                currentIdx={currentIdx}
                onChange={(idx) => onStepChange(testId, idx)}
              />
            );
          })()}
        </div>
        <div className="panel">
          <ComponentInspector tree={selectedTree} activeStep={selectedActiveStep} />
          <DiagnosticsPanel test={selected} diagnosis={selectedDiagnosis} />
        </div>
      </div>
    </div>
  );
}
