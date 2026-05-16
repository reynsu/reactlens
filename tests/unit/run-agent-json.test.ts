// Covers the runAgentJson seam end-to-end against a FakeAgentRunner. The
// matrix that used to live inline in failure-agent (no-JSON, shape-mismatch,
// retry recovers, retry uses stricter framing) is testable here without
// standing up FailedTest, gitContext, or the diagnosis schema.
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  extractFinalJson,
  loadPromptSource,
  runAgentJson,
} from '../../src/agent/run-json';
import { FakeAgentRunner } from '../helpers/fake-agent';

const schema = z.object({ result: z.string(), score: z.number() });

describe('runAgentJson — happy paths', () => {
  it('parses a fenced JSON code block in the final assistant text', async () => {
    const agent = new FakeAgentRunner(
      'Here is the result:\n```json\n{"result":"ok","score":42}\n```',
    );
    const out = await runAgentJson({
      agent,
      cwd: '/tmp',
      systemPrompt: { text: 'system' },
      userMessage: 'go',
      schema,
    });
    expect(out).toEqual({ result: 'ok', score: 42 });
    expect(agent.calls).toHaveLength(1);
  });

  it('parses bare JSON when there is no code fence', async () => {
    const agent = new FakeAgentRunner('{"result":"bare","score":1}');
    const out = await runAgentJson({
      agent,
      cwd: '/tmp',
      systemPrompt: { text: 'system' },
      userMessage: 'go',
      schema,
    });
    expect(out).toEqual({ result: 'bare', score: 1 });
  });

  it('falls back to the last { when extraction needs to scan past preamble', async () => {
    const agent = new FakeAgentRunner('blah blah preamble {"result":"final","score":9}');
    const out = await runAgentJson({
      agent,
      cwd: '/tmp',
      systemPrompt: { text: 'system' },
      userMessage: 'go',
      schema,
    });
    expect(out).toEqual({ result: 'final', score: 9 });
  });
});

describe('runAgentJson — retry behaviour', () => {
  it('retries once when the first attempt has no parseable JSON', async () => {
    const agent = new FakeAgentRunner([
      'oh no, broken text no json here',
      '{"result":"recovered","score":2}',
    ]);
    const out = await runAgentJson({
      agent,
      cwd: '/tmp',
      systemPrompt: { text: 'system' },
      userMessage: 'go',
      schema,
    });
    expect(out).toEqual({ result: 'recovered', score: 2 });
    expect(agent.calls).toHaveLength(2);
  });

  it('returns null when both attempts fail JSON extraction', async () => {
    const agent = new FakeAgentRunner(['no json at all', 'still no json']);
    const out = await runAgentJson({
      agent,
      cwd: '/tmp',
      systemPrompt: { text: 'system' },
      userMessage: 'go',
      schema,
    });
    expect(out).toBeNull();
    expect(agent.calls).toHaveLength(2);
  });

  it('returns null when both attempts fail schema validation', async () => {
    const agent = new FakeAgentRunner([
      '{"result":"only-result-no-score"}',
      '{"score":99}',
    ]);
    const out = await runAgentJson({
      agent,
      cwd: '/tmp',
      systemPrompt: { text: 'system' },
      userMessage: 'go',
      schema,
    });
    expect(out).toBeNull();
    expect(agent.calls).toHaveLength(2);
  });

  it('uses a generic retryReminder by default on the second attempt', async () => {
    const agent = new FakeAgentRunner(['nope', '{"result":"ok","score":1}']);
    await runAgentJson({
      agent,
      cwd: '/tmp',
      systemPrompt: { text: 'system' },
      userMessage: 'do thing',
      schema,
    });
    const second = agent.calls[1];
    expect(second?.prompt).toContain('do thing');
    expect(second?.prompt).toContain('IMPORTANT:');
    expect(second?.prompt).toContain('JSON object matching the requested schema');
  });

  it('uses a caller-supplied retryReminder verbatim on the second attempt', async () => {
    const agent = new FakeAgentRunner(['nope', '{"result":"ok","score":1}']);
    await runAgentJson({
      agent,
      cwd: '/tmp',
      systemPrompt: { text: 'system' },
      userMessage: 'do thing',
      schema,
      retryReminder: 'we expected a Diagnosis JSON object exactly.',
    });
    expect(agent.calls[1]?.prompt).toContain('we expected a Diagnosis JSON object exactly.');
  });
});

