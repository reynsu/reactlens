// Reads a sandboxed case directory into a published FailedTest. Peer of
// `sandboxDir` in case-sandbox.ts: sandboxDir produces a tmpdir copy of
// SANDBOX_INPUTS, readSandboxedFailure consumes that tmpdir into the
// failure shape DiagnosisRun's execute core wants.
//
// Lives in src/eval/ (not src/diagnosis-run/) because it works against the
// SANDBOX_INPUTS contract owned by case-sandbox.ts. Before this slice,
// readSandboxedFailure lived in src/diagnosis-run/prepare-eval-case.ts and
// prepare-ablation.ts imported it across that sibling seam — a leak between
// two DiagnosisRun-internal peer modules that the move eliminates.
//
// The §13 Calibration fence is enforced one level up by case-sandbox.ts:
// truth.json is not in SANDBOX_INPUTS, so it is never present in the
// sandbox tmpdir, so readSandboxedFailure has no way to read it even
// accidentally.
//
// Title-anonymization addendum: the eval-case directory naming convention
// (`case-NNN-<descriptive-category>`) was leaking ground-truth category
// to the agent via `testTitle`. buildUserMessage stitches testTitle into
// the prompt as `Test: <title>`, and the diagnosis agent was literally
// quoting the suffix back as evidence ("Test case name
// 'real-bug-nan-fallback-mask' corroborates the NaN fallback..."). The
// 2026-05-24 ablation found this masked the moat measurement: both
// with-/without-snapshot variants converged at 100% accuracy partly
// because the without-snapshot variant was reading the answer out of
// the testTitle directly.
//
// anonymizeTitle strips the descriptive suffix so the agent only sees
// the bare case identifier (e.g. `case-022`). testId keeps the full
// name for tracking + log correlation; only the title surface the prompt
// sees is sanitized.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FailedTest as PublishedFailedTest } from '@reynsu/reactlens-diagnosis-prompts';
import type { ComponentNode } from '../runner/events';

// Matches the leading `case-<digits>` of an eval-case directory name.
// Falls through to the full name for any other shape (ad-hoc names the
// operator might pass).
const CASE_ID_PREFIX = /^(case-\d+)/;

export function anonymizeTitle(name: string): string {
  const match = CASE_ID_PREFIX.exec(name);
  return match !== null && match[1] !== undefined ? match[1] : name;
}

export function readSandboxedFailure(sandboxPath: string, name: string): PublishedFailedTest {
  const specFile = join(sandboxPath, 'spec.ts');
  const componentFile = join(sandboxPath, 'component.tsx');
  const errorFile = join(sandboxPath, 'error.txt');
  const snapshotFile = join(sandboxPath, 'snapshot.json');

  const out: PublishedFailedTest = {
    testId: name,
    testTitle: anonymizeTitle(name),
    specFile,
  };
  if (existsSync(componentFile)) out.componentFile = componentFile;
  if (existsSync(errorFile)) out.errorMessage = readFileSync(errorFile, 'utf8');
  if (existsSync(snapshotFile)) {
    // JSON.parse can throw on malformed input. Propagating is intentional
    // — a corrupt snapshot.json is a curation bug we want loud, not a
    // silently-undefined snapshot that would degrade the ablation
    // comparison without the operator noticing (Principle 2 / ADR-0001).
    out.componentSnapshot = JSON.parse(readFileSync(snapshotFile, 'utf8')) as ComponentNode;
  }
  return out;
}
