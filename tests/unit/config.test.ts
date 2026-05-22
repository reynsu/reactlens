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
    // v0.3 slice 6: pattern field. Default is 'pom' so existing setups don't
    // suddenly start emitting Component-Object specs.
    expect(cfg.pattern).toBe('pom');
  });

  it('accepts pattern: component-object', async () => {
    await writeFile(
      join(tmp, 'reactlens.config.ts'),
      `export default { pattern: 'component-object' };\n`,
    );
    const cfg = await loadConfig(tmp);
    expect(cfg.pattern).toBe('component-object');
  });

  it('rejects unknown pattern values', async () => {
    await writeFile(
      join(tmp, 'reactlens.config.ts'),
      `export default { pattern: 'cypress-mode' };\n`,
    );
    await expect(loadConfig(tmp)).rejects.toBeInstanceOf(ConfigError);
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

  describe('env overrides (REACTLENS_OUTPUT_SPECS / REACTLENS_OUTPUT_PAGES)', () => {
    // Operators (and the gated `co-generate-roundtrip` integration test in
    // #33 specifically) need to redirect generator output without editing
    // the user's reactlens.config.ts. The env knobs apply ON TOP of whatever
    // the config resolves to — including "no config file at all".

    const SAVED_SPECS = process.env.REACTLENS_OUTPUT_SPECS;
    const SAVED_PAGES = process.env.REACTLENS_OUTPUT_PAGES;

    afterEach(() => {
      // Restore so a single test never leaks state across the suite.
      if (SAVED_SPECS === undefined) delete process.env.REACTLENS_OUTPUT_SPECS;
      else process.env.REACTLENS_OUTPUT_SPECS = SAVED_SPECS;
      if (SAVED_PAGES === undefined) delete process.env.REACTLENS_OUTPUT_PAGES;
      else process.env.REACTLENS_OUTPUT_PAGES = SAVED_PAGES;
    });

    it('REACTLENS_OUTPUT_SPECS overrides output.specs when no config file is present', async () => {
      process.env.REACTLENS_OUTPUT_SPECS = 'tmp/specs-scratch';
      const cfg = await loadConfig(tmp);
      expect(cfg.output.specs).toBe('tmp/specs-scratch');
      // Other defaults untouched.
      expect(cfg.output.pages).toBe('e2e/pages');
    });

    it('REACTLENS_OUTPUT_SPECS overrides the config-file value', async () => {
      await writeFile(
        join(tmp, 'reactlens.config.ts'),
        `export default { output: { specs: 'e2e/specs', pages: 'e2e/pages' } };\n`,
      );
      process.env.REACTLENS_OUTPUT_SPECS = 'tmp/specs-scratch';
      const cfg = await loadConfig(tmp);
      expect(cfg.output.specs).toBe('tmp/specs-scratch');
      expect(cfg.output.pages).toBe('e2e/pages'); // config-file value preserved
    });

    it('REACTLENS_OUTPUT_PAGES overrides output.pages independently of specs', async () => {
      process.env.REACTLENS_OUTPUT_PAGES = 'tmp/pages-scratch';
      const cfg = await loadConfig(tmp);
      expect(cfg.output.pages).toBe('tmp/pages-scratch');
      expect(cfg.output.specs).toBe('e2e/specs');
    });

    it('empty-string env value is ignored (treated as unset, not as "")', async () => {
      process.env.REACTLENS_OUTPUT_SPECS = '';
      const cfg = await loadConfig(tmp);
      expect(cfg.output.specs).toBe('e2e/specs');
    });
  });
});
