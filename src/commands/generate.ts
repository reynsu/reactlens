import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execa } from 'execa';
import { CostTracker, withCostTracking } from '../agent/cost';
import { pickAgentRunner } from '../agent/select';
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
};

export async function runGenerate(opts: GenerateCommandOptions): Promise<number> {
  const cwd = resolve(opts.cwd);
  const config = await loadConfig(cwd);
  const baseAgent = await pickAgentRunner({
    commandName: 'generate',
    useClaudeCode: opts.useClaudeCode,
    forceApi: opts.forceApi,
  });
  const tracker = new CostTracker(opts.maxCost !== undefined ? { maxUsd: opts.maxCost } : {});
  const agent = withCostTracking(baseAgent, tracker);

  const patterns = opts.pages !== undefined ? [opts.pages] : config.componentGlobs;
  const components = await expandComponentGlobs(cwd, patterns);
  if (components.length === 0) {
    logger.warn({ patterns }, 'no components matched');
    return 0;
  }

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
        mswHandlers: config.msw.handlers,
        agent,
        onProgress: (e) => {
          if (e.kind === 'wrote') logger.info({ file: e.file }, 'wrote');
          else if (e.kind === 'tool') logger.debug({ tool: e.name }, 'tool call');
        },
      });
      written += result.filesWritten.length;
      // P11: write the behavior contract alongside the spec. Best-effort —
      // a write failure here doesn't fail generation; the spec itself is
      // already on disk and useful without the contract.
      await writeContract(cwd, config.output.specs, analysis).then(
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

async function writeContract(cwd: string, specsDir: string, analysis: ComponentAnalysis): Promise<string> {
  const dir = resolve(cwd, specsDir);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${analysis.componentName}.contract.md`);
  const generatedAt = new Date().toISOString().slice(0, 10);
  await writeFile(path, renderContract(analysis, { generatedAt }), 'utf8');
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
