// Test helper: an AgentRunner that emits scripted assistant text without
// touching the network or the local Claude CLI. Each script entry corresponds
// to one query() invocation, so multi-attempt flows (retry on bad JSON) can
// program the first response to be malformed and the second to be valid.
//
// The recorded `calls` array gives tests visibility into the AgentQueryOptions
// each invocation received — used to assert that allowedTools / permissionMode
// / maxTurns / userMessage / systemPromptAppend are wired correctly.
import type {
  AgentMessage,
  AgentQueryOptions,
  AgentRunner,
} from '../../src/agent/runner';

export type FakeAgentScript = string | string[];

export type FakeAgentCall = {
  cwd: string;
  prompt: string;
  systemPromptAppend: string;
  allowedTools: string[];
  permissionMode: 'default' | 'acceptEdits';
  maxTurns: number;
};

export class FakeAgentRunner implements AgentRunner {
  readonly calls: FakeAgentCall[] = [];
  private readonly responses: string[];

  constructor(script: FakeAgentScript) {
    this.responses = Array.isArray(script) ? script : [script];
  }

  query(opts: AgentQueryOptions): AsyncIterable<AgentMessage> {
    const callIndex = this.calls.length;
    this.calls.push({
      cwd: opts.cwd,
      prompt: opts.prompt,
      systemPromptAppend: opts.systemPromptAppend,
      allowedTools: opts.allowedTools,
      permissionMode: opts.permissionMode,
      maxTurns: opts.maxTurns,
    });
    const text = this.responses[callIndex] ?? '';
    return makeStream([
      { type: 'assistant', message: { content: [{ type: 'text', text }] } },
      { type: 'result', subtype: 'success' },
    ]);
  }
}

function makeStream(messages: AgentMessage[]): AsyncIterable<AgentMessage> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const m of messages) yield m;
    },
  };
}
