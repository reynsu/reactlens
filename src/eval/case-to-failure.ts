// Pure transform: EvalCase → FailedTest (the input shape diagnose()
// expects). Separated from `eval-case-loader.ts` so case discovery
// (curated/uncurated walk) and per-case input mapping stay composable.
//
// The production DiagnoseFn for the AblationHarness is just:
//   caseToFailure → buildUserMessage → generateVariant → diagnose
//
// This file is intentionally minimal — only the required-file mapping
// (component.tsx + spec.ts paths) is implemented. Reading optional
// `error.txt` and `snapshot.json` lands in subsequent TDD cycles once
// a behavior test forces them.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FailedTest } from '../analyzer/failure-agent';
import type { ComponentNode } from '../runner/events';
import type { EvalCase } from './eval-case-loader';

export function caseToFailure(c: EvalCase): FailedTest {
  const specFile = join(c.path, 'spec.ts');
  const componentFile = join(c.path, 'component.tsx');
  const errorFile = join(c.path, 'error.txt');
  const snapshotFile = join(c.path, 'snapshot.json');

  const out: FailedTest = {
    testId: c.name,
    testTitle: c.name,
    specFile,
  };
  if (existsSync(componentFile)) out.componentFile = componentFile;
  if (existsSync(errorFile)) out.errorMessage = readFileSync(errorFile, 'utf8');
  if (existsSync(snapshotFile)) {
    // JSON.parse can throw on malformed input. Letting it propagate is
    // intentional — a corrupt snapshot.json is a curation bug we want
    // loud, not a silently-undefined snapshot that would degrade the
    // ablation comparison without the operator noticing.
    out.componentSnapshot = JSON.parse(readFileSync(snapshotFile, 'utf8')) as ComponentNode;
  }
  return out;
}
