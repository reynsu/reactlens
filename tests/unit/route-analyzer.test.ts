import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectStack } from '../../src/ast/route-analyzer';

const FIXTURES_ROOT = join(__dirname, '..', 'fixtures');

describe('detectStack', () => {
  it('detects vite + react-router fixture', async () => {
    const stack = await detectStack(join(FIXTURES_ROOT, 'vite-react-router'));
    expect(stack.router).toBe('react-router');
    expect(stack.buildTool).toBe('vite');
    expect(stack.devServerPort).toBe(5173);
    expect(stack.formLibrary).toBe('react-hook-form');
    expect(stack.reactVersion).toMatch(/18/);
  });

  it('detects next app-router fixture', async () => {
    const stack = await detectStack(join(FIXTURES_ROOT, 'next-app-router'));
    expect(stack.router).toBe('next-app');
    expect(stack.buildTool).toBe('next');
    expect(stack.devServerPort).toBe(3000);
  });

  it('detects tanstack-router fixture', async () => {
    const stack = await detectStack(join(FIXTURES_ROOT, 'tanstack-router'));
    expect(stack.router).toBe('tanstack');
    expect(stack.buildTool).toBe('vite');
  });

  describe('robustness', () => {
    let tmp: string;
    beforeEach(async () => {
      tmp = await mkdtemp(join(tmpdir(), 'reactlens-detect-'));
    });
    afterEach(async () => {
      await rm(tmp, { recursive: true, force: true });
    });

    it('returns unknowns when package.json is missing', async () => {
      const stack = await detectStack(tmp);
      expect(stack.router).toBe('unknown');
      expect(stack.buildTool).toBe('unknown');
      expect(stack.uiLibrary).toBe('unknown');
      expect(stack.formLibrary).toBe('unknown');
      expect(stack.reactVersion).toBe('unknown');
      expect(stack.devServerPort).toBeUndefined();
    });

    it('returns unknowns when package.json is malformed', async () => {
      await writeFile(join(tmp, 'package.json'), '{ not json');
      const stack = await detectStack(tmp);
      expect(stack.router).toBe('unknown');
    });

    it('falls back to vite.config.ts marker file', async () => {
      await writeFile(join(tmp, 'package.json'), JSON.stringify({}));
      await writeFile(join(tmp, 'vite.config.ts'), '');
      const stack = await detectStack(tmp);
      expect(stack.buildTool).toBe('vite');
      expect(stack.devServerPort).toBe(5173);
    });

    it('distinguishes next pages-router via /pages directory', async () => {
      await writeFile(
        join(tmp, 'package.json'),
        JSON.stringify({ dependencies: { next: '^14', react: '^18' } }),
      );
      await mkdir(join(tmp, 'pages'));
      const stack = await detectStack(tmp);
      expect(stack.router).toBe('next-pages');
    });
  });
});
