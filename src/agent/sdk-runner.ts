import { resolve } from 'node:path';
import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import type { AgentMessage, AgentQueryOptions, AgentRunner } from './runner';

export const sdkRunner: AgentRunner = {
  async *query(opts: AgentQueryOptions): AsyncIterable<AgentMessage> {
    const queryOptions: Options = {
      cwd: resolve(opts.cwd),
      systemPrompt: { type: 'preset', preset: 'claude_code', append: opts.systemPromptAppend },
      allowedTools: opts.allowedTools,
      permissionMode: opts.permissionMode,
      maxTurns: opts.maxTurns,
    };
    const stream = query({ prompt: opts.prompt, options: queryOptions });
    for await (const message of stream) {
      yield message as AgentMessage;
    }
  },
};
