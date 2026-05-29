import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execa } from 'execa';
import { prepareAgent } from '../agent/select';
import { loadConfig } from '../config/load';
import { analyzeComponent, type ComponentAnalysis } from '../ast/component-analyzer';
import { renderContract } from '../generator/contract';
import { generateTests } from '../generator/delegate';
import { ReactLensError } from '../utils/errors';
import { logger } from '../utils/logger';
import { expandComponentGlobs } from './_shared';

export type GenerateCommandOptions = {
  cwd: string;
  pages?: string;
  skipTypecheck?: boolean;
  useClaudeCode?: boolean;
  forceApi?: boolean;
  // Hard cap on aggregate USD across all query() calls. The decorator throws
  // AGENT_COST_EXCEEDED at the next message boundary once the cap is hit.
  maxCost?: number;
  // v0.3 slice 6: --pattern flag overrides config.pattern. 'pom' generates
  // Page-Object specs; 'component-object' emits specs that assert via the
  // Component() helper. Phase 1 wires the flag through; phase 2 wires the
  // generator branch that actually emits CO specs.
  pattern?: 'pom' | 'component-object';
};

export async function runGenerate(opts: GenerateCommandOptions): Promise<number> {
  const cwd = resolve(opts.cwd);
  const config = await loadConfig(cwd);
  const effectivePattern = opts.pattern ?? config.pattern;
  logger.info({ pattern: effectivePattern }, 'generate pattern resolved');

  // Resolve the component set BEFORE acquiring an agent: a no-match is a
  // config error, not an agent error, and failing here keeps the message
  // pointed at componentGlobs instead of (e.g.) missing credentials.
  const patterns = opts.pages !== undefined ? [opts.pages] : config.componentGlobs;
  const components = await expandComponentGlobs(cwd, patterns);
  if (components.length === 0) {
    throw new ReactLensError(
      `No components matched the glob${patterns.length === 1 ? '' : 's'} ${patterns
        .map((p) => `"${p}"`)
        .join(', ')}. Check \`componentGlobs\` in reactlens.config.ts (or the --pages flag) and confirm the patterns point at your component files.`,
      { code: 'GENERATE_NO_COMPONENTS' },
    );
  }

  const { agent, tracker } = await prepareAgent({
    commandName: 'generate',
    useClaudeCode: opts.useClaudeCode,
    forceApi: opts.forceApi,
    maxCost: opts.maxCost,
  });

  logger.info({ count: components.length }, 'analyzing components');
  let written = 0;
  let contractsWritten = 0;
  for (const componentPath of components) {
    try {
      const analysis = analyzeComponent(componentPath);
      logger.info({ component: analysis.componentName, states: analysis.states.length }, 'generating tests');
      const result = await generateTests({
        cwd,
        componentPath,
        analysis,
        outputs: config.output,
        agent,
        // Phase 2: the delegate uses this to branch POM vs CO. CLI --pattern
        // overrides config.pattern; we merge here so the delegate sees the
        // resolved value as if it were the config.
        config: { pattern: effectivePattern, output: config.output },
        onProgress: (e) => {
          if (e.kind === 'wrote') logger.info({ file: e.file }, 'wrote');
          else if (e.kind === 'tool') logger.debug({ tool: e.name }, 'tool call');
        },
      });
      written += result.filesWritten.length;
      // P11: write the behavior contract alongside the spec. Best-effort —
      // a write failure here doesn't fail generation; the spec itself is
      // already on disk and useful without the contract.
      await writeContract(cwd, config.output.specs, analysis, effectivePattern).then(
        (path) => {
          contractsWritten += 1;
          logger.info({ file: path }, 'wrote contract');
        },
        (err: unknown) =>
          logger.warn({ err, component: analysis.componentName }, 'contract write failed'),
      );
    } catch (err) {
      if (err instanceof ReactLensError) throw err;
      logger.error({ err, component: componentPath }, 'generation failed for component');
    }
  }

  if (opts.skipTypecheck !== true) {
    await runTscOnGenerated(cwd, config.output);
  }
  const total = tracker.total();
  if (total.calls > 0) logger.info({ cost: total }, 'agent cost summary');
  logger.info({ filesWritten: written, contractsWritten }, 'generate complete');
  return 0;
}

async function writeContract(
  cwd: string,
  specsDir: string,
  analysis: ComponentAnalysis,
  pattern: 'pom' | 'component-object',
): Promise<string> {
  const dir = resolve(cwd, specsDir);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${analysis.componentName}.contract.md`);
  const generatedAt = new Date().toISOString().slice(0, 10);
  await writeFile(path, renderContract(analysis, { generatedAt, pattern }), 'utf8');
  return path;
}

async function runTscOnGenerated(cwd: string, output: { pages: string; specs: string }): Promise<void> {
  const targetTs = join(cwd, 'tsconfig.json');
  if (!existsSync(targetTs)) {
    logger.info('no tsconfig.json found; skipping typecheck of generated tests');
    return;
  }
  try {
    await execa('npx', ['tsc', '--noEmit', '-p', targetTs], { cwd, stdio: 'inherit' });
  } catch (err) {
    logger.warn({ err }, 'tsc reported errors in generated tests; review and re-run');
  }
}
