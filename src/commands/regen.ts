// Incremental regeneration: only regenerate tests for components whose source
// file content hash has changed since the last run. Cache lives at
// `.reactlens/cache.json` in the project.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { CostTracker, withCostTracking } from '../agent/cost';
import { pickAgentRunner } from '../agent/select';
import { loadConfig } from '../config/load';
import { analyzeComponent } from '../ast/component-analyzer';
import { generateTests } from '../generator/delegate';
import { logger } from '../utils/logger';
import { expandComponentGlobs } from './_shared';

type CacheShape = { version: 1; hashes: Record<string, string> };

async function hashFile(path: string): Promise<string> {
  const content = await readFile(path);
  return createHash('sha256').update(content).digest('hex');
}

async function loadCache(cwd: string): Promise<CacheShape> {
  const path = join(cwd, '.reactlens', 'cache.json');
  if (!existsSync(path)) return { version: 1, hashes: {} };
  const raw = await readFile(path, 'utf8');
  try {
    return JSON.parse(raw) as CacheShape;
  } catch {
    return { version: 1, hashes: {} };
  }
}

async function saveCache(cwd: string, cache: CacheShape): Promise<void> {
  const path = join(cwd, '.reactlens', 'cache.json');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(cache, null, 2));
}

export async function runRegen(opts: { cwd: string; useClaudeCode?: boolean; forceApi?: boolean; maxCost?: number }): Promise<number> {
  const cwd = resolve(opts.cwd);
  const config = await loadConfig(cwd);
  const baseAgent = await pickAgentRunner({
    commandName: 'regen',
    useClaudeCode: opts.useClaudeCode,
    forceApi: opts.forceApi,
  });
  const tracker = new CostTracker(opts.maxCost !== undefined ? { maxUsd: opts.maxCost } : {});
  const agent = withCostTracking(baseAgent, tracker);

  const components = await expandComponentGlobs(cwd, config.componentGlobs);
  const cache = await loadCache(cwd);
  const next: CacheShape = { version: 1, hashes: { ...cache.hashes } };
  let regenerated = 0;

  for (const componentPath of components) {
    const hash = await hashFile(componentPath);
    if (cache.hashes[componentPath] === hash) {
      logger.debug({ component: componentPath }, 'unchanged; skipping');
      continue;
    }
    const analysis = analyzeComponent(componentPath);
    logger.info({ component: analysis.componentName }, 'regenerating');
    await generateTests({
      cwd,
      componentPath,
      analysis,
      outputs: config.output,
      mswHandlers: config.msw.handlers,
      agent,
    });
    next.hashes[componentPath] = hash;
    regenerated += 1;
  }

  await saveCache(cwd, next);
  const total = tracker.total();
  if (total.calls > 0) logger.info({ cost: total }, 'agent cost summary');
  logger.info({ regenerated, total: components.length }, 'regen complete');
  return 0;
}
