// Diagnosis agent: given a failed test, build a structured Diagnosis. The
// streaming + JSON extraction + Zod retry plumbing lives in
// src/agent/run-json.ts; this module owns the diagnosis-specific bits —
// the user-message shape, the schema, the degraded fallback, and the
// gitContext attachment.
import { z } from 'zod';
import { runAgentJson } from '../agent/run-json';
import type { AgentRunner } from '../agent/runner';
import type { ComponentNode, Diagnosis } from '../runner/events';
import { gatherGitContext, type GitContext } from './git-context';

export type FailedTest = {
  testId: string;
  testTitle: string;
  specFile: string;
  errorMessage?: string;
  // Path to the component file the failing test exercises, when known. The
  // run command derives this from the snapshot's source map when possible.
  componentFile?: string;
  // The component tree captured at the moment of failure (last snapshot for
  // the test before test:end fired). Optional — diagnosis still runs without
  // it but loses its biggest unique signal.
  componentSnapshot?: ComponentNode;
};

const diagnosisSchema = z.object({
  classification: z.enum(['real-bug', 'test-bug', 'flaky', 'env-issue']),
  confidence: z.enum(['high', 'medium', 'low']),
  rootCause: z.string().min(1),
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
});

function buildUserMessage(failure: FailedTest): string {
  const lines: string[] = [];
  lines.push(`# Failure to diagnose`);
  lines.push(``);
  lines.push(`Test: ${failure.testTitle}`);
  lines.push(`Spec: ${failure.specFile}`);
  if (failure.componentFile !== undefined) lines.push(`Component (probable): ${failure.componentFile}`);
  if (failure.errorMessage !== undefined) {
    lines.push(``);
    lines.push(`# Error`);
    lines.push('```');
    lines.push(failure.errorMessage);
    lines.push('```');
  }
  if (failure.componentSnapshot !== undefined) {
    lines.push(``);
    lines.push(`# Component snapshot at failure`);
    lines.push('```json');
    // Truncate enormous trees to keep token usage sane.
    const snippet = JSON.stringify(failure.componentSnapshot, null, 2);
    lines.push(snippet.length > 30_000 ? snippet.slice(0, 30_000) + '\n…(truncated)' : snippet);
    lines.push('```');
  }
  lines.push(``);
  lines.push(`Read the spec, the component, and any other context you need. Output a single JSON object matching the Diagnosis schema as the FINAL message.`);
  return lines.join('\n');
}

function degradedDiagnosis(gitCtx: GitContext): Diagnosis {
  return {
    classification: 'env-issue',
    confidence: 'low',
    rootCause: 'diagnosis agent failed to produce a valid output',
    evidence: ['agent returned non-JSON or schema-mismatched output twice'],
    suggestedFix: 'rerun the diagnosis with --verbose; if it persists, file an issue with the trace',
    ...(Object.keys(gitCtx).length > 0 ? { gitContext: gitCtx } : {}),
  };
}

export async function diagnose(opts: {
  cwd: string;
  agent: AgentRunner;
  failure: FailedTest;
  onChunk?: (text: string) => void;
}): Promise<Diagnosis> {
  const userMessage = buildUserMessage(opts.failure);
  const gitCtx = await gatherGitContext({
    cwd: opts.cwd,
    componentFile: opts.failure.componentFile,
    specFile: opts.failure.specFile,
  });

  const result = await runAgentJson({
    agent: opts.agent,
    cwd: opts.cwd,
    systemPrompt: [
      { name: 'diagnose.md', area: 'analyzer' },
      { name: 'classify-bug.md', area: 'analyzer' },
    ],
    userMessage,
    schema: diagnosisSchema,
    allowedTools: ['Read', 'Glob', 'Grep', 'Bash'],
    permissionMode: 'default',
    maxTurns: 30,
    retryReminder:
      'your previous response did not contain a parseable Diagnosis JSON object. The FINAL message must be exactly the JSON, nothing else.',
    onChunk: opts.onChunk,
  });

  if (result === null) return degradedDiagnosis(gitCtx);
  return Object.keys(gitCtx).length > 0
    ? { ...result, gitContext: gitCtx }
    : result;
}
