// Token usage + USD cost tracking for AgentRunner streams.
//
// SDK runs against the Anthropic API: every `result` message carries a
// `usage` field with input/output/cache-creation/cache-read token counts and
// a `model` identifier. The CLI runner (`REACTLENS_USE_CLAUDE_CODE=1`) emits
// the same shape — Max billing notwithstanding — so the same extractor works
// for both. When `usage` is absent (older CLI builds, error events) the
// stream simply doesn't get a record, which is correct: we under-count rather
// than guess.
//
// `--max-cost <usd>` is enforced at message boundaries: after each `result`
// updates the tracker, the next iteration of `withCostTracking` throws if the
// cap is exceeded. The cap can be slightly overshot — by at most one result
// event — because we can't preempt the SDK's in-flight turn. That's an
// accepted limit; if you need a hard cap, set the cap lower than your true
// ceiling.
//
// Pricing is encoded per known model. Unknown models (future Claude versions
// before this table is updated) still accumulate token counts but contribute
// $0 to the running total — better than silently inventing a fallback rate.

import { ReactLensError } from '../utils/errors';
import type { AgentMessage, AgentRunner } from './runner';

export type ModelPricing = {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWritePerMTok: number;
  cacheReadPerMTok: number;
};

// USD per 1M tokens, per official Anthropic pricing as of 2026-05.
// Update when prices change; do not hardcode model names elsewhere.
export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-7': { inputPerMTok: 15, outputPerMTok: 75, cacheWritePerMTok: 18.75, cacheReadPerMTok: 1.5 },
  'claude-opus-4-6': { inputPerMTok: 15, outputPerMTok: 75, cacheWritePerMTok: 18.75, cacheReadPerMTok: 1.5 },
  'claude-sonnet-4-6': { inputPerMTok: 3, outputPerMTok: 15, cacheWritePerMTok: 3.75, cacheReadPerMTok: 0.3 },
  'claude-sonnet-4-5': { inputPerMTok: 3, outputPerMTok: 15, cacheWritePerMTok: 3.75, cacheReadPerMTok: 0.3 },
  'claude-haiku-4-5': { inputPerMTok: 0.8, outputPerMTok: 4, cacheWritePerMTok: 1, cacheReadPerMTok: 0.08 },
};

export type UsageDelta = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
};

export type CostTotals = {
  usd: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  calls: number;
  unknownModels: string[];
};

export class CostTracker {
  private inputTokens = 0;
  private outputTokens = 0;
  private cacheWriteTokens = 0;
  private cacheReadTokens = 0;
  private usd = 0;
  private calls = 0;
  private unknownModels = new Set<string>();
  readonly maxUsd?: number;

  constructor(opts: { maxUsd?: number } = {}) {
    if (opts.maxUsd !== undefined && opts.maxUsd > 0) this.maxUsd = opts.maxUsd;
  }

  record(delta: UsageDelta): void {
    this.inputTokens += delta.inputTokens;
    this.outputTokens += delta.outputTokens;
    this.cacheWriteTokens += delta.cacheWriteTokens;
    this.cacheReadTokens += delta.cacheReadTokens;
    this.calls += 1;
    const price = MODEL_PRICING[delta.model];
    if (price === undefined) {
      this.unknownModels.add(delta.model);
      return;
    }
    this.usd +=
      (delta.inputTokens * price.inputPerMTok +
        delta.outputTokens * price.outputPerMTok +
        delta.cacheWriteTokens * price.cacheWritePerMTok +
        delta.cacheReadTokens * price.cacheReadPerMTok) /
      1_000_000;
  }

  total(): CostTotals {
    return {
      usd: this.usd,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cacheWriteTokens: this.cacheWriteTokens,
      cacheReadTokens: this.cacheReadTokens,
      calls: this.calls,
      unknownModels: Array.from(this.unknownModels),
    };
  }

  exceeded(): boolean {
    return this.maxUsd !== undefined && this.usd >= this.maxUsd;
  }
}

function numFrom(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// Extracts a UsageDelta from a `result` message. Returns undefined for any
// other message type or when the usage shape is missing/malformed. Defensive
// because the agent SDK's `result` event isn't strictly typed at the
// AgentMessage layer.
export function usageFromMessage(msg: AgentMessage | unknown): UsageDelta | undefined {
  if (msg === null || typeof msg !== 'object') return undefined;
  const m = msg as Record<string, unknown>;
  if (m['type'] !== 'result') return undefined;
  const usage = m['usage'];
  if (usage === null || typeof usage !== 'object') return undefined;
  const u = usage as Record<string, unknown>;
  const model = typeof m['model'] === 'string' ? (m['model'] as string) : 'unknown';
  return {
    model,
    inputTokens: numFrom(u['input_tokens']),
    outputTokens: numFrom(u['output_tokens']),
    cacheWriteTokens: numFrom(u['cache_creation_input_tokens']),
    cacheReadTokens: numFrom(u['cache_read_input_tokens']),
  };
}

// Decorates an AgentRunner so every result message updates the tracker.
// On cap breach the next yield throws `AGENT_COST_EXCEEDED`; the caller's
// `for await` loop unwinds and the CLI boundary surfaces the helpUrl.
export function withCostTracking(runner: AgentRunner, tracker: CostTracker): AgentRunner {
  return {
    async *query(opts) {
      for await (const msg of runner.query(opts)) {
        const usage = usageFromMessage(msg);
        if (usage !== undefined) tracker.record(usage);
        if (tracker.exceeded()) {
          const total = tracker.total();
          throw new ReactLensError(
            `--max-cost cap reached: $${total.usd.toFixed(4)} >= cap $${tracker.maxUsd!.toFixed(2)} after ${total.calls} call(s)`,
            { code: 'AGENT_COST_EXCEEDED' },
          );
        }
        yield msg;
      }
    },
  };
}
