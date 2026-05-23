// Generator agent invocation. Wraps the Anthropic Agent SDK's `query()` to
// produce Playwright tests for a single component. The KEY architectural
// commitment: the agent does NOT discover visual states from the DOM — we
// hand it the AST-derived list up front. That's the difference between
// guessing and knowing (capability 4.2 in CLAUDE.md).
import { loadPromptSource } from '../agent/prompt-loader';
import { logger } from '../utils/logger';
import type { AgentRunner } from '../agent/runner';
import type { ComponentAnalysis } from '../ast/component-analyzer';
import { statesToTestCases, type TestCase } from './state-machine';
import { resolveGenerationPrompt, type OutputFormat, type PromptName } from './prompt-resolver';
import type { ReactLensConfig } from '../config/schema';

export type GenerateOptions = {
  cwd: string;
  componentPath: string;
  analysis: ComponentAnalysis;
  outputs: { pages: string; specs: string };
  mswHandlers: string;
  agent: AgentRunner;
  onProgress?: (event: GenerateProgress) => void;
  // v0.3 slice 6 phase 2: when provided, the delegate calls
  // resolveGenerationPrompt(config) and branches the system prompt
  // accordingly. Backwards-compatible: callers that don't pass it default
  // to POM, matching pre-phase-2 behavior.
  config?: Pick<ReactLensConfig, 'pattern' | 'output'>;
};

export type GenerateProgress =
  | { kind: 'thinking'; text: string }
  | { kind: 'wrote'; file: string }
  | { kind: 'tool'; name: string; input?: unknown };

export type GenerateResult = {
  componentName: string;
  filesWritten: string[];
  testCases: TestCase[];
};

function buildUserMessage(
  opts: GenerateOptions,
  testCases: TestCase[],
  outputFormat: OutputFormat,
): string {
  const lines: string[] = [];
  lines.push(`# Component to test`);
  lines.push(``);
  lines.push(`Source file: ${opts.componentPath}`);
  lines.push(`Component name: ${opts.analysis.componentName}`);
  lines.push(``);
  lines.push(`# VisualStates (AST-derived — do not invent extras)`);
  for (const tc of testCases) {
    lines.push(``);
    lines.push(`## ${tc.state.name}`);
    lines.push(`- description: ${tc.state.description}`);
    lines.push(`- conditions: ${tc.state.conditions.join(' OR ') || '(default render)'}`);
    if (tc.mswHandlers.length > 0) {
      lines.push(`- API handlers needed:`);
      for (const h of tc.mswHandlers) lines.push(`  - ${h}`);
    }
    if (tc.actions.length > 0) {
      lines.push(`- suggested actions: ${tc.actions.join('; ')}`);
    }
    if (tc.assertions.length > 0) {
      lines.push(`- expected assertions: ${tc.assertions.join('; ')}`);
    }
  }
  lines.push(``);
  lines.push(`# Output`);
  lines.push(``);
  if (outputFormat.kind === 'pom') {
    lines.push(`- pages directory: ${outputFormat.pagesDir}`);
    lines.push(`- specs directory: ${outputFormat.specsDir}`);
    lines.push(`- shared MSW handlers file: ${opts.mswHandlers}`);
    lines.push(``);
    lines.push(`Generate the POM and spec following the system prompt's rules.`);
  } else {
    lines.push(`- specs directory: ${outputFormat.specsDir}`);
    lines.push(`- shared MSW handlers file: ${opts.mswHandlers}`);
    lines.push(``);
    lines.push(
      `Generate a single self-contained Component-Object spec following the system prompt's rules. Do NOT emit a Page Object class.`,
    );
  }
  return lines.join('\n');
}

export async function generateTests(opts: GenerateOptions): Promise<GenerateResult> {
  // Phase-2 fallback: pre-phase-2 callers without a `config` field default to
  // POM (matching the only prompt that existed before this slice).
  const effectiveConfig: Pick<ReactLensConfig, 'pattern' | 'output'> = opts.config ?? {
    pattern: 'pom',
    output: opts.outputs,
  };
  const resolved = resolveGenerationPrompt({
    analysis: opts.analysis,
    config: {
      // resolveGenerationPrompt only reads pattern + output; the other fields
      // don't affect the decision so we synthesize a minimal config object.
      ...effectiveConfig,
      componentGlobs: [],
      msw: { handlers: opts.mswHandlers },
      dashboard: { port: 7777, open: true },
    } as ReactLensConfig,
  });
  const promptName: PromptName = resolved.promptName;
  const systemPrompt = await loadPromptSource({ name: promptName, area: 'generator' });
  const testCases = statesToTestCases(opts.analysis);
  const userMessage = buildUserMessage(opts, testCases, resolved.outputFormat);
  const filesWritten: string[] = [];

  const stream = opts.agent.query({
    cwd: opts.cwd,
    prompt: userMessage,
    systemPromptAppend: systemPrompt,
    allowedTools: ['Read', 'Write', 'Glob', 'Grep'],
    permissionMode: 'acceptEdits',
    maxTurns: 100,
  });

  for await (const message of stream) {
    if (message.type === 'assistant') {
      const content = message.message.content;
      for (const block of content) {
        if (block.type === 'text') {
          opts.onProgress?.({ kind: 'thinking', text: block.text });
        }
        if (block.type === 'tool_use') {
          opts.onProgress?.({ kind: 'tool', name: block.name, input: block.input });
          if (block.name === 'Write') {
            const input = block.input as { file_path?: string };
            if (typeof input.file_path === 'string') {
              filesWritten.push(input.file_path);
              opts.onProgress?.({ kind: 'wrote', file: input.file_path });
            }
          }
        }
      }
    }
    if (message.type === 'result' && message.subtype === 'error_max_turns') {
      logger.warn('generator hit max turns; output may be incomplete');
    }
  }

  return {
    componentName: opts.analysis.componentName,
    filesWritten,
    testCases,
  };
}
