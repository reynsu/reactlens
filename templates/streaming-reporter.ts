// Streaming Playwright reporter — Phase 1 stub.
// Phase 2.1 will implement the full Reporter interface and emit RunEvents on
// stdout per CLAUDE.md Section 9. For now we just emit run-lifecycle markers
// so `reactlens run` can verify the channel is wired.
import type {
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';

type RunEvent =
  | { t: 'run:start'; totalTests: number; timestamp: number }
  | {
      t: 'test:end';
      id: string;
      status: 'passed' | 'failed' | 'skipped' | 'timedOut';
      duration: number;
      error?: string;
    }
  | {
      t: 'run:end';
      passed: number;
      failed: number;
      skipped: number;
      duration: number;
    };

function emit(event: RunEvent): void {
  process.stdout.write(JSON.stringify(event) + '\n');
}

class ReactLensStreamingReporter implements Reporter {
  private startedAt = 0;
  private passed = 0;
  private failed = 0;
  private skipped = 0;

  onBegin(_config: unknown, suite: Suite): void {
    this.startedAt = Date.now();
    emit({ t: 'run:start', totalTests: suite.allTests().length, timestamp: this.startedAt });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const status = result.status;
    if (status === 'passed') this.passed += 1;
    else if (status === 'skipped') this.skipped += 1;
    else this.failed += 1;
    emit({
      t: 'test:end',
      id: test.id,
      status: status === 'interrupted' ? 'failed' : status,
      duration: result.duration,
      ...(result.error?.message !== undefined ? { error: result.error.message } : {}),
    });
  }

  onEnd(): void {
    emit({
      t: 'run:end',
      passed: this.passed,
      failed: this.failed,
      skipped: this.skipped,
      duration: Date.now() - this.startedAt,
    });
  }
}

export default ReactLensStreamingReporter;
