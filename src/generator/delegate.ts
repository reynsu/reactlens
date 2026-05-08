// Generator agent invocation. Wraps the Anthropic Agent SDK's `query()` to
// produce Playwright tests for a single component. The KEY architectural
// commitment: the agent does NOT discover visual states from the DOM — we
// hand it the AST-derived list up front. That's the difference between
// guessing and knowing (capability 4.2 in CLAUDE.md).
import { readFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import { ReactLensError } from '../utils/errors';
import { logger } from '../utils/logger';
import type { ComponentAnalysis } from '../ast/component-analyzer';
import { statesToTestCases, type TestCase } from './state-machine';

export type GenerateOptions = {
  cwd: string;
  componentPath: string;
  analysis: ComponentAnalysis;
  outputs: { pages: string; specs: string };
  mswHandlers: string;
  onProgress?: (event: GenerateProgress) => void;
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

async function readPrompt(): Promise<string> {
  // The prompt lives next to this compiled file when bundled, or up-tree in
  // the source repo during development.
  const candidates = [
    join(__dirname, 'prompts', 'generate-suite.md'),
    join(__dirname, '..', '..', 'src', 'generator', 'prompts', 'generate-suite.md'),
    join(dirname(__filename), 'prompts', 'generate-suite.md'),
  ];
  for (const c of candidates) {
    try {
      return await readFile(c, 'utf8');
    } catch {
      /* try next */
    }
  }
  throw new ReactLensError('generator prompt not found in dist or src', {
    code: 'GENERATOR_PROMPT_MISSING',
  });
}

function buildUserMessage(opts: GenerateOptions, testCases: TestCase[]): string {
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
  lines.push(`- pages directory: ${opts.outputs.pages}`);
  lines.push(`- specs directory: ${opts.outputs.specs}`);
  lines.push(`- shared MSW handlers file: ${opts.mswHandlers}`);
  lines.push(``);
  lines.push(`Generate the POM and spec following the system prompt's rules.`);
  return lines.join('\n');
}

export async function generateTests(opts: GenerateOptions): Promise<GenerateResult> {
  const systemPrompt = await readPrompt();
  const testCases = statesToTestCases(opts.analysis);
  const userMessage = buildUserMessage(opts, testCases);
  const filesWritten: string[] = [];

  const queryOptions: Options = {
    cwd: resolve(opts.cwd),
    systemPrompt: { type: 'preset', preset: 'claude_code', append: systemPrompt },
    allowedTools: ['Read', 'Write', 'Glob', 'Grep'],
    permissionMode: 'acceptEdits',
    maxTurns: 100,
  };

  const stream = query({
    prompt: userMessage,
    options: queryOptions,
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
