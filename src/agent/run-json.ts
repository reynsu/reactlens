// Streams a single agent call whose final assistant message is expected to be
// a JSON object matching a Zod schema. On parse / validation failure the call
// is retried ONCE with a stricter reminder appended to the user message; if
// the second attempt also fails the function returns null so the caller can
// build its own degraded shape (each domain has its own — there is no single
// "degraded JSON" we could ship from here).
//
// This deepens the seam that diagnose() and (in the future) Auto-PR planning
// share: prompt loading + streaming + JSON extraction + Zod validation +
// retry policy live in one module, so the next caller adds ~10 lines instead
// of ~80, and the "what happens when the agent emits malformed JSON" matrix
// is testable against a FakeAgentRunner without standing up failure-agent.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { z } from 'zod';
import { ReactLensError } from '../utils/errors';
import { logger } from '../utils/logger';
import type { AgentRunner } from './runner';

const PROMPT_SEPARATOR = '\n\n---\n\n';
const DEFAULT_RETRY_REMINDER =
  'your previous response did not contain a JSON object matching the requested schema. The FINAL message must be exactly the JSON, nothing else.';
const DEFAULT_ALLOWED_TOOLS = ['Read', 'Glob', 'Grep'];
const DEFAULT_PERMISSION_MODE: 'default' | 'acceptEdits' = 'default';
const DEFAULT_MAX_TURNS = 30;

export type PromptSource =
  | { name: string; area: string }
  | { text: string };

export type RunAgentJsonOpts<T> = {
  agent: AgentRunner;
  cwd: string;
  // Single source, or an ordered array concatenated with PROMPT_SEPARATOR.
  // The array form replaces the "load diagnose.md and classify-bug.md, then
  // join them with `\n\n---\n\n`" idiom that lived in failure-agent.
  systemPrompt: PromptSource | PromptSource[];
  // Always caller-built. Each domain has its own shape (failure context vs
  // PR plan vs ...) so there is no useful template to ship from here.
  userMessage: string;
  schema: z.ZodSchema<T>;
  allowedTools?: string[];
  permissionMode?: 'default' | 'acceptEdits';
  maxTurns?: number;
  // Appended to userMessage on the second attempt as
  // `\n\nIMPORTANT: ${retryReminder}`. Default is generic; callers that want
  // domain-specific wording ("...a Diagnosis JSON object") pass their own.
  retryReminder?: string;
  onChunk?: (text: string) => void;
};

// Resolves a prompt file across the dual layout this project ships with:
//
//   - Bundled CLI (`dist/cli.js`): __dirname = <pkg>/dist. Prompts live at
//     <pkg>/src/<area>/prompts/<name> because `files` in package.json
//     ships `src/generator/prompts`. Candidate: __dirname/../src/<area>/...
//   - Dev (tsx running `src/agent/run-json.ts` directly): __dirname =
//     <pkg>/src/agent. Prompts at <pkg>/src/<area>/prompts/<name>.
//     Candidate: __dirname/../<area>/...
//   - (Optional future) tsup-copies-prompts-into-dist: candidate
//     __dirname/<area>/... covers that without changing call sites.
//
// Order matters: try the bundled-CLI path first because that's the
// production path on every installed user. Dev fallback after.
export async function loadPromptSource(src: PromptSource): Promise<string> {
  if ('text' in src) return src.text;
  const candidates = [
    // Bundled CLI: dist/cli.js → ../src/<area>/prompts/<name>
    join(__dirname, '..', 'src', src.area, 'prompts', src.name),
    // Dev (tsx): src/agent/run-json.ts → ../<area>/prompts/<name>
    join(__dirname, '..', src.area, 'prompts', src.name),
    // tsup-copies-prompts-into-dist: dist/<area>/prompts/<name>
    join(__dirname, src.area, 'prompts', src.name),
    // Same as candidate 2 via dirname(__filename) — guards against ESM-shim
    // edge cases where __dirname is the bundle dir but __filename normalizes
    // differently. Kept for parity with prior versions.
    join(dirname(__filename), '..', src.area, 'prompts', src.name),
  ];
  for (const c of candidates) {
    try {
      return await readFile(c, 'utf8');
    } catch {
      /* try next */
    }
  }
  throw new ReactLensError(`prompt not found: area=${src.area} name=${src.name}`, {
    code: 'PROMPT_MISSING',
  });
}

async function buildSystemPrompt(src: PromptSource | PromptSource[]): Promise<string> {
  const parts = Array.isArray(src) ? src : [src];
  const loaded = await Promise.all(parts.map(loadPromptSource));
  return loaded.join(PROMPT_SEPARATOR);
}

// Exported for direct unit testing — extraction has the most surface area
// for agent variability (fenced vs bare vs preamble + JSON).
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

async function attempt<T>(opts: {
  agent: AgentRunner;
  cwd: string;
  systemPrompt: string;
  userMessage: string;
  schema: z.ZodSchema<T>;
  allowedTools: string[];
  permissionMode: 'default' | 'acceptEdits';
  maxTurns: number;
  onChunk?: (text: string) => void;
}): Promise<T | null> {
  let lastText = '';
  const stream = opts.agent.query({
    cwd: opts.cwd,
    prompt: opts.userMessage,
    systemPromptAppend: opts.systemPrompt,
    allowedTools: opts.allowedTools,
    permissionMode: opts.permissionMode,
    maxTurns: opts.maxTurns,
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
  const result = opts.schema.safeParse(parsed);
  if (!result.success) {
    logger.warn({ issues: result.error.issues }, 'agent JSON output failed schema validation');
    return null;
  }
  return result.data;
}

export async function runAgentJson<T>(opts: RunAgentJsonOpts<T>): Promise<T | null> {
  const systemPrompt = await buildSystemPrompt(opts.systemPrompt);
  const allowedTools = opts.allowedTools ?? DEFAULT_ALLOWED_TOOLS;
  const permissionMode = opts.permissionMode ?? DEFAULT_PERMISSION_MODE;
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
  const retryReminder = opts.retryReminder ?? DEFAULT_RETRY_REMINDER;

  const first = await attempt({
    agent: opts.agent,
    cwd: opts.cwd,
    systemPrompt,
    userMessage: opts.userMessage,
    schema: opts.schema,
    allowedTools,
    permissionMode,
    maxTurns,
    onChunk: opts.onChunk,
  });
  if (first !== null) return first;

  const stricter = `${opts.userMessage}\n\nIMPORTANT: ${retryReminder}`;
  return attempt({
    agent: opts.agent,
    cwd: opts.cwd,
    systemPrompt,
    userMessage: stricter,
    schema: opts.schema,
    allowedTools,
    permissionMode,
    maxTurns,
    onChunk: opts.onChunk,
  });
}
