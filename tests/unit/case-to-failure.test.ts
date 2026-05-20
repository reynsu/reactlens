// TDD for `caseToFailure` — the pure transform that turns an EvalCase
// (case directory with component.tsx + spec.ts + truth.json + optional
// error.txt + optional snapshot.json) into a `FailedTest` ready for
// `diagnose()`.
//
// Separated from `eval-case-loader` so loading (recursive discovery,
// curated tagging) and transformation (reading per-case inputs into
// the diagnose shape) compose without entangling. The production
// DiagnoseFn the AblationHarness will use is just:
//   caseToFailure → buildUserMessage → generateVariant → diagnose
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { caseToFailure } from '../../src/eval/case-to-failure';
import type { EvalCase } from '../../src/eval/eval-case-loader';

function makeCase(root: string, name: string, files: Record<string, string>): EvalCase {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  for (const [filename, content] of Object.entries(files)) {
    writeFileSync(join(dir, filename), content);
  }
  return {
    name,
    path: dir,
    truth: { expectedClassification: 'real-bug', minimumConfidence: 'high' },
    curated: true,
  };
}

describe('caseToFailure', () => {
  // Tracer bullet: minimal case with only the required files. Maps the
  // required EvalCase fields to FailedTest, leaves optional fields
  // (errorMessage, componentSnapshot) absent.
  it('maps required case files to a FailedTest with absolute paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'reactlens-case-to-failure-'));
    const c = makeCase(root, 'case-001-stale-selector', {
      'component.tsx': 'export const C = () => null;\n',
      'spec.ts': 'import {test} from "@playwright/test"; test("x", () => {});\n',
      'truth.json': JSON.stringify({ expectedClassification: 'real-bug', minimumConfidence: 'high' }),
    });

    const failure = caseToFailure(c);

    expect(failure.testId).toBe('case-001-stale-selector');
    expect(failure.testTitle).toBe('case-001-stale-selector');
    expect(failure.specFile).toBe(join(c.path, 'spec.ts'));
    expect(failure.componentFile).toBe(join(c.path, 'component.tsx'));
    // Optional inputs absent when their files don't exist — `diagnose`
    // and `buildUserMessage` handle undefined cleanly.
    expect(failure.errorMessage).toBeUndefined();
    expect(failure.componentSnapshot).toBeUndefined();
  });

  // The optional inputs — error.txt and snapshot.json — feed two of the
  // four sections `buildUserMessage` will emit. Without them the agent
  // sees a thinner prompt; with them the prompt mirrors what a real
  // Playwright failure produces. The ablation comparison only means
  // something if the snapshot section actually reaches the prompt for
  // the with-snapshot leg, so this mapping is load-bearing for the
  // moat-contribution measurement.
  it('includes error.txt and snapshot.json when present', () => {
    const root = mkdtempSync(join(tmpdir(), 'reactlens-case-to-failure-'));
    const snapshotTree = {
      name: 'App',
      props: {},
      children: [{ name: 'Checkout', props: { step: 'payment' }, children: [] }],
    };
    const c = makeCase(root, 'case-002-with-extras', {
      'component.tsx': 'export const C = () => null;\n',
      'spec.ts': 'import {test} from "@playwright/test"; test("x", () => {});\n',
      'truth.json': JSON.stringify({ expectedClassification: 'real-bug', minimumConfidence: 'high' }),
      'error.txt': 'Expected button to be visible.\n  At spec.ts:42',
      'snapshot.json': JSON.stringify(snapshotTree),
    });

    const failure = caseToFailure(c);

    expect(failure.errorMessage).toBe('Expected button to be visible.\n  At spec.ts:42');
    expect(failure.componentSnapshot).toEqual(snapshotTree);
  });
});
