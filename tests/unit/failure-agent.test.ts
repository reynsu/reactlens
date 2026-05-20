// TDD for `diagnose()`'s userMessage override path — the seam the
// AblationHarness's productionDiagnoseFn will use to swap in a variant-
// transformed prompt without rebuilding the failure pipeline.
//
// The default path (no override → buildUserMessage(failure)) is
// exercised by the live eval at tests/diagnostic-eval/eval-runner.test.ts
// against the full case set. This file pins the override behavior in
// isolation so a refactor of `diagnose()` can't silently break it.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diagnose } from '../../src/analyzer/failure-agent';
import { FakeAgentRunner } from '../helpers/fake-agent';

const VALID_DIAGNOSIS_JSON = JSON.stringify({
  classification: 'real-bug',
  confidence: 'high',
  rootCause: 'x',
  evidence: ['e'],
  suggestedFix: 'f',
});

describe('diagnose', () => {
  // The harness needs to pass the variant-transformed prompt (snapshot
  // included or stripped) through to the agent. Without an override
  // seam, the only way to do that would be to re-implement diagnose()'s
  // git-context + runAgentJson plumbing — which the handoff explicitly
  // identifies as the wrong factoring.
  it('uses the explicit userMessage override when provided', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'reactlens-diagnose-'));
    const agent = new FakeAgentRunner(VALID_DIAGNOSIS_JSON);
    const overridePrompt = 'OVERRIDE_MARKER_unique_xyz';

    await diagnose({
      cwd,
      agent,
      failure: { testId: 't1', testTitle: 'a test', specFile: join(cwd, 'spec.ts') },
      userMessage: overridePrompt,
    });

    // The first (and only) agent call received the override verbatim,
    // not the result of buildUserMessage(failure).
    expect(agent.calls[0]?.prompt).toBe(overridePrompt);
  });
});
