// Canonical RunEvent union per CLAUDE.md Section 9. Discriminated by `t`.
// Every consumer (event bus, dashboard server, frontend, diagnostics) MUST
// switch exhaustively on `t`. Adding a variant is a breaking change requiring
// updates to all of: streaming-reporter (template), runner, event bus,
// dashboard, and any switches over RunEvent.
//
// Two enforcement layers:
//   * Compile-time: ALL_EVENT_TYPES + _AssertExhaustive guarantees the
//     exhaustive list stays aligned with the union definition.
//   * Runtime: runEventSchema + parseRunEvent validate untyped JSON at the
//     ingestion boundaries (subprocess stdin, WS probe, persisted JSONL).
//     Bus subscribers downstream of those gates trust the bus.
import { z } from 'zod';

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

// Canonical Diagnosis shape now lives in @reynsu/reactlens-diagnosis-prompts.
// Re-exported here so downstream imports (commands/analyze, dashboard/web/types)
// don't need to update their import paths — they keep importing from
// runner/events as the single internal protocol entry point. Imported as a
// local symbol so the RunEvent discriminated union below can reference it.
import type { Diagnosis } from '@reynsu/reactlens-diagnosis-prompts';
export type { Diagnosis };

// One entry per test in the suite roster the reporter enumerates at onBegin
// (before any test runs). Shipped on `run:start` so the dashboard can render
// the complete test list up front, every entry `pending` until its own
// test:start/test:end arrives. `id` MUST match the id the reporter later emits
// on test:start so the dashboard reducer can flip the same row in place.
export type TestPlanEntry = { id: string; title: string; file: string; suite: string };

export type RunEvent =
  // `tests` (v0.3) is the full suite roster enumerated at onBegin. Optional
  // for back-compat: standalone `playwright test` runs and pre-v0.3 persisted
  // runs omit it, and the dashboard falls back to populating the list
  // incrementally from test:start events.
  | { t: 'run:start'; runId: string; totalTests: number; timestamp: number; tests?: TestPlanEntry[] }
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
  // The `frame` variant has TWO valid shapes that share the same `t`:
  //   - WIRE  (probe/runner → bus): { testId, sessionId, data: string }
  //                                  data is a base64 JPEG payload (~50 KB).
  //   - DISK  (events.jsonl):       { testId, stepId, sessionId, frameRef: string }
  //                                  data has been split off to <run>/frames/<test>/<step>.jpg
  //                                  and replaced with frameRef pointing at it.
  //                                  The persistor (event-persistor.ts) is the
  //                                  transformer; the activeStep map provides
  //                                  stepId since wire frames have none.
  // Exactly one of {data, frameRef} is present at runtime. Optional in the
  // type so a single discriminated union covers both shapes — the alternative
  // (a separate `frame:persisted` variant) would force every disk reader to
  // discriminate twice (`t === 'frame' || t === 'frame:persisted'`).
  | {
      t: 'frame';
      testId: string;
      sessionId: string;
      data?: string;
      frameRef?: string;
      stepId?: string;
      // P6: identifies which dashboard plugin should render this frame.
      // Absent on legacy / web-only frames (consumer defaults to 'web');
      // nativelens emits `'native'` so the DevicePreview plugin picks them up.
      source?: string;
      // #76: capture time of this frame in epoch milliseconds, sourced from
      // Page.screencastFrame metadata. Carries end-to-end (wire → disk JSONL)
      // so a recorded run can later be played back at its true cadence (#78/#79).
      // Optional for back-compat with pre-#76 persisted runs and standalone
      // runs whose CDP metadata omits a timestamp.
      timestamp?: number;
    }
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
  // P13: one event per accessibility violation found by axe-core at
  // end-of-test. Promotes a11y to first-class evidence in every test run —
  // the dashboard surfaces these alongside props/state in the inspector,
  // and a per-run summary lets the inner dev loop catch regressions.
  | {
      t: 'a11y:violation';
      testId: string;
      stepId: string;
      ruleId: string;
      impact: 'minor' | 'moderate' | 'serious' | 'critical' | null;
      description: string;
      help: string;
      helpUrl: string;
      // CSS selector paths for each offending element axe-core flagged.
      // Flattened so consumers don't need to parse axe's nested 'nodes' shape.
      targets: string[];
    }
  | { t: 'diagnosis:start'; testId: string }
  | { t: 'diagnosis:chunk'; testId: string; text: string }
  | { t: 'diagnosis:end'; testId: string; result: Diagnosis }
  // Slice #11 phase 1 — Apply Fix WS round-trip. The dashboard server's
  // WS handler invokes PatchApplier on an inbound patch:apply request
  // and emits one of these onto the bus. Persisted into events.jsonl
  // so a future operator can audit which fixes were applied to which
  // run (and which were refused, with the reason verbatim).
  | { t: 'patch:applied'; testId: string; file: string; oldStr: string; newStr: string }
  | {
      t: 'patch:rejected';
      testId: string;
      file: string;
      // Same closed enum as PatchApplier's discriminated result. Keeping
      // it in lock-step (rather than free-form) means the dashboard can
      // switch on `reason` without falling back to a default branch.
      reason: 'oldStr-not-found' | 'oldStr-not-unique' | 'fs-error';
      // Match count for 'oldStr-not-unique'; error message for 'fs-error';
      // undefined for 'oldStr-not-found'.
      detail?: string;
    }
  // Apply-fix loop closure. The dashboard's DiagnosticsPanel posts an
  // inbound `{ kind: 'test:rerun-request', testId }` over /ws/dashboard
  // after Apply Fix lands; the server validates and emits this event
  // onto the bus as the acknowledgement. Broadcasted back to every
  // dashboard client (so the UI can render "rerun queued") and persisted
  // into events.jsonl (so an operator scrubbing the run can audit which
  // re-runs were requested and when).
  //
  // Actually relaunching Playwright with `--grep <testId>` is a separate
  // slice — see the PR body for the runner-orchestration follow-up. A
  // future subscriber on this event spawns the re-run; today the event
  // is purely an acknowledgement.
  | { t: 'test:rerun-requested'; testId: string };

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
  'a11y:violation',
  'diagnosis:start',
  'diagnosis:chunk',
  'diagnosis:end',
  'patch:applied',
  'patch:rejected',
  'test:rerun-requested',
] as const satisfies readonly RunEventType[];

