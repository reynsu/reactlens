// Diagnosis agent: given a failed test, build a structured Diagnosis. The
// streaming + JSON extraction + Zod retry plumbing lives in
// src/agent/run-json.ts; this module owns the orchestration (prompts, schema,
// agent invocation, git-context attachment).
//
// Prompts + Diagnosis schema + pure helpers live in
// @reynsu/reactlens-diagnosis-prompts. This file imports them and stays
// focused on the agent-runner glue.
import {
  buildUserMessage,
  degradedDiagnosis,
  DiagnosisSchema,
  DIAGNOSE_SYSTEM_PROMPT,
  CLASSIFY_BUG_RUBRIC,
  type Diagnosis,
  type FailedTest as FailedTestBase,
} from '@reynsu/reactlens-diagnosis-prompts';
import { runAgentJson } from '../agent/run-json';
import type { AgentRunner } from '../agent/runner';
import type { ComponentNode } from '../runner/events';
import { gatherGitContext, type GitContext } from './git-context';

// Re-export with the reactlens-specific snapshot shape narrowed back from
// `unknown` to ComponentNode. Internal callers pass a typed tree, so we
// preserve type safety on the reactlens side without forcing the published
// package to know about ComponentNode.
export type FailedTest = Omit<FailedTestBase, 'componentSnapshot'> & {
  componentSnapshot?: ComponentNode;
};

export async function diagnose(opts: {
  cwd: string;
  agent: AgentRunner;
  failure: FailedTest;
  onChunk?: (text: string) => void;
  // Optional pre-built user message. When present, replaces the
  // default `buildUserMessage(failure)`. The AblationHarness's
  // productionDiagnoseFn uses this seam to substitute the variant-
  // transformed prompt (snapshot-stripped or not) without
  // re-implementing the git-context + runAgentJson plumbing.
  // Absent in every non-ablation call path → behavior unchanged.
  userMessage?: string;
}): Promise<Diagnosis> {
  const userMessage = opts.userMessage ?? buildUserMessage(opts.failure);
  const gitCtx = await gatherGitContext({
    cwd: opts.cwd,
    componentFile: opts.failure.componentFile,
    specFile: opts.failure.specFile,
  });

  const result = await runAgentJson({
    agent: opts.agent,
    cwd: opts.cwd,
    systemPrompt: [
      { text: DIAGNOSE_SYSTEM_PROMPT },
      { text: CLASSIFY_BUG_RUBRIC },
    ],
    userMessage,
    schema: DiagnosisSchema,
    allowedTools: ['Read', 'Glob', 'Grep', 'Bash'],
    permissionMode: 'default',
    maxTurns: 30,
    retryReminder:
      'your previous response did not contain a parseable Diagnosis JSON object. The FINAL message must be exactly the JSON, nothing else.',
    onChunk: opts.onChunk,
  });

  if (result === null) return degradedDiagnosis(asPublishedGitContext(gitCtx));
  return Object.keys(gitCtx).length > 0
    ? { ...result, gitContext: asPublishedGitContext(gitCtx) }
    : result;
}

// Local GitContext and the published GitContext are shape-identical (same
// keys, same property shapes). The cast is a no-op at runtime — it's only
// here so the two nominally-distinct types compose without forcing a wider
// refactor of git-context.ts.
function asPublishedGitContext(g: GitContext): NonNullable<Diagnosis['gitContext']> {
  return g as NonNullable<Diagnosis['gitContext']>;
}
