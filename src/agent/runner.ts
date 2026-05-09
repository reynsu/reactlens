// Abstraction over "run a Claude agent with a system prompt + tools and stream
// results". Two implementations:
//   - sdk-runner.ts:  uses @anthropic-ai/claude-agent-sdk + ANTHROPIC_API_KEY.
//                     Token-billed against the Anthropic API.
//   - cli-runner.ts:  shells out to the local `claude` CLI binary, which is
//                     OAuth-authenticated against your Claude.ai/Max account.
//                     Anthropic's TOS does NOT permit distributing third-party
//                     tools that depend on Max — see docs/troubleshooting.md.
//                     Use this path only for local development.
//
// Both runners yield the same AgentMessage shape; consumers (generator,
// diagnosis) don't need to know which is in use.

export type AgentTextBlock = { type: 'text'; text: string };
export type AgentToolUseBlock = { type: 'tool_use'; name: string; input: unknown };
export type AgentContentBlock = AgentTextBlock | AgentToolUseBlock;

export type AgentMessage =
  | { type: 'assistant'; message: { content: AgentContentBlock[] } }
  | { type: 'result'; subtype: string }
  | { type: 'system'; [k: string]: unknown }
  | { type: 'user'; [k: string]: unknown };

export type AgentQueryOptions = {
  cwd: string;
  prompt: string;
  // Appended to the built-in 'claude_code' preset. Both runners apply this
  // identically.
  systemPromptAppend: string;
  allowedTools: string[];
  permissionMode: 'default' | 'acceptEdits';
  maxTurns: number;
};

export type AgentRunner = {
  query(opts: AgentQueryOptions): AsyncIterable<AgentMessage>;
};
