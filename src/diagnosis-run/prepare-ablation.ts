// ablation intent — preparation step. Owner of the Variant transform
// (CONTEXT.md): builds the user message, then strips the snapshot
// section for the `without-snapshot` variant so the agent diagnoses
// without the moat signal.
//
// Inherits the §13 Calibration fence from `prepare-eval-case` (same
// sandbox helper). Adds one more step on top: the Variant transform.
// The PreparedDiagnosis returned here carries an explicit `userMessage`
// (the transformed prompt) — the execute core sees it via the
// `prepared.userMessage` channel and skips its default
// `buildUserMessage(failure)` call.
//
// Pre-#46, this pipeline lived in `src/eval/production-diagnose-fn.ts`
// behind the `DiagnoseFn` injection seam on the AblationHarness. That
// seam dies in this slice — the harness now calls DiagnosisRun directly
// with the `ablation` intent.
import { buildUserMessage } from '@reynsu/reactlens-diagnosis-prompts';
import { sandboxDir } from '../eval/case-sandbox';
import {
  generateVariant,
  type AblationVariant,
} from '../eval/ablation-variant-generator';
import type { PrepareResult } from './execute';
import { readSandboxedFailure } from './prepare-eval-case';

export type AblationIntent = {
  kind: 'ablation';
  caseDir: string;
  name: string;
  variant: AblationVariant;
};

export function prepareAblation(intent: AblationIntent): PrepareResult {
  const { dir, cleanup } = sandboxDir(intent.caseDir);
  const failure = readSandboxedFailure(dir, intent.name);
  const base = buildUserMessage(failure);
  // generateVariant throws AblationMarkersMissingError when variant is
  // 'without-snapshot' and the prompt has no `<!-- ablation:snapshot-*
  // -->` markers — i.e. when the failure had no componentSnapshot, so
  // there was nothing to strip. Propagate: silent fallback would emit a
  // delta of zero and the operator wouldn't know the ablation didn't
  // happen (Principle 2 / ADR-0001).
  const userMessage = generateVariant(base, intent.variant);
  return {
    prepared: { cwd: dir, failure, userMessage },
    cleanup,
  };
}
