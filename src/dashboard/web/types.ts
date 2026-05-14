// Frontend-local re-export of the canonical event protocol. Vite bundles the
// referenced types at build time, so the runtime bundle stays self-contained;
// keeping a single source prevents the protocol drift CLAUDE.md §9 warns about.
export type {
  Attachment,
  ComponentNode,
  Diagnosis,
  HookSnapshot,
  RunEvent,
  RunEventByType,
  RunEventType,
} from '../../runner/events';

export type TestRow = {
  id: string;
  title: string;
  file: string;
  suite: string;
  status: 'running' | 'passed' | 'failed' | 'skipped' | 'timedOut';
  duration?: number;
  error?: string;
};

// Frames arrive two ways: live runs ship base64 JPEGs over the WS (cheap to
// inline), past runs are addressed by HTTP URL into the /api/runs/:id/frames
// route. Discriminating at storage time keeps the BrowserPreview component
// agnostic of which mode produced the frame.
export type FrameSource =
  | { kind: 'base64'; data: string }
  | { kind: 'url'; url: string };

export type PastRun = {
  runId: string;
  startedAt?: number;
  totalTests?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
  duration?: number;
};

// One entry per Playwright step in a replayed test. Built by the JSONL
// loader so the TimelineSlider can scrub through DOM frame + component
// tree state at every recorded step. Empty in live mode — the live
// stream updates the head-of-test values directly.
export type TimelineStep = {
  stepId: string;
  title: string;
  frame?: FrameSource;
  tree?: ComponentNode;
};
