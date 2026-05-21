// TDD for the GenerationPromptResolver deep module (v0.3 slice 6 phase 2).
//
// Pure function: maps (analysis, config) → (promptName, outputFormat). No I/O.
// The generator delegate uses the result to pick the right system prompt and
// to decide whether to emit a separate POM file or just a spec.
import { describe, expect, it } from 'vitest';
import type { ReactLensConfig } from '../../src/config/schema';
import type { ComponentAnalysis } from '../../src/ast/component-analyzer';
import { resolveGenerationPrompt } from '../../src/generator/prompt-resolver';

function makeConfig(pattern: 'pom' | 'component-object'): ReactLensConfig {
  return {
    componentGlobs: ['src/**/*.tsx'],
    output: { pages: 'e2e/pages', specs: 'e2e/specs' },
    msw: { handlers: 'src/mocks/handlers.ts' },
    dashboard: { port: 7777, open: true },
    pattern,
  };
}

function makeAnalysis(overrides: Partial<ComponentAnalysis> = {}): ComponentAnalysis {
  return {
    componentName: 'LoginPage',
    filePath: '/abs/path/LoginPage.tsx',
    states: [],
    hooks: [],
    endpoints: [],
    ...overrides,
  };
}

describe('resolveGenerationPrompt', () => {
  describe('pattern: pom', () => {
    it('returns the POM prompt and a pom outputFormat with both pages + specs dirs', () => {
      const result = resolveGenerationPrompt({
        analysis: makeAnalysis(),
        config: makeConfig('pom'),
      });
      expect(result.promptName).toBe('generate-suite.md');
      expect(result.outputFormat).toEqual({
        kind: 'pom',
        pagesDir: 'e2e/pages',
        specsDir: 'e2e/specs',
      });
    });

    it('threads through custom output dirs from config', () => {
      const config = makeConfig('pom');
      config.output = { pages: 'tests/pages', specs: 'tests/specs' };
      const result = resolveGenerationPrompt({ analysis: makeAnalysis(), config });
      expect(result.outputFormat).toEqual({
        kind: 'pom',
        pagesDir: 'tests/pages',
        specsDir: 'tests/specs',
      });
    });
  });

  describe('pattern: component-object', () => {
    it('returns the CO prompt and a component-object outputFormat (specs only)', () => {
      const result = resolveGenerationPrompt({
        analysis: makeAnalysis(),
        config: makeConfig('component-object'),
      });
      expect(result.promptName).toBe('generate-suite-component-object.md');
      expect(result.outputFormat).toEqual({
        kind: 'component-object',
        specsDir: 'e2e/specs',
      });
    });

    it('does not emit a pagesDir for CO specs — CO specs are self-contained', () => {
      const result = resolveGenerationPrompt({
        analysis: makeAnalysis(),
        config: makeConfig('component-object'),
      });
      expect(result.outputFormat).not.toHaveProperty('pagesDir');
    });
  });

  describe('purity', () => {
    it('does not mutate the input config', () => {
      const config = makeConfig('pom');
      const before = JSON.parse(JSON.stringify(config));
      resolveGenerationPrompt({ analysis: makeAnalysis(), config });
      expect(config).toEqual(before);
    });

    it('does not mutate the input analysis', () => {
      const analysis = makeAnalysis({ states: [{ name: 'idle' } as never] });
      const before = JSON.parse(JSON.stringify(analysis));
      resolveGenerationPrompt({ analysis, config: makeConfig('component-object') });
      expect(analysis).toEqual(before);
    });

    it('handles a component with no states (still returns a valid result)', () => {
      const result = resolveGenerationPrompt({
        analysis: makeAnalysis({ states: [] }),
        config: makeConfig('pom'),
      });
      expect(result.promptName).toBe('generate-suite.md');
    });

    it('handles a component with many states (analysis shape does not change selection)', () => {
      const result = resolveGenerationPrompt({
        analysis: makeAnalysis({
          states: [
            { name: 'idle' } as never,
            { name: 'loading' } as never,
            { name: 'error' } as never,
            { name: 'success' } as never,
          ],
        }),
        config: makeConfig('component-object'),
      });
      expect(result.promptName).toBe('generate-suite-component-object.md');
    });
  });
});