// Compile-time exhaustiveness: this assignment fails if a RunEvent variant
// isn't included in ALL_EVENT_TYPES.
type _AssertExhaustive = Exclude<RunEventType, (typeof ALL_EVENT_TYPES)[number]> extends never
  ? true
  : ['ALL_EVENT_TYPES is missing variants'];
const _exhaustive: _AssertExhaustive = true;
void _exhaustive;

// === Runtime validation (Zod) ===
//
// Loose by default — extra fields are dropped, not rejected. Forward-compat
// for persisted runs that may carry fields added in newer reactlens versions
// (testIdIndex was the first; there will be more). Probe regressions that
// emit garbage extra fields are best caught by integration tests, not by
// strict-schema rejection at runtime.
//
// Recursive types (ComponentNode, AxNode) use z.lazy + explicit ZodType<T>
// annotation to break the circular self-reference.

const attachmentSchema = z.object({
  name: z.string(),
  path: z.string(),
  contentType: z.string().optional(),
});

const hookSnapshotSchema = z.object({
  kind: z.enum(['state', 'effect', 'memo', 'ref', 'context', 'reducer', 'other']),
  value: z.unknown().optional(),
  name: z.string().optional(),
});

const componentNodeSchema: z.ZodType<ComponentNode> = z.lazy(() =>
  z.object({
    id: z.string().optional(),
    name: z.string(),
    key: z.string().nullable().optional(),
    props: z.record(z.string(), z.unknown()),
    hooks: z.array(hookSnapshotSchema).optional(),
    source: z.object({ file: z.string(), line: z.number() }).optional(),
    children: z.array(componentNodeSchema),
  }),
);

const axNodeSchema: z.ZodType<AxNode> = z.lazy(() =>
  z.object({
    role: z.string(),
    name: z.string().optional(),
    value: z.union([z.string(), z.number()]).optional(),
    description: z.string().optional(),
    keyshortcuts: z.string().optional(),
    roledescription: z.string().optional(),
    valuetext: z.string().optional(),
    disabled: z.boolean().optional(),
    expanded: z.boolean().optional(),
    focused: z.boolean().optional(),
    modal: z.boolean().optional(),
    multiline: z.boolean().optional(),
    multiselectable: z.boolean().optional(),
    readonly: z.boolean().optional(),
    required: z.boolean().optional(),
    selected: z.boolean().optional(),
    checked: z.union([z.boolean(), z.literal('mixed')]).optional(),
    pressed: z.union([z.boolean(), z.literal('mixed')]).optional(),
    level: z.number().optional(),
    valuemin: z.number().optional(),
    valuemax: z.number().optional(),
    autocomplete: z.string().optional(),
    haspopup: z.string().optional(),
    invalid: z.string().optional(),
    orientation: z.string().optional(),
    children: z.array(axNodeSchema),
  }),
);

