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
