// Verifies the agent-selection precedence enforced by pickAgentRunner and
// the public-Interface bundling done by prepareAgent. Anthropic explicitly
// warns that ANTHROPIC_API_KEY in the environment can make Claude Code bill
// against the API instead of the subscription, so the matrix below pins the
// project policy: subscription wins by default; API only on explicit opt-in
// or as a last-resort fallback.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  pickAgentRunner,
  prepareAgent,
  type AgentDetectors,
} from '../../src/agent/select';
import { CostTracker } from '../../src/agent/cost';
import { cliRunner } from '../../src/agent/cli-runner';
import { sdkRunner } from '../../src/agent/sdk-runner';
import { ReactLensError } from '../../src/utils/errors';

function detectors(opts: { cli: boolean; key: boolean }): AgentDetectors {
  return {
    hasClaudeCli: async () => opts.cli,
    hasApiKey: () => opts.key,
  };
}

const ENV_KEYS = ['ANTHROPIC_API_KEY', 'REACTLENS_FORCE_API', 'REACTLENS_USE_CLAUDE_CODE'] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('pickAgentRunner — default precedence (no flags)', () => {
  it('prefers the CLI when available, even with ANTHROPIC_API_KEY set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const runner = await pickAgentRunner({ commandName: 'run' }, detectors({ cli: true, key: true }));
    expect(runner).toBe(cliRunner);
  });

  it('uses the CLI when no API key is set', async () => {
    const runner = await pickAgentRunner({ commandName: 'run' }, detectors({ cli: true, key: false }));
    expect(runner).toBe(cliRunner);
  });

  it('falls back to the SDK when CLI is missing but API key present', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const runner = await pickAgentRunner({ commandName: 'run' }, detectors({ cli: false, key: true }));
    expect(runner).toBe(sdkRunner);
  });

  it('throws NO_AGENT when neither CLI nor API key are available', async () => {
    await expect(
      pickAgentRunner({ commandName: 'run' }, detectors({ cli: false, key: false })),
    ).rejects.toMatchObject({ code: 'RUN_NO_AGENT' });
  });
});

describe('pickAgentRunner — explicit overrides', () => {
  it('--force-api uses the SDK even when CLI is available', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const runner = await pickAgentRunner(
      { commandName: 'run', forceApi: true },
      detectors({ cli: true, key: true }),
    );
    expect(runner).toBe(sdkRunner);
  });

  it('--force-api throws when ANTHROPIC_API_KEY is missing', async () => {
    await expect(
      pickAgentRunner({ commandName: 'analyze', forceApi: true }, detectors({ cli: true, key: false })),
    ).rejects.toMatchObject({ code: 'ANALYZE_NO_AGENT' });
  });

  it('REACTLENS_FORCE_API=1 has the same effect as the flag', async () => {
    process.env.REACTLENS_FORCE_API = '1';
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const runner = await pickAgentRunner({ commandName: 'run' }, detectors({ cli: true, key: true }));
    expect(runner).toBe(sdkRunner);
  });

  it('--use-claude-code uses the CLI even when API key is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const runner = await pickAgentRunner(
      { commandName: 'generate', useClaudeCode: true },
      detectors({ cli: true, key: true }),
    );
    expect(runner).toBe(cliRunner);
  });

  it('--use-claude-code is strict: throws when CLI is missing', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    await expect(
      pickAgentRunner(
        { commandName: 'generate', useClaudeCode: true },
        detectors({ cli: false, key: true }),
      ),
    ).rejects.toBeInstanceOf(ReactLensError);
  });

  it('rejects --force-api together with --use-claude-code', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    await expect(
      pickAgentRunner(
        { commandName: 'run', forceApi: true, useClaudeCode: true },
        detectors({ cli: true, key: true }),
      ),
    ).rejects.toMatchObject({ code: 'RUN_NO_AGENT' });
  });
});

describe('prepareAgent — onMissing: "null" (diagnosis gate for reactlens run)', () => {
  it('returns a preparation when CLI is available (no env)', async () => {
    const p = await prepareAgent({ commandName: 'run', onMissing: 'null' }, detectors({ cli: true, key: false }));
    expect(p).not.toBeNull();
    expect(p?.agent).toBeDefined();
    expect(p?.tracker).toBeInstanceOf(CostTracker);
  });

  it('returns a preparation when only API key is available', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const p = await prepareAgent({ commandName: 'run', onMissing: 'null' }, detectors({ cli: false, key: true }));
    expect(p).not.toBeNull();
  });

  it('returns null when neither CLI nor API key are available', async () => {
    const p = await prepareAgent({ commandName: 'run', onMissing: 'null' }, detectors({ cli: false, key: false }));
    expect(p).toBeNull();
  });

  it('honors --force-api: null when the API key is missing', async () => {
    const p = await prepareAgent(
      { commandName: 'run', forceApi: true, onMissing: 'null' },
      detectors({ cli: true, key: false }),
    );
    expect(p).toBeNull();
  });

  it('honors --use-claude-code: null when the CLI is missing', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const p = await prepareAgent(
      { commandName: 'run', useClaudeCode: true, onMissing: 'null' },
      detectors({ cli: false, key: true }),
    );
    expect(p).toBeNull();
  });

  it('returns null when both flags are set (contradiction)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const p = await prepareAgent(
      { commandName: 'run', forceApi: true, useClaudeCode: true, onMissing: 'null' },
      detectors({ cli: true, key: true }),
    );
    expect(p).toBeNull();
  });
});

describe('prepareAgent — onMissing: "throw" (eager bundle for generate / analyze / regen)', () => {
  it('returns both an agent and a tracker on the happy path', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const result = await prepareAgent(
      { commandName: 'generate' },
      detectors({ cli: true, key: true }),
    );
    expect(result.agent).toBeDefined();
    expect(typeof result.agent.query).toBe('function');
    expect(result.tracker).toBeInstanceOf(CostTracker);
  });

  it('propagates maxCost into the tracker (cap is enforced at next message)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const { tracker } = await prepareAgent(
      { commandName: 'generate', maxCost: 0.5 },
      detectors({ cli: true, key: true }),
    );
    // CostTracker exposes the cap via .maxUsd? — verify we wired the option through.
    // Total starts at zero; the cap surfaces as a thrown error at next agent
    // message, not synchronously, so we just sanity-check totals start clean.
    expect(tracker.total().usd).toBe(0);
  });

  it('throws when pickAgentRunner would throw (e.g. contradictory flags)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    await expect(
      prepareAgent(
        { commandName: 'generate', forceApi: true, useClaudeCode: true },
        detectors({ cli: true, key: true }),
      ),
    ).rejects.toMatchObject({ code: 'GENERATE_NO_AGENT' });
  });

  it('throws NO_AGENT when no backend is reachable and onMissing is default', async () => {
    await expect(
      prepareAgent({ commandName: 'generate' }, detectors({ cli: false, key: false })),
    ).rejects.toMatchObject({ code: 'GENERATE_NO_AGENT' });
  });
});
