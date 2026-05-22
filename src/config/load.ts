import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { z } from 'zod';
import { reactlensConfigSchema, type ReactLensConfig } from './schema';
import { ReactLensError } from '../utils/errors';

export class ConfigError extends ReactLensError {
  constructor(message: string, opts: { cause?: unknown } = {}) {
    super(message, {
      code: 'REACTLENS_CONFIG_ERROR',
      ...opts,
    });
  }
}

const CANDIDATE_FILES = [
  'reactlens.config.ts',
  'reactlens.config.mts',
  'reactlens.config.js',
  'reactlens.config.mjs',
  'reactlens.config.cjs',
];

function findConfigFile(cwd: string): string | undefined {
  for (const name of CANDIDATE_FILES) {
    const candidate = join(cwd, name);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

async function importConfigModule(filePath: string): Promise<unknown> {
  const fileUrl = pathToFileURL(filePath).href;
  // Prefer the host loader (vitest in tests, tsx-cli in dev). Fall back to
  // tsx's programmatic API for plain `node` runs of the compiled CJS bundle,
  // which can't natively import .ts.
  if (filePath.endsWith('.ts') || filePath.endsWith('.mts')) {
    try {
      return await import(fileUrl);
    } catch {
      const tsx = (await import('tsx/esm/api')) as {
        tsImport: (specifier: string, parentURL: string) => Promise<unknown>;
      };
      return await tsx.tsImport(fileUrl, pathToFileURL(__filename).href);
    }
  }
  return import(fileUrl);
}

function unwrapModule(mod: unknown): unknown {
  if (mod === null || typeof mod !== 'object') return mod;
  const m = mod as { default?: unknown };
  return m.default !== undefined ? m.default : mod;
}

function formatZodError(err: z.ZodError): string {
  const lines = err.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
    return `  - ${path}: ${issue.message}`;
  });
  return `invalid reactlens config:\n${lines.join('\n')}`;
}

// Env knobs that override config-file (or default) values AFTER Zod parsing.
// Tiny surface intentionally — only the fields operators actually need to
// flip at the command line without editing their reactlens.config.ts.
//
// Empty-string is treated as unset so accidental `export REACTLENS_OUTPUT_SPECS=`
// (or shell scripts that produce a blank value) don't silently break the
// generator. Adding fields here means documenting them too — see README.
type EnvOverride = {
  envVar: string;
  apply: (cfg: ReactLensConfig, value: string) => void;
};

const ENV_OVERRIDES: EnvOverride[] = [
  {
    envVar: 'REACTLENS_OUTPUT_SPECS',
    apply: (cfg, value) => {
      cfg.output.specs = value;
    },
  },
  {
    envVar: 'REACTLENS_OUTPUT_PAGES',
    apply: (cfg, value) => {
      cfg.output.pages = value;
    },
  },
];

function applyEnvOverrides(cfg: ReactLensConfig): ReactLensConfig {
  for (const { envVar, apply } of ENV_OVERRIDES) {
    const raw = process.env[envVar];
    if (raw === undefined || raw.length === 0) continue;
    apply(cfg, raw);
  }
  return cfg;
}

export async function loadConfig(cwd: string): Promise<ReactLensConfig> {
  const file = findConfigFile(cwd);
  if (file === undefined) {
    return applyEnvOverrides(reactlensConfigSchema.parse({}));
  }
  let raw: unknown;
  try {
    raw = unwrapModule(await importConfigModule(file));
  } catch (err) {
    throw new ConfigError(`failed to load ${file}: ${(err as Error).message}`, { cause: err });
  }
  const parsed = reactlensConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(formatZodError(parsed.error));
  }
  return applyEnvOverrides(parsed.data);
}
