// Persists per-test component snapshots to disk. Used by `reactlens run
// --save-snapshots-to <dir>` to harvest real bridge captures for the
// diagnostic-eval set (and any other regression-testing workflow that
// wants the same shape on disk).
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ComponentNode } from './events';

export type PersistableTest = {
  id: string;
  title: string;
  file: string;
  snapshot?: ComponentNode;
};

export type PersistOptions = {
  outDir: string;
  tests: Iterable<PersistableTest>;
  // When true, also writes manifest.json mapping testId → { title, file,
  // hasSnapshot }. Useful for downstream consumers that need to correlate
  // snapshot files back to specs.
  writeManifest?: boolean;
};

export type PersistResult = {
  written: string[];
  skipped: string[];
};

export async function persistSnapshots(opts: PersistOptions): Promise<PersistResult> {
  await mkdir(opts.outDir, { recursive: true });

  const written: string[] = [];
  const skipped: string[] = [];
  const manifest: Record<string, { title: string; file: string; hasSnapshot: boolean }> = {};

  for (const t of opts.tests) {
    manifest[t.id] = { title: t.title, file: t.file, hasSnapshot: t.snapshot !== undefined };
    if (t.snapshot === undefined) {
      skipped.push(t.id);
      continue;
    }
    const path = join(opts.outDir, `${t.id}.json`);
    await writeFile(path, JSON.stringify(t.snapshot, null, 2));
    written.push(path);
  }

  if (opts.writeManifest === true) {
    await writeFile(join(opts.outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  }

  return { written, skipped };
}
