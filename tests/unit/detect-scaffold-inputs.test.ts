// Table tests for `detectScaffoldInputs` over temp dirs: build tool
// (vite/next/tanstack via package.json deps) × package manager (npm/pnpm/yarn
// via lockfile presence). Asserts port, devCommand, packageManager, router —
// the values that get baked into playwright.config.ts (ADR-0010 / issue #66).
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectScaffoldInputs } from '../../src/scaffold/detect-scaffold-inputs';

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'reactlens-scaffold-'));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

type DepSet = Record<string, string>;

async function writeProject(deps: DepSet, devDeps: DepSet, lockfile?: string): Promise<void> {
  await writeFile(
    join(tmp, 'package.json'),
    JSON.stringify({ name: 'app', private: true, dependencies: deps, devDependencies: devDeps }),
  );
  if (lockfile) await writeFile(join(tmp, lockfile), '');
}

const VITE = {
  label: 'vite',
  deps: { react: '^18', 'react-router-dom': '^6' } as DepSet,
  devDeps: { vite: '^5' } as DepSet,
  expectPort: 5173,
  expectRouter: 'react-router' as const,
};
const NEXT = {
  label: 'next',
  deps: { react: '^18', next: '^14' } as DepSet,
  devDeps: {} as DepSet,
  expectPort: 3000,
  expectRouter: 'next-app' as const,
};
const TANSTACK = {
  label: 'tanstack',
  deps: { react: '^18', '@tanstack/react-router': '^1' } as DepSet,
  devDeps: { vite: '^5' } as DepSet,
  expectPort: 5173,
  expectRouter: 'tanstack' as const,
};

const PMS = [
  { label: 'pnpm', lockfile: 'pnpm-lock.yaml', pm: 'pnpm' as const },
  { label: 'yarn', lockfile: 'yarn.lock', pm: 'yarn' as const },
  { label: 'npm', lockfile: undefined, pm: 'npm' as const },
];

describe('detectScaffoldInputs', () => {
  for (const tool of [VITE, NEXT, TANSTACK]) {
    for (const pm of PMS) {
      it(`${tool.label} + ${pm.label}`, async () => {
        await writeProject(tool.deps, tool.devDeps, pm.lockfile);
        const inputs = await detectScaffoldInputs(tmp);

        expect(inputs.devServerPort).toBe(tool.expectPort);
        expect(inputs.baseURL).toBe(`http://localhost:${tool.expectPort}`);
        expect(inputs.packageManager).toBe(pm.pm);
        expect(inputs.router).toBe(tool.expectRouter);
        expect(inputs.reactVersion).toBe('^18');
        expect(inputs.testDir).toBe('e2e/specs');

        // Next runs `next dev` directly; everything else defers to the pm.
        if (tool.label === 'next') {
          expect(inputs.devCommand).toBe('next dev');
        } else if (pm.pm === 'npm') {
          expect(inputs.devCommand).toBe('npm run dev');
        } else {
          expect(inputs.devCommand).toBe(`${pm.pm} dev`);
        }
      });
    }
  }

  it('falls back to vite port when the build tool is unknown', async () => {
    await writeProject({ react: '^18' }, {}, 'pnpm-lock.yaml');
    const inputs = await detectScaffoldInputs(tmp);
    expect(inputs.devServerPort).toBe(5173);
    expect(inputs.baseURL).toBe('http://localhost:5173');
    expect(inputs.devCommand).toBe('pnpm dev');
  });

  describe('componentGlobs heuristic (issue #71)', () => {
    async function writeTsx(relDir: string): Promise<void> {
      await mkdir(join(tmp, relDir), { recursive: true });
      await writeFile(join(tmp, relDir, 'Widget.tsx'), 'export const Widget = () => null;\n');
    }

    it('seeds app/**/*.tsx for a Next.js App Router project', async () => {
      await writeProject(NEXT.deps, NEXT.devDeps, 'pnpm-lock.yaml');
      await writeTsx('app');
      const inputs = await detectScaffoldInputs(tmp);
      expect(inputs.router).toBe('next-app');
      expect(inputs.componentGlobs).toContain('app/**/*.tsx');
    });

    it('seeds src/components when components live only there', async () => {
      await writeProject(VITE.deps, VITE.devDeps, 'pnpm-lock.yaml');
      await writeTsx('src/components');
      const inputs = await detectScaffoldInputs(tmp);
      expect(inputs.componentGlobs).toEqual(['src/components/**/*.tsx']);
    });

    it('seeds top-level components/ and pages/ when present', async () => {
      await writeProject(VITE.deps, VITE.devDeps, 'pnpm-lock.yaml');
      await writeTsx('components');
      await writeTsx('pages');
      const inputs = await detectScaffoldInputs(tmp);
      expect(inputs.componentGlobs).toEqual(['pages/**/*.tsx', 'components/**/*.tsx']);
    });

    it('detects .tsx nested below the candidate directory', async () => {
      await writeProject(VITE.deps, VITE.devDeps, 'pnpm-lock.yaml');
      await writeTsx('src/components/forms/inputs');
      const inputs = await detectScaffoldInputs(tmp);
      expect(inputs.componentGlobs).toEqual(['src/components/**/*.tsx']);
    });

    it('ignores a candidate directory that has no .tsx files', async () => {
      await writeProject(VITE.deps, VITE.devDeps, 'pnpm-lock.yaml');
      await mkdir(join(tmp, 'src/components'), { recursive: true });
      await writeFile(join(tmp, 'src/components', 'util.ts'), 'export const x = 1;\n');
      await writeTsx('src/pages');
      const inputs = await detectScaffoldInputs(tmp);
      expect(inputs.componentGlobs).toEqual(['src/pages/**/*.tsx']);
    });

    it('falls back to the default globs when no component dir is found', async () => {
      await writeProject(VITE.deps, VITE.devDeps, 'pnpm-lock.yaml');
      const inputs = await detectScaffoldInputs(tmp);
      expect(inputs.componentGlobs).toEqual(['src/pages/**/*.tsx', 'src/components/**/*.tsx']);
    });
  });
});
