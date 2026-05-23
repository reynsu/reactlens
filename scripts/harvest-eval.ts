// `scripts/harvest-eval.ts` — CLI wrapper around CorpusSource.
//
// Post-HarvestSource-migration: the per-entry pipeline (sandbox → plant →
// capture) lives in `src/eval/corpus-source.ts`. This script is the
// CLI + the per-artifact disk-emission loop (path convention + mkdir +
// emitHarvestedCase). The `runHarvest()` export preserves its
// pre-migration signature so `tests/integration/harvest-eval.test.ts`
// works unchanged.
//
// Per HarvestSource design pick (i): the Source is build-only; this
// script is the disk-I/O caller. Path convention:
//   <outputRoot>/<entry-slug>/case-NNN-<plant-slug>/
// (incrementing N so re-running adds case-002 rather than overwriting.)
//
// Usage:
//   pnpm tsx scripts/harvest-eval.ts                     # all entries
//   pnpm tsx scripts/harvest-eval.ts --entry counter-fixture
//   pnpm tsx scripts/harvest-eval.ts --manifest ./other-corpus.json
//   pnpm tsx scripts/harvest-eval.ts --out ./tmp-out      # override output root
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CorpusSource } from '../src/eval/corpus-source';
import {
  emitHarvestedCase,
  type HarvestArtifacts,
} from '../src/eval/harvest-case-emitter';
import { slugify } from '../src/eval/slug';

export type RunHarvestOpts = {
  repoRoot?: string;
  manifestPath?: string;
  outputRoot?: string;
  entryName?: string;
};

export type HarvestRunResult = {
  emittedCaseDirs: string[];
  skippedEntries: string[];
};

// Decide the next case-NNN-<plant-slug> directory under repoSlugDir.
// Existing case-* dirs are scanned to pick max(N)+1, so re-running the
// harvest adds cases instead of overwriting. Slug uses the planted-
// failure description so the dir name is self-descriptive on a `ls`.
function nextCaseDir(repoSlugDir: string, art: HarvestArtifacts): string {
  const description = art.manifest.plantedFailure?.description ?? 'planted';
  const plantSlug = slugify(description, 'planted');
  let nextN = 1;
  if (existsSync(repoSlugDir)) {
    const existing = readdirSync(repoSlugDir).filter((n) => /^case-\d+-/.test(n));
    for (const dirName of existing) {
      const m = dirName.match(/^case-(\d+)-/);
      if (m) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n >= nextN) nextN = n + 1;
      }
    }
  }
  const padded = String(nextN).padStart(3, '0');
  return join(repoSlugDir, `case-${padded}-${plantSlug}`);
}

export async function runHarvest(opts: RunHarvestOpts = {}): Promise<HarvestRunResult> {
  const repoRoot = opts.repoRoot ?? process.cwd();
  const outputRoot = opts.outputRoot
    ?? join(repoRoot, 'tests', 'diagnostic-eval', 'cases', 'synthetic-from-corpus');

  mkdirSync(outputRoot, { recursive: true });

  const source = new CorpusSource({
    repoRoot,
    ...(opts.manifestPath !== undefined ? { manifestPath: opts.manifestPath } : {}),
    ...(opts.entryName !== undefined ? { entryName: opts.entryName } : {}),
  });

  const emittedCaseDirs: string[] = [];
  for await (const art of source.iterate()) {
    const repoSlugDir = join(outputRoot, slugify(art.manifest.entryName));
    mkdirSync(repoSlugDir, { recursive: true });
    const caseDir = nextCaseDir(repoSlugDir, art);
    mkdirSync(caseDir);
    emitHarvestedCase(caseDir, art);
    emittedCaseDirs.push(caseDir);
  }

  // entry-name-no-match throws here (operator UX preserved from the
  // pre-extraction script — silent zero-iteration would be a footgun).
  if (source.describeWhyEmpty() === 'entry-name-no-match') {
    // Reconstruct the original error message format for back-compat
    // with the integration test (`.toThrow(/matched no corpus entries/)`).
    throw new Error(
      `--entry '${opts.entryName ?? ''}' matched no corpus entries.`,
    );
  }

  return {
    emittedCaseDirs,
    skippedEntries: source.getSkippedEntries().map((s) => s.name),
  };
}

// ─── CLI ──────────────────────────────────────────────────────────────
// Run as a script only when invoked directly (not when imported by the
// integration test). The argv[1] check works across `node` and `tsx`.
const invokedAsScript = (() => {
  try {
    return process.argv[1] !== undefined && process.argv[1].endsWith('harvest-eval.ts');
  } catch {
    return false;
  }
})();

if (invokedAsScript) {
  const argv = process.argv.slice(2);
  const opts: RunHarvestOpts = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--entry' && v !== undefined) { opts.entryName = v; i++; }
    else if (k === '--manifest' && v !== undefined) { opts.manifestPath = resolve(v); i++; }
    else if (k === '--out' && v !== undefined) { opts.outputRoot = resolve(v); i++; }
    else if (k === '--help' || k === '-h') {
      console.log('usage: pnpm tsx scripts/harvest-eval.ts [--entry NAME] [--manifest PATH] [--out DIR]');
      process.exit(0);
    } else {
      console.error(`unknown arg: ${k}`);
      process.exit(2);
    }
  }
  runHarvest(opts)
    .then((result) => {
      console.log(`emitted ${result.emittedCaseDirs.length} case(s):`);
      for (const d of result.emittedCaseDirs) console.log(`  ${d}`);
      if (result.skippedEntries.length > 0) {
        console.error(
          `skipped ${result.skippedEntries.length} entry/entries: ${result.skippedEntries.join(', ')}`,
        );
        process.exit(1);
      }
    })
    .catch((err: unknown) => {
      console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
      process.exit(2);
    });
}
