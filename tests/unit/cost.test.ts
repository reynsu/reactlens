import { describe, expect, it } from 'vitest';
import {
  CostTracker,
  MODEL_PRICING,
  usageFromMessage,
  withCostTracking,
} from '../../src/agent/cost';
import { ReactLensError } from '../../src/utils/errors';
import type { AgentMessage, AgentRunner } from '../../src/agent/runner';

describe('usageFromMessage', () => {
  it('returns undefined for non-result messages', () => {
    expect(usageFromMessage({ type: 'assistant', message: { content: [] } })).toBeUndefined();
    expect(usageFromMessage({ type: 'system' })).toBeUndefined();
    expect(usageFromMessage(null)).toBeUndefined();
    expect(usageFromMessage('result')).toBeUndefined();
  });

  it('extracts tokens + model from a result message', () => {
    const msg = {
      type: 'result',
      subtype: 'success',
      model: 'claude-opus-4-7',
      usage: {
        input_tokens: 1000,
        output_tokens: 500,
        cache_creation_input_tokens: 200,
        cache_read_input_tokens: 100,
      },
    };
    expect(usageFromMessage(msg)).toEqual({
      model: 'claude-opus-4-7',
      inputTokens: 1000,
      outputTokens: 500,
      cacheWriteTokens: 200,
      cacheReadTokens: 100,
    });
  });

  it('defaults missing usage fields to 0 and unknown model to "unknown"', () => {
    const msg = { type: 'result', subtype: 'success', usage: { input_tokens: 50 } };
    expect(usageFromMessage(msg)).toEqual({
      model: 'unknown',
      inputTokens: 50,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
  });

  it('returns undefined when usage is missing or malformed', () => {
    expect(usageFromMessage({ type: 'result', subtype: 'success' })).toBeUndefined();
    expect(usageFromMessage({ type: 'result', usage: null })).toBeUndefined();
    expect(usageFromMessage({ type: 'result', usage: 'oops' })).toBeUndefined();
  });
});

describe('CostTracker', () => {
  it('computes USD from per-MTok rates for a known model', () => {
    const tracker = new CostTracker();
    tracker.record({
      model: 'claude-opus-4-7',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
    const opus = MODEL_PRICING['claude-opus-4-7']!;
    const total = tracker.total();
    expect(total.usd).toBeCloseTo(opus.inputPerMTok + opus.outputPerMTok, 6);
    expect(total.calls).toBe(1);
    expect(total.unknownModels).toEqual([]);
  });

  it('still counts tokens for an unknown model but contributes $0', () => {
    const tracker = new CostTracker();
    tracker.record({
      model: 'claude-future-99',
      inputTokens: 10,
      outputTokens: 20,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
    const total = tracker.total();
    expect(total.usd).toBe(0);
    expect(total.inputTokens).toBe(10);
    expect(total.outputTokens).toBe(20);
    expect(total.unknownModels).toEqual(['claude-future-99']);
  });

  it('accumulates across multiple records', () => {
    const tracker = new CostTracker();
    for (let i = 0; i < 3; i += 1) {
      tracker.record({
        model: 'claude-sonnet-4-6',
        inputTokens: 100,
        outputTokens: 50,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
      });
    }
    expect(tracker.total().calls).toBe(3);
    expect(tracker.total().inputTokens).toBe(300);
    expect(tracker.total().outputTokens).toBe(150);
  });

  it('exceeded() is false when no cap is set, even at large usd', () => {
    const tracker = new CostTracker();
    tracker.record({
      model: 'claude-opus-4-7',
      inputTokens: 10_000_000,
      outputTokens: 10_000_000,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
    expect(tracker.exceeded()).toBe(false);
  });

  it('exceeded() trips when usd crosses maxUsd', () => {
    const tracker = new CostTracker({ maxUsd: 1.0 });
    // 1M input tokens at $15/MTok = $15 → well above the $1 cap.
    tracker.record({
      model: 'claude-opus-4-7',
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
    expect(tracker.exceeded()).toBe(true);
  });
});

describe('withCostTracking', () => {
  function makeRunner(messages: AgentMessage[]): AgentRunner {
    return {
      async *query() {
        for (const m of messages) yield m;
      },
    };
  }

  it('passes messages through unchanged', async () => {
    const runner = makeRunner([
      { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } },
      { type: 'result', subtype: 'success' },
    ]);
    const tracker = new CostTracker();
    const wrapped = withCostTracking(runner, tracker);
    const out: AgentMessage[] = [];
    for await (const m of wrapped.query({
      cwd: '.',
      prompt: '',
      systemPromptAppend: '',
      allowedTools: [],
      permissionMode: 'default',
      maxTurns: 1,
    })) {
      out.push(m);
    }
    expect(out).toHaveLength(2);
  });

  it('records usage from result messages and exposes totals via the tracker', async () => {
    const result = {
      type: 'result',
      subtype: 'success',
      model: 'claude-haiku-4-5',
      usage: { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    } as unknown as AgentMessage;
    const runner = makeRunner([result]);
    const tracker = new CostTracker();
    const wrapped = withCostTracking(runner, tracker);
    for await (const _m of wrapped.query({
      cwd: '.',
      prompt: '',
      systemPromptAppend: '',
      allowedTools: [],
      permissionMode: 'default',
      maxTurns: 1,
    })) {
      void _m;
    }
    const total = tracker.total();
    expect(total.calls).toBe(1);
    expect(total.inputTokens).toBe(1000);
    expect(total.outputTokens).toBe(500);
    // Haiku: 1000 * 0.8/1M + 500 * 4/1M = 0.0008 + 0.002 = 0.0028
    expect(total.usd).toBeCloseTo(0.0028, 6);
  });

  it('throws AGENT_COST_EXCEEDED after the result that breaches the cap', async () => {
    const overBudget = {
      type: 'result',
      subtype: 'success',
      model: 'claude-opus-4-7',
      usage: { input_tokens: 1_000_000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    } as unknown as AgentMessage;
    const followUp = { type: 'assistant', message: { content: [] } } as AgentMessage;
    const runner = makeRunner([overBudget, followUp]);
    const tracker = new CostTracker({ maxUsd: 0.5 });
    const wrapped = withCostTracking(runner, tracker);

    await expect(async () => {
      for await (const _m of wrapped.query({
        cwd: '.',
        prompt: '',
        systemPromptAppend: '',
        allowedTools: [],
        permissionMode: 'default',
        maxTurns: 1,
      })) {
        void _m;
      }
    }).rejects.toThrowError(ReactLensError);
  });
});