const diagnosisSchema = z.object({
  classification: z.enum(['real-bug', 'test-bug', 'flaky', 'env-issue']),
  confidence: z.enum(['high', 'medium', 'low']),
  rootCause: z.string(),
  evidence: z.array(z.string()),
  suggestedFix: z.string(),
  patch: z
    .array(
      z.object({
        file: z.string(),
        oldStr: z.string(),
        newStr: z.string(),
        rationale: z.string(),
      }),
    )
    .optional(),
  gitContext: z
    .object({
      componentLastChanged: z
        .object({
          sha: z.string(),
          author: z.string(),
          date: z.string(),
          message: z.string(),
        })
        .optional(),
      specLastChanged: z
        .object({
          sha: z.string(),
          author: z.string(),
          date: z.string(),
          message: z.string(),
        })
        .optional(),
    })
    .optional(),
});

export const runEventSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('run:start'),
    runId: z.string(),
    totalTests: z.number(),
    timestamp: z.number(),
    tests: z
      .array(
        z.object({
          id: z.string(),
          title: z.string(),
          file: z.string(),
          suite: z.string(),
        }),
      )
      .optional(),
  }),
  z.object({
    t: z.literal('run:end'),
    passed: z.number(),
    failed: z.number(),
    skipped: z.number(),
    duration: z.number(),
  }),
  z.object({
    t: z.literal('test:start'),
    id: z.string(),
    title: z.string(),
    file: z.string(),
    suite: z.string(),
  }),
  z.object({
    t: z.literal('test:end'),
    id: z.string(),
    status: z.enum(['passed', 'failed', 'skipped', 'timedOut']),
    duration: z.number(),
    error: z.string().optional(),
    attachments: z.array(attachmentSchema).optional(),
  }),
  z.object({
    t: z.literal('step:start'),
    testId: z.string(),
    stepId: z.string(),
    title: z.string(),
  }),
  z.object({
    t: z.literal('step:end'),
    testId: z.string(),
    stepId: z.string(),
    status: z.enum(['passed', 'failed']),
  }),
  z.object({
    t: z.literal('frame'),
    testId: z.string(),
    sessionId: z.string(),
    data: z.string().optional(),
    frameRef: z.string().optional(),
    stepId: z.string().optional(),
    source: z.string().optional(),
    timestamp: z.number().optional(),
  }),
  z.object({
    t: z.literal('component:snapshot'),
    testId: z.string(),
    stepId: z.string(),
    tree: componentNodeSchema,
    testIdIndex: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    t: z.literal('component:event'),
    testId: z.string(),
    stepId: z.string(),
    kind: z.enum(['mount', 'unmount', 'update']),
    componentName: z.string(),
    props: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    t: z.literal('a11y:snapshot'),
    testId: z.string(),
    stepId: z.string(),
    tree: axNodeSchema,
  }),
  z.object({
    t: z.literal('a11y:violation'),
    testId: z.string(),
    stepId: z.string(),
    ruleId: z.string(),
    impact: z.enum(['minor', 'moderate', 'serious', 'critical']).nullable(),
    description: z.string(),
    help: z.string(),
    helpUrl: z.string(),
    targets: z.array(z.string()),
  }),
  z.object({
    t: z.literal('diagnosis:start'),
    testId: z.string(),
  }),
  z.object({
    t: z.literal('diagnosis:chunk'),
    testId: z.string(),
    text: z.string(),
  }),
  z.object({
    t: z.literal('diagnosis:end'),
    testId: z.string(),
    result: diagnosisSchema,
  }),
  z.object({
    t: z.literal('patch:applied'),
    testId: z.string(),
    file: z.string(),
    oldStr: z.string(),
    newStr: z.string(),
  }),
  z.object({
    t: z.literal('patch:rejected'),
    testId: z.string(),
    file: z.string(),
    reason: z.enum(['oldStr-not-found', 'oldStr-not-unique', 'fs-error']),
    detail: z.string().optional(),
  }),
  z.object({
    t: z.literal('test:rerun-requested'),
    testId: z.string(),
  }),
]);

// The single boundary parser. Used by:
//   * playwright-runner.ts to validate stdin events from the Playwright subprocess
//   * dashboard/server.ts to validate WS events from the in-page probe
//   * runs/run-paths.ts, dashboard/web/replay-timeline.ts, commands/diff.ts
//     to validate persisted JSONL when replaying past runs
// Bus subscribers downstream of those points trust the bus by construction.
export function parseRunEvent(value: unknown): RunEvent | null {
  const result = runEventSchema.safeParse(value);
  if (!result.success) return null;
  return result.data;
}

// Compile-time guard: bidirectional check that runEventSchema's inferred
// type and the RunEvent union stay aligned. If a variant is added to one
// but not the other, this assignment fails to compile. Reinforces the
// existing _AssertExhaustive check on ALL_EVENT_TYPES.
type _SchemaMatchesType =
  z.infer<typeof runEventSchema> extends RunEvent
    ? RunEvent extends z.infer<typeof runEventSchema>
      ? true
      : ['runEventSchema is missing variants from RunEvent type']
    : ['RunEvent type is missing variants from runEventSchema'];
const _schemaCheck: _SchemaMatchesType = true;
void _schemaCheck;
