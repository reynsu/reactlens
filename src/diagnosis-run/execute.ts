// The DiagnosisRun execute core — shared across all DiagnosisIntent kinds.
//
// Pipeline: gather git context → stream agent call → extract JSON → Zod
// validate → retry once with stricter reminder if needed. Single source of
// "how a Diagnosis gets produced from a PreparedDiagnosis", so future
// changes (better JSON extraction, smarter retry, observability) land once.
//
// The folded contents of `src/agent/run-json.ts::runAgentJson` + `attempt`
// + `extractFinalJson` + the body of `src/analyzer/failure-agent.ts::diagnose`.
// The originals stay alive until #47 deletes them — the other three callers
// (`run`, `runEvalCase`, `AblationHarness`) keep using them until their own
// migration slices land.
//
// Why not reuse run-json.ts directly:
//   - run-json's `loadPromptSource` indirection isn't needed here; the
//     diagnosis system prompt + classify-bug rubric ship as plain text
//     from `@reynsu/reactlens-diagnosis-prompts`.
//   - LANGUAGE.md: "one adapter = hypothetical seam". run-json's only
//     production caller was `diagnose`; folding closes a seam that never
//     earned its keep.
import {
  CLASSIFY_BUG_RUBRIC,
  DIAGNOSE_SYSTEM_PROMPT,
  DiagnosisSchema,
  buildUserMessage,
  degradedDiagnosis,
  type Diagnosis,
  type FailedTest as PublishedFailedTest,
} from '@reynsu/reactlens-diagnosis-prompts';
import type { AgentRunner } from '../agent/runner';
import { gatherGitContext, type GitContext } from '../analyzer/git-context';
import { logger } from '../utils/logger';

const PROMPT_SEPARATOR = '\n\n---\n\n';
const SYSTEM_PROMPT_APPEND = [DIAGNOSE_SYSTEM_PROMPT, CLASSIFY_BUG_RUBRIC].join(PROMPT_SEPARATOR);
const ALLOWED_TOOLS = ['Read', 'Glob', 'Grep', 'Bash'];
const PERMISSION_MODE: 'default' = 'default';
const MAX_TURNS = 30;
const RETRY_REMINDER =
  'your previous response did not contain a parseable Diagnosis JSON object. The FINAL message must be exactly the JSON, nothing else.';

// The internal handoff between prepare-* and execute. NOT exported at the
// Module's external Interface — callers reach DiagnosisRun via the
// `DiagnosisIntent` shape and never see this struct.
export type PreparedDiagnosis = {
  cwd: string;
  failure: PublishedFailedTest;
  // Pre-built user message — populated by `prepare-ablation` after the
  // Variant transform. Absent for other intents, which fall back to
  // `buildUserMessage(failure)` here.
  userMessage?: string;
};

export type ExecuteDiagnosisOptions = {
  agent: AgentRunner;
  prepared: PreparedDiagnosis;
  onChunk?: (text: string) => void;
};

export async function executeDiagnosis(opts: ExecuteDiagnosisOptions): Promise<Diagnosis> {
  const { agent, prepared, onChunk } = opts;
  const userMessage = prepared.userMessage ?? buildUserMessage(prepared.failure);
  const gitCtx = await gatherGitContext({
    cwd: prepared.cwd,
    componentFile: prepared.failure.componentFile,
    specFile: prepared.failure.specFile,
  });

  const result = await runWithRetry({ agent, cwd: prepared.cwd, userMessage, onChunk });
  if (result === null) return degradedDiagnosis(asPublishedGitContext(gitCtx));
  return Object.keys(gitCtx).length > 0
    ? { ...result, gitContext: asPublishedGitContext(gitCtx) }
    : result;
}

async function runWithRetry(opts: {
  agent: AgentRunner;
  cwd: string;
  userMessage: string;
  onChunk?: (text: string) => void;
}): Promise<Diagnosis | null> {
  const first = await attempt(opts);
  if (first !== null) return first;
  const stricter = `${opts.userMessage}\n\nIMPORTANT: ${RETRY_REMINDER}`;
  return attempt({ ...opts, userMessage: stricter });
}

async function attempt(opts: {
  agent: AgentRunner;
  cwd: string;
  userMessage: string;
  onChunk?: (text: string) => void;
}): Promise<Diagnosis | null> {
  let lastText = '';
  const stream = opts.agent.query({
    cwd: opts.cwd,
    prompt: opts.userMessage,
    systemPromptAppend: SYSTEM_PROMPT_APPEND,
    allowedTools: ALLOWED_TOOLS,
    permissionMode: PERMISSION_MODE,
    maxTurns: MAX_TURNS,
  });
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
  const result = DiagnosisSchema.safeParse(parsed);
  if (!result.success) {
    logger.warn({ issues: result.error.issues }, 'agent JSON output failed schema validation');
    return null;
  }
  return result.data;
}

// Exported for direct unit testing — JSON extraction has the most surface
// area for agent output variability (fenced vs bare vs preamble + JSON).
// Kept as a module-internal seam: only `attempt` above and the test file
// reach in, both of which live alongside the execute core.
export function extractFinalJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced !== null && fenced[1] !== undefined ? fenced[1] : text;
  try {
    return JSON.parse(candidate.trim());
  } catch {
    const last = candidate.lastIndexOf('{');
    if (last < 0) return null;
    try {
      return JSON.parse(candidate.slice(last).trim());
    } catch {
      return null;
    }
  }
}

// Local GitContext and the published GitContext are shape-identical; the
// cast is a no-op at runtime — it composes the two nominally-distinct
// types without forcing a wider refactor of git-context.ts (which still
// has the legacy `diagnose()` caller until #47).
function asPublishedGitContext(g: GitContext): NonNullable<Diagnosis['gitContext']> {
  return g as NonNullable<Diagnosis['gitContext']>;
}
