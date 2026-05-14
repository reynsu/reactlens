import { useEffect, useMemo, useReducer, useState } from 'react';
import type { ComponentNode, Diagnosis, RunEvent, TestRow } from './types';
import { TestList } from './components/TestList';
import { BrowserPreview } from './components/BrowserPreview';
import { ComponentInspector } from './components/ComponentInspector';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';

type ActiveStep = { stepId: string; title: string };

type State = {
  // Active run identifier — set on run:start, kept across the run so the P8
  // persistence layer + future "past runs" picker can address this run by id.
  runId: string | null;
  tests: Map<string, TestRow>;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  selectedTestId: string | null;
  framesByTest: Map<string, string>;
  componentsByTest: Map<string, ComponentNode>;
  diagnosesByTest: Map<string, { streamingText: string; final?: Diagnosis }>;
  // The latest step:start that hasn't been closed by step:end yet, per test.
  // Drives the "currently executing" indicator in the inspector header.
  // Cleared on step:end + test:end.
  activeStepByTest: Map<string, ActiveStep>;
};

const initialState: State = {
  runId: null,
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
};

type Action = RunEvent | { t: 'select'; id: string };

function reducer(state: State, e: Action): State {
  switch (e.t) {
    case 'select':
      return { ...state, selectedTestId: e.id };
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
      // Same testId + same data ⇒ skip the Map clone so React doesn't rerender
      // every screencast frame when the preview hasn't actually changed.
      if (state.framesByTest.get(e.testId) === e.data) return state;
      const framesByTest = new Map(state.framesByTest);
      framesByTest.set(e.testId, e.data);
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

function useDashboardSocket(dispatch: React.Dispatch<Action>): { connected: boolean } {
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
  }, []);

  return { connected };
}

export function App(): JSX.Element {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { connected } = useDashboardSocket(dispatch);

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
        <div className="stats">
          <span style={{ color: 'var(--pass)' }}>✓ {state.passed}</span>
          <span style={{ color: 'var(--fail)' }}>✗ {state.failed}</span>
          <span style={{ color: 'var(--skip)' }}>− {state.skipped}</span>
          <span>{state.tests.size}/{state.totalTests} run</span>
          {state.durationMs > 0 && <span>{(state.durationMs / 1000).toFixed(1)}s</span>}
          <span style={{ color: connected ? 'var(--pass)' : 'var(--fail)' }}>● {connected ? 'live' : 'reconnecting'}</span>
        </div>
      </header>
      <div className="layout">
        <TestList tests={sortedTests} selectedId={state.selectedTestId} onSelect={(id) => dispatch({ t: 'select', id })} />
        <BrowserPreview frame={selectedFrame} test={selected} />
        <div className="panel">
          <ComponentInspector tree={selectedTree} activeStep={selectedActiveStep} />
          <DiagnosticsPanel test={selected} diagnosis={selectedDiagnosis} />
        </div>
      </div>
    </div>
  );
}
