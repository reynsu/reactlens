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
  | { t: 'component:snapshot'; testId: string; stepId: string; tree: ComponentNode }
  | {
      t: 'component:event';
      testId: string;
      stepId: string;
      kind: 'mount' | 'unmount' | 'update';
      componentName: string;
      props?: Record<string, unknown>;
    }
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
