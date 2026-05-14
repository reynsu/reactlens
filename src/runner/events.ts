// Canonical RunEvent union per CLAUDE.md Section 9. Discriminated by `t`.
// Every consumer (event bus, dashboard server, frontend, diagnostics) MUST
// switch exhaustively on `t`. Adding a variant is a breaking change requiring
// updates to all of: streaming-reporter (template), runner, event bus,
// dashboard, and any switches over RunEvent.

export type Attachment = {
  name: string;
  path: string;
  contentType?: string;
};

export type ComponentNode = {
  // Per-snapshot stable id assigned by the probe (P9). Optional on the
  // wire so older persisted runs (events.jsonl from pre-P9 builds) still
  // parse — consumers must tolerate its absence.
  id?: string;
  name: string;
  key?: string | null;
  props: Record<string, unknown>;
  hooks?: HookSnapshot[];
  source?: { file: string; line: number };
  children: ComponentNode[];
};

export type HookSnapshot = {
  kind: 'state' | 'effect' | 'memo' | 'ref' | 'context' | 'reducer' | 'other';
  value?: unknown;
  name?: string;
};

// Accessibility tree node — mirrors Playwright's page.accessibility.snapshot()
// shape (a subset of the W3C ARIA tree). Captured per test at end-of-test by
// the reactlens fixture and shipped as `a11y:snapshot` events (P12 part 2).
// Used by src/analyzer/a11y-diff.ts for semantic visual regression that
// reads what a screen-reader user perceives rather than pixels.
export type AxNode = {
  role: string;
  name?: string;
  value?: string | number;
  description?: string;
  keyshortcuts?: string;
  roledescription?: string;
  valuetext?: string;
  disabled?: boolean;
  expanded?: boolean;
  focused?: boolean;
  modal?: boolean;
  multiline?: boolean;
  multiselectable?: boolean;
  readonly?: boolean;
  required?: boolean;
  selected?: boolean;
  checked?: boolean | 'mixed';
  pressed?: boolean | 'mixed';
  level?: number;
  valuemin?: number;
  valuemax?: number;
  autocomplete?: string;
  haspopup?: string;
  invalid?: string;
  orientation?: string;
  children: AxNode[];
};

export type Diagnosis = {
  classification: 'real-bug' | 'test-bug' | 'flaky' | 'env-issue';
  confidence: 'high' | 'medium' | 'low';
  rootCause: string;
  evidence: string[];
  suggestedFix: string;
  patch?: Array<{ file: string; oldStr: string; newStr: string; rationale: string }>;
  gitContext?: {
    componentLastChanged?: { sha: string; author: string; date: string; message: string };
    specLastChanged?: { sha: string; author: string; date: string; message: string };
  };
};

export type RunEvent =
  | { t: 'run:start'; runId: string; totalTests: number; timestamp: number }
  | { t: 'run:end'; passed: number; failed: number; skipped: number; duration: number }
  | { t: 'test:start'; id: string; title: string; file: string; suite: string }
  | {
      t: 'test:end';
      id: string;
      status: 'passed' | 'failed' | 'skipped' | 'timedOut';
      duration: number;
      error?: string;
      attachments?: Attachment[];
    }
  | { t: 'step:start'; testId: string; stepId: string; title: string }
  | { t: 'step:end'; testId: string; stepId: string; status: 'passed' | 'failed' }
  | { t: 'frame'; testId: string; data: string; sessionId: string }
  | {
      t: 'component:snapshot';
      testId: string;
      stepId: string;
      tree: ComponentNode;
      // P9: probe-built map of data-testid → ComponentNode.id of the
      // nearest enclosing user-component fiber. Optional for back-compat
      // with snapshots persisted before P9 shipped. When absent, the
      // dashboard falls back to Gap 4's name heuristic.
      testIdIndex?: Record<string, string>;
    }
  | {
      t: 'component:event';
      testId: string;
      stepId: string;
      kind: 'mount' | 'unmount' | 'update';
      componentName: string;
      props?: Record<string, unknown>;
    }
  // P12 part 2: end-of-test snapshot of the accessibility tree, emitted by
  // the Playwright fixture via page.accessibility.snapshot(). Drives
  // semantic visual regression — diff a11y trees instead of pixels.
  | { t: 'a11y:snapshot'; testId: string; stepId: string; tree: AxNode }
  | { t: 'diagnosis:start'; testId: string }
  | { t: 'diagnosis:chunk'; testId: string; text: string }
  | { t: 'diagnosis:end'; testId: string; result: Diagnosis };

export type RunEventType = RunEvent['t'];
export type RunEventByType<T extends RunEventType> = Extract<RunEvent, { t: T }>;

// Exhaustive list of every RunEvent variant. The `satisfies` clause makes
// TypeScript reject this file if a RunEvent variant is added but not listed
// here, which keeps subscribers (server, run command, dashboard) in sync.
export const ALL_EVENT_TYPES = [
  'run:start',
  'run:end',
  'test:start',
  'test:end',
  'step:start',
  'step:end',
  'frame',
  'component:snapshot',
  'component:event',
  'a11y:snapshot',
  'diagnosis:start',
  'diagnosis:chunk',
  'diagnosis:end',
] as const satisfies readonly RunEventType[];

// Compile-time exhaustiveness: this assignment fails if a RunEvent variant
// isn't included in ALL_EVENT_TYPES.
type _AssertExhaustive = Exclude<RunEventType, (typeof ALL_EVENT_TYPES)[number]> extends never
  ? true
  : ['ALL_EVENT_TYPES is missing variants'];
const _exhaustive: _AssertExhaustive = true;
void _exhaustive;