describe('runAgentJson — prompt loading', () => {
  it('passes { text } through to systemPromptAppend unchanged', async () => {
    const agent = new FakeAgentRunner('{"result":"ok","score":1}');
    await runAgentJson({
      agent,
      cwd: '/tmp',
      systemPrompt: { text: 'inline system prompt' },
      userMessage: 'go',
      schema,
    });
    expect(agent.calls[0]?.systemPromptAppend).toBe('inline system prompt');
  });

  it('loads a real prompt file by { name, area } from src/<area>/prompts/<name>', async () => {
    // Smoke: live check that the resolver still finds disk-based prompts.
    // Diagnosis prompts moved to @reynsu/reactlens-diagnosis-prompts and are
    // passed inline as { text }; generator prompts remain on disk and exercise
    // the same loader path.
    const loaded = await loadPromptSource({ name: 'generate-suite.md', area: 'generator' });
    expect(loaded.length).toBeGreaterThan(50);
    expect(loaded).toMatch(/generat/i);
  });

  it('throws when the named prompt does not exist in any candidate path', async () => {
    await expect(
      loadPromptSource({ name: 'does-not-exist.md', area: 'analyzer' }),
    ).rejects.toThrow(/prompt not found/);
  });

  it('concatenates an array of prompts with the documented separator', async () => {
    const agent = new FakeAgentRunner('{"result":"ok","score":1}');
    await runAgentJson({
      agent,
      cwd: '/tmp',
      systemPrompt: [{ text: 'first' }, { text: 'second' }],
      userMessage: 'go',
      schema,
    });
    expect(agent.calls[0]?.systemPromptAppend).toBe('first\n\n---\n\nsecond');
  });
});

describe('runAgentJson — defaults and pass-through', () => {
  it('passes default tools / permission / maxTurns when caller does not override', async () => {
    const agent = new FakeAgentRunner('{"result":"ok","score":1}');
    await runAgentJson({
      agent,
      cwd: '/work',
      systemPrompt: { text: 's' },
      userMessage: 'u',
      schema,
    });
    const call = agent.calls[0];
    expect(call?.allowedTools).toEqual(['Read', 'Glob', 'Grep']);
    expect(call?.permissionMode).toBe('default');
    expect(call?.maxTurns).toBe(30);
    expect(call?.cwd).toBe('/work');
  });

  it('honours caller-supplied tools / permission / maxTurns', async () => {
    const agent = new FakeAgentRunner('{"result":"ok","score":1}');
    await runAgentJson({
      agent,
      cwd: '/work',
      systemPrompt: { text: 's' },
      userMessage: 'u',
      schema,
      allowedTools: ['Read', 'Bash'],
      permissionMode: 'acceptEdits',
      maxTurns: 99,
    });
    const call = agent.calls[0];
    expect(call?.allowedTools).toEqual(['Read', 'Bash']);
    expect(call?.permissionMode).toBe('acceptEdits');
    expect(call?.maxTurns).toBe(99);
  });

  it('invokes onChunk for every assistant text block across attempts', async () => {
    const agent = new FakeAgentRunner(['nope', '{"result":"ok","score":1}']);
    const onChunk = vi.fn();
    await runAgentJson({
      agent,
      cwd: '/tmp',
      systemPrompt: { text: 's' },
      userMessage: 'go',
      schema,
      onChunk,
    });
    expect(onChunk).toHaveBeenCalledTimes(2);
    expect(onChunk).toHaveBeenNthCalledWith(1, 'nope');
    expect(onChunk).toHaveBeenNthCalledWith(2, '{"result":"ok","score":1}');
  });
});

describe('extractFinalJson — direct unit', () => {
  it('extracts from a fenced ```json block', () => {
    expect(extractFinalJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('extracts from a fenced unmarked block', () => {
    expect(extractFinalJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('extracts bare JSON', () => {
    expect(extractFinalJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('falls back to the last {-anchored slice when the full text is not parseable', () => {
    expect(extractFinalJson('preamble {"a":1}')).toEqual({ a: 1 });
  });

  it('returns null when no { exists in the text', () => {
    expect(extractFinalJson('no json at all')).toBeNull();
  });

  it('returns null when the {-anchored slice is also unparseable', () => {
    expect(extractFinalJson('preamble { not json at all')).toBeNull();
  });
});
