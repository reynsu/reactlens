import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execa } from 'execa';
import { loadConfig } from '../config/load';
import { analyzeComponent } from '../ast/component-analyzer';
import { generateTests } from '../generator/delegate';
import { ReactLensError } from '../utils/errors';
import { logger } from '../utils/logger';
import { expandComponentGlobs, requireAnthropicApiKey } from './_shared';

export type GenerateCommandOptions = {
  cwd: string;
  pages?: string;
  skipTypecheck?: boolean;
};

export async function runGenerate(opts: GenerateCommandOptions): Promise<number> {
  const cwd = resolve(opts.cwd);
  const config = await loadConfig(cwd);
  requireAnthropicApiKey('generate');

  const patterns = opts.pages !== undefined ? [opts.pages] : config.componentGlobs;
  const components = await expandComponentGlobs(cwd, patterns);
  if (components.length === 0) {
    logger.warn({ patterns }, 'no components matched');
    return 0;
  }

  logger.info({ count: components.length }, 'analyzing components');
  let written = 0;
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
        onProgress: (e) => {
          if (e.kind === 'wrote') logger.info({ file: e.file }, 'wrote');
          else if (e.kind === 'tool') logger.debug({ tool: e.name }, 'tool call');
        },
      });
      written += result.filesWritten.length;
    } catch (err) {
      if (err instanceof ReactLensError) throw err;
      logger.error({ err, component: componentPath }, 'generation failed for component');
    }
  }

  if (opts.skipTypecheck !== true) {
    await runTscOnGenerated(cwd, config.output);
  }
  logger.info({ filesWritten: written }, 'generate complete');
  return 0;
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
