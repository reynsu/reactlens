// Playwright global setup. Runs once before the test suite.
//
// Per-test instrumentation (probe injection, CDP screencast) lives in
// reactlens/fixtures.ts as auto fixtures — Playwright doesn't allow
// `test.beforeEach()` calls from config-time files like this one.
import type { FullConfig } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

function locateProbeBundle(): string | null {
  const candidates: string[] = [];
  const override = process.env.REACTLENS_PROBE_PATH;
  if (override !== undefined && override.length > 0) candidates.push(override);
  try {
    const pkg = require.resolve('reactlens/package.json');
    candidates.push(join(dirname(pkg), 'dist', 'probe', 'probe.global.js'));
  } catch {
    /* not installed as a package */
  }
  candidates.push(
    join(process.cwd(), 'node_modules', 'reactlens', 'dist', 'probe', 'probe.global.js'),
  );
  for (const p of candidates) {
    try {
      readFileSync(p);
      return p;
    } catch {
      /* try next */
    }
  }
  return null;
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  if (process.env.REACTLENS_WS_URL === undefined) return;
  if (locateProbeBundle() === null) {
    process.stderr.write('[reactlens] probe bundle not found; component capture disabled\n');
  }
}
