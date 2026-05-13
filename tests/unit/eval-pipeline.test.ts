import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runEvalCase } from '../../src/analyzer/eval-pipeline';
import type { AgentMessage, AgentQueryOptions, AgentRunner } from '../../src/agent/runner';

function makeCaseDir(opts: {
  classification: 'real-bug' | 'test-bug' | 'flaky' | 'env-issue';
  minimumConfidence: 'high' | 'medium' | 'low';
  category?: string;
}): string {
  const dir = mkdtempSync(join(tmpdir(), 'reactlens-eval-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'truth.json'),
    JSON.stringify({
      expectedClassification: opts.classification,
      minimumConfidence: opts.minimumConfidence,
      ...(opts.category !== undefined ? { category: opts.category } : {}),
    }),
  );
  writeFileSync(join(dir, 'component.tsx'), 'export function C(): null { return null; }\n');
  writeFileSync(join(dir, 'spec.ts'), 'import {test} from "@playwright/test"; test("x", () => {});\n');
  return dir;
}

function cannedAgent(reply: string): AgentRunner {
  return {
    async *query(): AsyncIterable<AgentMessage> {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: reply }] } };
    },
  };
}

describe('runEvalCase', () => {
  it('runs the diagnosis agent against a case and returns a CaseResult', async () => {
    const dir = makeCaseDir({ classification: 'test-bug', minimumConfidence: 'medium' });
    const reply = JSON.stringify({
      classification: 'test-bug',
      confidence: 'medium',
      rootCause: 'spec selector stale',
      evidence: ['snapshot shows login-error, spec asserts login-fail'],
      suggestedFix: 'rename selector',
    });
    const agent = cannedAgent('```json\n' + reply + '\n```');
    const result = await runEvalCase({ caseDir: dir, agent });
    expect(result.name).toBe(dir.split('/').pop());
    expect(result.actual.classification).toBe('test-bug');
    expect(result.correct).toBe(true);
    expect(result.falseConfidence).toBe(false);
  });

  it('never exposes truth.json to the agent (sandboxed cwd)', async () => {
    const dir = makeCaseDir({ classification: 'test-bug', minimumConfidence: 'medium' });
    const reply = JSON.stringify({
      classification: 'test-bug',
      confidence: 'medium',
      rootCause: 'x',
      evidence: [],
      suggestedFix: 'x',
    });

    let observedCwd: string | undefined;
    let observedFiles: string[] = [];
    let observedComponentFile: string | undefined;
    let observedSpecFile: string | undefined;
    const agent: AgentRunner = {
      // eslint-disable-next-line require-yield
      async *query(opts: AgentQueryOptions): AsyncIterable<AgentMessage> {
        observedCwd = opts.cwd;
        observedFiles = readdirSync(opts.cwd);
        // The diagnosis prompt embeds the component/spec paths; capture them
        // off the user message so we can assert they too live inside the cwd.
        const m = opts.prompt.match(/Spec: (\S+)[\s\S]*?Component \(probable\): (\S+)/);
        if (m !== null) {
          observedSpecFile = m[1];
          observedComponentFile = m[2];
        }
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: '```json\n' + reply + '\n```' }] },
        };
      },
    };

    await runEvalCase({ caseDir: dir, agent });

    expect(observedCwd).toBeDefined();
    expect(observedCwd).not.toBe(dir); // must be a sandbox, not the case dir
    expect(observedFiles).not.toContain('truth.json');
    expect(observedFiles).toContain('component.tsx');
    expect(observedFiles).toContain('spec.ts');
    // The paths embedded in the prompt must point inside the sandbox so the
    // agent cannot Read the original case dir by absolute path.
    expect(observedComponentFile?.startsWith(observedCwd ?? '__none__')).toBe(true);
    expect(observedSpecFile?.startsWith(observedCwd ?? '__none__')).toBe(true);
  });
});
