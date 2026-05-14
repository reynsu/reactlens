// Playwright Reporter that emits RunEvents (CLAUDE.md Section 9) as JSONL on
// stdout. ALL non-event output is suppressed — stdout is the event channel.
// Anything diagnostic that would normally be printed goes to stderr instead.
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
  TestStep,
} from '@playwright/test/reporter';

type Attachment = { name: string; path: string; contentType?: string };

// Local copy of the RunEvent variants this reporter emits. Kept in sync with
// src/runner/events.ts; duplicated here so the template stays self-contained
// when copied into a user's project.
type RunEvent =
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
  | { t: 'step:end'; testId: string; stepId: string; status: 'passed' | 'failed' };

function emit(event: RunEvent): void {
  process.stdout.write(JSON.stringify(event) + '\n');
}

function suiteFor(test: TestCase): string {
  // Return the closest meaningful suite title — the describe() block when
  // present, otherwise the spec file's basename. Skip the project suite
  // (eg. "chromium") which Playwright inserts between the file and the test.
  for (let node: Suite | undefined = test.parent; node !== undefined; node = node.parent) {
    if (node.title === '') continue;
    if (node.project?.()?.name === node.title) continue;
    return node.title;
  }
  const file = test.location.file;
  const slash = file.lastIndexOf('/');
  return slash >= 0 ? file.slice(slash + 1) : file;
}

function stepKey(test: TestCase, step: TestStep): string {
  // Playwright doesn't give steps stable IDs; we synthesize one from the test
  // id + the step's start time + title, which is stable within a single run.
  return `${test.id}:${step.startTime.getTime()}:${step.title}`;
}

// Playwright assigns each step one of: 'test.step' (user-written `test.step()`
// blocks), 'pw:api' (locator/page method calls — clicks, fills, waits),
// 'expect' (assertions), 'hook' (beforeEach/afterEach lifecycle), 'fixture'
// (worker/test fixture setup), 'attach' (artifact attachments).
//
// The first three are what shows up in the trace viewer as "user steps" —
// the ones a developer reading the trace cares about. Emitting events for
// hook/fixture/attach steps would flood the dashboard with internal plumbing
// activity. We allow `test.step` even though our fixtures don't use it today,
// because users will.
function isUserFacingStep(category: string): boolean {
  return category === 'test.step' || category === 'pw:api' || category === 'expect';
}

class ReactLensStreamingReporter implements Reporter {
  private startedAt = 0;
  private passed = 0;
  private failed = 0;
  private skipped = 0;

  printsToStdio(): boolean {
    // Tell Playwright we own stdout — it suppresses its own progress output.
    return true;
  }

  onBegin(_config: FullConfig, suite: Suite): void {
    this.startedAt = Date.now();
    // runId is injected by `reactlens run` via REACTLENS_RUN_ID. When the user
    // invokes `playwright test` directly (no reactlens wrapper), we synthesize
    // a fallback so downstream consumers can still depend on the field's
    // presence — but the value is marked "standalone" so persistence layers
    // can choose to skip it.
    const runId = process.env['REACTLENS_RUN_ID'] ?? `standalone-${this.startedAt}`;
    emit({ t: 'run:start', runId, totalTests: suite.allTests().length, timestamp: this.startedAt });
  }

  onTestBegin(test: TestCase): void {
    emit({
      t: 'test:start',
      id: test.id,
      title: test.title,
      file: test.location.file,
      suite: suiteFor(test),
    });
  }

  onStepBegin(test: TestCase, _result: TestResult, step: TestStep): void {
    // Emit for user-facing step categories — the same set that shows up in
    // Playwright's HTML trace viewer. Skip `hook`/`fixture`/`attach` which are
    // internal noise. The dashboard server uses these step:start events to
    // tag probe-side component:snapshot events with the active stepId.
    if (!isUserFacingStep(step.category)) return;
    emit({ t: 'step:start', testId: test.id, stepId: stepKey(test, step), title: step.title });
  }

  onStepEnd(test: TestCase, _result: TestResult, step: TestStep): void {
    if (!isUserFacingStep(step.category)) return;
    emit({
      t: 'step:end',
      testId: test.id,
      stepId: stepKey(test, step),
      status: step.error === undefined ? 'passed' : 'failed',
    });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const status = result.status;
    if (status === 'passed') this.passed += 1;
    else if (status === 'skipped') this.skipped += 1;
    else this.failed += 1;

    const attachments: Attachment[] = result.attachments
      .filter((a): a is { name: string; path: string; contentType: string } => typeof a.path === 'string')
      .map((a) => ({ name: a.name, path: a.path, contentType: a.contentType }));

    emit({
      t: 'test:end',
      id: test.id,
      status: status === 'interrupted' ? 'failed' : status,
      duration: result.duration,
      ...(result.error?.message !== undefined ? { error: result.error.message } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
    });
  }

  onEnd(_result: FullResult): void {
    emit({
      t: 'run:end',
      passed: this.passed,
      failed: this.failed,
      skipped: this.skipped,
      duration: Date.now() - this.startedAt,
    });
  }

  onError(error: { message?: string }): void {
    process.stderr.write(`[reactlens-reporter] error: ${error.message ?? String(error)}\n`);
  }
}

export default ReactLensStreamingReporter;
