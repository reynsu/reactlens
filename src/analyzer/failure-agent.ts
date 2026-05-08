// Diagnosis agent: given a failed test, produce a typed Diagnosis. Validates
// the agent's output against a Zod schema; on failure retries once with a
// stricter prompt; on second failure returns a degraded `env-issue` diagnosis
// rather than crashing the run.
import { readFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { z } from 'zod';
import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import { ReactLensError } from '../utils/errors';
import { logger } from '../utils/logger';
import type { ComponentNode, Diagnosis } from '../runner/events';
import { gatherGitContext } from './git-context';

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

async function readPrompt(name: string): Promise<string> {
  const candidates = [
    join(__dirname, 'prompts', name),
    join(__dirname, '..', '..', 'src', 'analyzer', 'prompts', name),
    join(dirname(__filename), 'prompts', name),
  ];
  for (const c of candidates) {
    try {
      return await readFile(c, 'utf8');
    } catch {
      /* try next */
    }
  }
  throw new ReactLensError(`diagnosis prompt ${name} not found`, { code: 'DIAGNOSIS_PROMPT_MISSING' });
}

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

function extractFinalJson(text: string): unknown {
  // Strip optional fenced code block, then parse.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced !== null && fenced[1] !== undefined ? fenced[1] : text;
  try {
    return JSON.parse(candidate.trim());
  } catch {
    // Try to find the last JSON-looking blob in the text.
    const last = candidate.lastIndexOf('{');
    if (last < 0) return null;
    try {
      return JSON.parse(candidate.slice(last).trim());
    } catch {
      return null;
    }
  }
}

async function runOnce(opts: {
  cwd: string;
  systemPrompt: string;
  userMessage: string;
  onChunk?: (chunk: string) => void;
}): Promise<Diagnosis | null> {
  const queryOptions: Options = {
    cwd: resolve(opts.cwd),
    systemPrompt: { type: 'preset', preset: 'claude_code', append: opts.systemPrompt },
    allowedTools: ['Read', 'Glob', 'Grep', 'Bash'],
    permissionMode: 'default',
    maxTurns: 30,
  };

  let lastText = '';
  const stream = query({ prompt: opts.userMessage, options: queryOptions });
  for await (const message of stream) {
    if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (block.type === 'text') {
          lastText = block.text;
          opts.onChunk?.(block.text);
        }
      }
    }
  }

  const parsed = extractFinalJson(lastText);
  if (parsed === null) return null;
  const result = diagnosisSchema.safeParse(parsed);
  if (!result.success) {
    logger.warn({ issues: result.error.issues }, 'diagnosis output failed validation');
    return null;
  }
  return result.data;
}

export async function diagnose(opts: {
  cwd: string;
  failure: FailedTest;
  onChunk?: (text: string) => void;
}): Promise<Diagnosis> {
  const systemPrompt = await readPrompt('diagnose.md');
  const classifyAddendum = await readPrompt('classify-bug.md');
  const baseMessage = buildUserMessage(opts.failure);
  const gitCtx = await gatherGitContext({
    cwd: opts.cwd,
    componentFile: opts.failure.componentFile,
    specFile: opts.failure.specFile,
  });

  // First attempt.
  let result = await runOnce({
    cwd: opts.cwd,
    systemPrompt: `${systemPrompt}\n\n---\n\n${classifyAddendum}`,
    userMessage: baseMessage,
    onChunk: opts.onChunk,
  });

  // Retry once with stricter framing.
  if (result === null) {
    const stricter = `${baseMessage}\n\nIMPORTANT: your previous response did not contain a parseable Diagnosis JSON object. The FINAL message must be exactly the JSON, nothing else.`;
    result = await runOnce({
      cwd: opts.cwd,
      systemPrompt: `${systemPrompt}\n\n---\n\n${classifyAddendum}`,
      userMessage: stricter,
      onChunk: opts.onChunk,
    });
  }

  if (result === null) {
    return {
      classification: 'env-issue',
      confidence: 'low',
      rootCause: 'diagnosis agent failed to produce a valid output',
      evidence: ['agent returned non-JSON or schema-mismatched output twice'],
      suggestedFix: 'rerun the diagnosis with --verbose; if it persists, file an issue with the trace',
      ...(Object.keys(gitCtx).length > 0 ? { gitContext: gitCtx } : {}),
    };
  }

  return {
    ...result,
    ...(Object.keys(gitCtx).length > 0 ? { gitContext: gitCtx } : {}),
  };
}
