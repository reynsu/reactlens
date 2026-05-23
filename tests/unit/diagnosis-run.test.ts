// DiagnosisRun — Module Interface tests against a FakeAgentRunner.
//
// The Module's external surface is `createDiagnosisRun({ agent }).run(intent, { onChunk? })`.
// These tests assert behavior crossing that surface only — no internal helpers
// are reached from here. That's deliberate per LANGUAGE.md: the interface IS
// the test surface, and a refactor of the prepare/execute split must not
// require these tests to change as long as the Diagnosis output is preserved.
//
// Today only the `post-mortem` intent is wired (#43). #44/#45/#46 will add
// `live`, `eval-case`, `ablation` intents — each migration adds tests here.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDiagnosisRun } from '../../src/diagnosis-run/run';
import { extractFinalJson } from '../../src/diagnosis-run/execute';
import { FakeAgentRunner } from '../helpers/fake-agent';

const VALID = JSON.stringify({
  classification: 'real-bug',
  confidence: 'high',
  rootCause: 'x',
  evidence: ['e'],
  suggestedFix: 'f',
});

function tmpCwd(): string {
  return mkdtempSync(join(tmpdir(), 'reactlens-diagnosis-run-'));
}

describe('DiagnosisRun — post-mortem intent', () => {
  it('happy path: returns a parsed Diagnosis on first attempt', async () => {
    const agent = new FakeAgentRunner(VALID);
    const cwd = tmpCwd();
    const runner = createDiagnosisRun({ agent });

    const diagnosis = await runner.run({
      kind: 'post-mortem',
      cwd,
      testId: 't1',
      testTitle: 'login form rejects empty password',
      specFile: join(cwd, 'login.spec.ts'),
    });

    expect(diagnosis.classification).toBe('real-bug');
    expect(diagnosis.confidence).toBe('high');
    expect(agent.calls).toHaveLength(1);
  });

  it('retries once when first response is unparseable JSON', async () => {
    const agent = new FakeAgentRunner(['not json at all', VALID]);
    const cwd = tmpCwd();
    const runner = createDiagnosisRun({ agent });

    const diagnosis = await runner.run({
      kind: 'post-mortem',
      cwd,
      testId: 't1',
      testTitle: 'x',
      specFile: join(cwd, 's.ts'),
    });

    expect(diagnosis.classification).toBe('real-bug');
    expect(agent.calls).toHaveLength(2);
    // The retry attempt appends the stricter reminder to the user message.
    expect(agent.calls[1]?.prompt).toMatch(/IMPORTANT:/);
  });

  it('returns degradedDiagnosis when both attempts produce unparseable JSON', async () => {
    const agent = new FakeAgentRunner(['no json', 'still no json']);
    const cwd = tmpCwd();
    const runner = createDiagnosisRun({ agent });

    const diagnosis = await runner.run({
      kind: 'post-mortem',
      cwd,
      testId: 't1',
      testTitle: 'x',
      specFile: join(cwd, 's.ts'),
    });

    // degradedDiagnosis is the published shape — has the four required fields,
    // typically low confidence and a flaky-or-unknown classification.
    expect(diagnosis.confidence).toBe('low');
    expect(agent.calls).toHaveLength(2);
  });

  it('returns degradedDiagnosis when JSON parses but fails the DiagnosisSchema', async () => {
    // Parses as JSON but is missing required Diagnosis fields → safeParse fails.
    const malformed = JSON.stringify({ wrongShape: true });
    const agent = new FakeAgentRunner([malformed, malformed]);
    const cwd = tmpCwd();
    const runner = createDiagnosisRun({ agent });

    const diagnosis = await runner.run({
      kind: 'post-mortem',
      cwd,
      testId: 't1',
      testTitle: 'x',
      specFile: join(cwd, 's.ts'),
    });

    expect(diagnosis.confidence).toBe('low');
  });

  it('passes the configured allowedTools, permissionMode, and maxTurns to the agent', async () => {
    const agent = new FakeAgentRunner(VALID);
    const cwd = tmpCwd();
    const runner = createDiagnosisRun({ agent });

    await runner.run({
      kind: 'post-mortem',
      cwd,
      testId: 't1',
      testTitle: 'x',
      specFile: join(cwd, 's.ts'),
    });

    const call = agent.calls[0];
    expect(call?.allowedTools).toEqual(['Read', 'Glob', 'Grep', 'Bash']);
    expect(call?.permissionMode).toBe('default');
    expect(call?.maxTurns).toBe(30);
    expect(call?.cwd).toBe(cwd);
  });

  it('appends the diagnose system prompt + classify-bug rubric to systemPromptAppend', async () => {
    const agent = new FakeAgentRunner(VALID);
    const cwd = tmpCwd();
    const runner = createDiagnosisRun({ agent });

    await runner.run({
      kind: 'post-mortem',
      cwd,
      testId: 't1',
      testTitle: 'x',
      specFile: join(cwd, 's.ts'),
    });

    const sys = agent.calls[0]?.systemPromptAppend ?? '';
    // We don't assert exact contents (those live in the prompts package); we
    // assert both prompts are joined with the separator so the agent sees the
    // rubric concatenated to the system prompt.
    expect(sys.length).toBeGreaterThan(0);
    expect(sys).toContain('---');
  });

  it('invokes onChunk for each streamed text block', async () => {
    const agent = new FakeAgentRunner(VALID);
    const cwd = tmpCwd();
    const chunks: string[] = [];
    const runner = createDiagnosisRun({ agent });

    await runner.run(
      {
        kind: 'post-mortem',
        cwd,
        testId: 't1',
        testTitle: 'x',
        specFile: join(cwd, 's.ts'),
      },
      { onChunk: (text) => chunks.push(text) },
    );

    expect(chunks).toEqual([VALID]);
  });

  it('passes the buildUserMessage output as the agent prompt by default', async () => {
    const agent = new FakeAgentRunner(VALID);
    const cwd = tmpCwd();
    const runner = createDiagnosisRun({ agent });

    await runner.run({
      kind: 'post-mortem',
      cwd,
      testId: 't1',
      testTitle: 'login broke',
      specFile: join(cwd, 's.ts'),
      errorMessage: 'expected button to be visible',
    });

    const prompt = agent.calls[0]?.prompt ?? '';
    // The buildUserMessage helper from the prompts package interpolates the
    // test title + error into the prompt. We don't pin exact wording — just
    // assert the prompt contains the load-bearing inputs.
    expect(prompt).toContain('login broke');
    expect(prompt).toContain('expected button to be visible');
  });
});

describe('extractFinalJson — direct unit (folded from run-json)', () => {
  it('extracts JSON from a ```json fenced block', () => {
    expect(extractFinalJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('extracts JSON from a plain ``` fenced block', () => {
    expect(extractFinalJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('parses raw JSON without fences', () => {
    expect(extractFinalJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('recovers JSON from preamble + JSON', () => {
    expect(extractFinalJson('preamble {"a":1}')).toEqual({ a: 1 });
  });

  it('returns null when no JSON is present', () => {
    expect(extractFinalJson('no json at all')).toBeNull();
  });

  it('returns null when JSON-looking text fails to parse', () => {
    expect(extractFinalJson('preamble { not json at all')).toBeNull();
  });
});
