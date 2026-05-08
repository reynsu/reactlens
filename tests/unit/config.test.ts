import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config/load';

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'reactlens-config-'));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('returns defaults when no config file is present', async () => {
    const cfg = await loadConfig(tmp);
    expect(cfg.dashboard.port).toBe(7777);
    expect(cfg.dashboard.open).toBe(true);
    expect(cfg.output.pages).toBe('e2e/pages');
    expect(cfg.componentGlobs.length).toBeGreaterThan(0);
  });

  it('loads a valid .ts config and merges with defaults', async () => {
    await writeFile(
      join(tmp, 'reactlens.config.ts'),
      `export default { dashboard: { port: 8080 } };\n`,
    );
    const cfg = await loadConfig(tmp);
    expect(cfg.dashboard.port).toBe(8080);
    expect(cfg.dashboard.open).toBe(true); // default preserved
  });

  it('throws ConfigError on invalid shape', async () => {
    await writeFile(
      join(tmp, 'reactlens.config.ts'),
      `export default { dashboard: { port: 'not-a-number' } };\n`,
    );
    await expect(loadConfig(tmp)).rejects.toBeInstanceOf(ConfigError);
  });

  it('error message includes the offending key', async () => {
    await writeFile(
      join(tmp, 'reactlens.config.ts'),
      `export default { dashboard: { port: 99999999 } };\n`,
    );
    try {
      await loadConfig(tmp);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as Error).message).toMatch(/dashboard\.port/);
    }
  });

  it('wraps load errors with file context', async () => {
    await writeFile(join(tmp, 'reactlens.config.ts'), `throw new Error('boom');\n`);
    await expect(loadConfig(tmp)).rejects.toBeInstanceOf(ConfigError);
  });
});
