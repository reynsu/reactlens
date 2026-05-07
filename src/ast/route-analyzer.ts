// Lives under ast/ because Phase 1 only sniffs package.json + marker files,
// but later phases will use ts-morph here to statically discover routes from
// router config files. Keeping both behaviors colocated avoids a future move.
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

export type Router =
  | 'react-router'
  | 'tanstack'
  | 'next-app'
  | 'next-pages'
  | 'unknown';

export type BuildTool = 'vite' | 'next' | 'webpack' | 'unknown';

export type DetectedStack = {
  router: Router;
  uiLibrary: string;
  formLibrary: string;
  devServerPort: number | undefined;
  buildTool: BuildTool;
  reactVersion: string;
};

type PackageJsonShape = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

const UNKNOWN = 'unknown';

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function readPackageJson(projectPath: string): Promise<PackageJsonShape> {
  try {
    const raw = await fs.readFile(join(projectPath, 'package.json'), 'utf8');
    return JSON.parse(raw) as PackageJsonShape;
  } catch {
    return {};
  }
}

function allDeps(pkg: PackageJsonShape): Record<string, string> {
  return { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
}

async function detectRouter(projectPath: string, deps: Record<string, string>): Promise<Router> {
  if ('next' in deps) {
    if (await exists(join(projectPath, 'app'))) return 'next-app';
    if (await exists(join(projectPath, 'src', 'app'))) return 'next-app';
    if (await exists(join(projectPath, 'pages'))) return 'next-pages';
    return 'next-app';
  }
  if ('@tanstack/react-router' in deps) return 'tanstack';
  if ('react-router' in deps || 'react-router-dom' in deps) return 'react-router';
  return 'unknown';
}

async function detectBuildTool(projectPath: string, deps: Record<string, string>): Promise<BuildTool> {
  if ('next' in deps) return 'next';
  if ('vite' in deps) return 'vite';
  if (await exists(join(projectPath, 'vite.config.ts'))) return 'vite';
  if (await exists(join(projectPath, 'vite.config.js'))) return 'vite';
  if (await exists(join(projectPath, 'next.config.js'))) return 'next';
  if (await exists(join(projectPath, 'next.config.mjs'))) return 'next';
  if ('webpack' in deps) return 'webpack';
  return 'unknown';
}

function detectUiLibrary(deps: Record<string, string>): string {
  const candidates = [
    '@mui/material',
    '@chakra-ui/react',
    '@radix-ui/themes',
    '@mantine/core',
    'antd',
    '@nextui-org/react',
    'tailwindcss',
  ];
  for (const c of candidates) {
    if (c in deps) return c;
  }
  return UNKNOWN;
}

function detectFormLibrary(deps: Record<string, string>): string {
  const candidates = ['react-hook-form', 'formik', '@tanstack/react-form', 'final-form'];
  for (const c of candidates) {
    if (c in deps) return c;
  }
  return UNKNOWN;
}

function detectDevServerPort(buildTool: BuildTool): number | undefined {
  if (buildTool === 'vite') return 5173;
  if (buildTool === 'next') return 3000;
  return undefined;
}

function detectReactVersion(deps: Record<string, string>): string {
  return deps['react'] ?? UNKNOWN;
}

export async function detectStack(projectPath: string): Promise<DetectedStack> {
  const pkg = await readPackageJson(projectPath);
  const deps = allDeps(pkg);
  const buildTool = await detectBuildTool(projectPath, deps);
  return {
    router: await detectRouter(projectPath, deps),
    uiLibrary: detectUiLibrary(deps),
    formLibrary: detectFormLibrary(deps),
    devServerPort: detectDevServerPort(buildTool),
    buildTool,
    reactVersion: detectReactVersion(deps),
  };
}
