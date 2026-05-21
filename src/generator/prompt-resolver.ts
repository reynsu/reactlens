// GenerationPromptResolver — deep module that maps the (analysis, config)
// inputs the generator already has to the prompt name + output-shape the
// generator should use. Pure function; no I/O, no mutation.
//
// Phase 2 of v0.3 slice 6. Phase 1 added the `pattern` field to config and the
// `--pattern` CLI flag (which gets merged into config before reaching here).
// The resolver is the single decision point that branches POM vs CO.
import type { ReactLensConfig } from '../config/schema';
import type { ComponentAnalysis } from '../ast/component-analyzer';

export type PromptName = 'generate-suite.md' | 'generate-suite-component-object.md';

export type OutputFormat =
  | { kind: 'pom'; pagesDir: string; specsDir: string }
  | { kind: 'component-object'; specsDir: string };

export type ResolveInput = {
  analysis: ComponentAnalysis;
  config: ReactLensConfig;
};

export type ResolveOutput = {
  promptName: PromptName;
  outputFormat: OutputFormat;
};

export function resolveGenerationPrompt(input: ResolveInput): ResolveOutput {
  // analysis is accepted (and documented in the issue) so a future revision
  // can demote a CO request to POM for components with no props. Phase 2
  // does not exercise that branch — keeping the signature stable lets
  // phase 3+ add it without a delegate-side change.
  void input.analysis;

  if (input.config.pattern === 'component-object') {
    return {
      promptName: 'generate-suite-component-object.md',
      outputFormat: {
        kind: 'component-object',
        specsDir: input.config.output.specs,
      },
    };
  }
  return {
    promptName: 'generate-suite.md',
    outputFormat: {
      kind: 'pom',
      pagesDir: input.config.output.pages,
      specsDir: input.config.output.specs,
    },
  };
}
