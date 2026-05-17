import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ComponentNode, Diagnosis, FrameSource, RunEvent, TestRow, TimelineStep } from './types';
import { TestList } from './components/TestList';
import { BrowserPreview } from './components/BrowserPreview';
import { ComponentInspector } from './components/ComponentInspector';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';
import { RunPicker } from './components/RunPicker';
import { TimelineSlider } from './components/TimelineSlider';
import { buildTimelineFromEvents } from './replay-timeline';
import { builtinWebPlugin } from './builtin-plugin';
import {
  resolveFrameRenderer,
  type DashboardPlugin,
} from '../plugins';

// `'web'` is the protocol's implicit default when a `frame` event omits its
// own `source` field — keep this in lockstep with the BC contract in events.ts.
const DEFAULT_FRAME_SOURCE = 'web';

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
  // P6: source discriminator per test ('web', 'native', ...). Picks which
  // registered plugin renders the frame. Defaults to 'web' when the underlying
  // event omits the field.
  frameSourceByTest: Map<string, string>;
  componentsByTest: Map<string, ComponentNode>;
  // P9: per-test data-testid → fiber-id index, shipped alongside each
  // component:snapshot. Used by ComponentInspector to highlight the exact
  // owning fiber instead of relying on a name match. Replaced when a new
  // snapshot arrives for the same test.
  testIdIndexByTest: Map<string, Record<string, string>>;
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
  frameSourceByTest: new Map(),
  componentsByTest: new Map(),
  testIdIndexByTest: new Map(),
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
      // Only the WIRE variant of `frame` has `data` (base64). The DISK
      // variant (`frameRef`) reaches the dashboard via `replay:frame` after
      // the loader resolves it to a URL — never via this case. Guard so the
      // type narrows and the reducer is honest about which shape it handles.
      if (e.data === undefined) return state;
      // Live frames ship base64 over WS. The same-data short-circuit keeps
      // React from re-rendering at 30 fps when nothing visible has changed.
      const prev = state.framesByTest.get(e.testId);
      const newSource = e.source ?? DEFAULT_FRAME_SOURCE;
      const prevSource = state.frameSourceByTest.get(e.testId);
      const sameFrame = prev !== undefined && prev.kind === 'base64' && prev.data === e.data;
      const sameSource = prevSource === newSource;
      if (sameFrame && sameSource) return state;
      const data = e.data;
      const framesByTest = sameFrame
        ? state.framesByTest
        : new Map(state.framesByTest).set(e.testId, { kind: 'base64', data });
      const frameSourceByTest = sameSource
        ? state.frameSourceByTest
        : new Map(state.frameSourceByTest).set(e.testId, newSource);
      return { ...state, framesByTest, frameSourceByTest };
    }
    case 'component:snapshot': {
      const componentsByTest = new Map(state.componentsByTest);
      componentsByTest.set(e.testId, e.tree);
      // P9: capture testIdIndex when present (probe ≥ P9 build). When the
      // event lacks the field we don't overwrite an existing index — keeps
      // the inspector functional during the rollout window where some
      // snapshots ship the index and others don't.
      let testIdIndexByTest = state.testIdIndexByTest;
      if (e.testIdIndex !== undefined) {
        testIdIndexByTest = new Map(testIdIndexByTest);
        testIdIndexByTest.set(e.testId, e.testIdIndex);
      }
      return { ...state, componentsByTest, testIdIndexByTest };
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

// Hydrates state from a past run's events.jsonl. Reduces over the events to
// build head-of-test maps, runs buildTimelineFromEvents to populate the
// slider data, then dispatches one `replace` so React renders once.
async function loadPastRun(runId: string, dispatch: React.Dispatch<Action>): Promise<void> {
  const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/events`);
  if (!res.ok) throw new Error(`failed to load run ${runId}: ${res.status}`);
  const text = await res.text();

  const frameUrl = (frameRef: string): string =>
    `/api/runs/${encodeURIComponent(runId)}/${frameRef}`;
  const timelineByTest = buildTimelineFromEvents(text, frameUrl);

  let next: State = { ...initialState, mode: 'replay', runId };
  for (const line of text.split('\n')) {
    if (line.length === 0) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (parsed['t'] === 'frame') {
      const testId = parsed['testId'] as string | undefined;
      const frameRef = parsed['frameRef'] as string | undefined;
      if (testId === undefined || frameRef === undefined) continue;
      next = reducer(next, { t: 'replay:frame', testId, url: frameUrl(frameRef) });
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

type AppProps = {
  // P6: plugin registry. The host (reactlens itself, nativelens, future tools)
  // injects renderers keyed by `frame.source`. Defaults to the built-in web
  // plugin so reactlens stays unchanged when consumed without arguments.
  plugins?: DashboardPlugin[];
};

export function App({ plugins = [builtinWebPlugin] }: AppProps = {}): JSX.Element {
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
  // P6: pick the host-registered renderer for this test's frame source.
  // BrowserPreview is the fallback when no plugin claims the source — keeps
  // the dashboard usable even if a host forgot to register a renderer for a
  // source it emits.
  const selectedFrameSource =
    state.selectedTestId !== null
      ? state.frameSourceByTest.get(state.selectedTestId) ?? DEFAULT_FRAME_SOURCE
      : DEFAULT_FRAME_SOURCE;
  const FrameRendererForSelected =
    resolveFrameRenderer(selectedFrameSource, plugins) ?? BrowserPreview;
  const selectedTree = state.selectedTestId !== null ? state.componentsByTest.get(state.selectedTestId) : undefined;
  const selectedDiagnosis = state.selectedTestId !== null ? state.diagnosesByTest.get(state.selectedTestId) : undefined;
  const selectedActiveStep =
    state.selectedTestId !== null ? state.activeStepByTest.get(state.selectedTestId) : undefined;
  const selectedTestIdIndex =
    state.selectedTestId !== null ? state.testIdIndexByTest.get(state.selectedTestId) : undefined;

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
          <FrameRendererForSelected frame={selectedFrame} test={selected} />
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
          <ComponentInspector
            tree={selectedTree}
            activeStep={selectedActiveStep}
            testIdIndex={selectedTestIdIndex}
          />
          <DiagnosticsPanel test={selected} diagnosis={selectedDiagnosis} />
        </div>
      </div>
    </div>
  );
}
