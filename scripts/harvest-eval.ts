// Harvest eval cases from a curated corpus (slice #12 of v0.3 #7).
//
// Reads harvest-corpus.json at the repo root, processes each entry:
//   1. Source: copy a local fixture OR `git clone` + `git checkout`
//      a real repo into a tmpdir.
//   2. Plant: apply the entry's planted-failure recipe in-place via
//      `applyPlantedFailure`.
//   3. Capture: read the planted component + the spec.
//   4. Emit: write a case directory under
//      tests/diagnostic-eval/cases/synthetic-from-corpus/<entryName>/case-<n>-<slug>/
//      via `emitHarvestedCase`. The case enters UNCURATED.
//
// Per ADR-0003 (sovereignty-first): no telemetry, no global state, no
// writes outside the repo. All transient state lives in a per-run
// mkdtempSync that is removed afterward.
//
// Usage:
//   pnpm tsx scripts/harvest-eval.ts                     # all entries
//   pnpm tsx scripts/harvest-eval.ts --entry counter-fixture
//   pnpm tsx scripts/harvest-eval.ts --manifest ./other-corpus.json
//   pnpm tsx scripts/harvest-eval.ts --out ./tmp-out      # override output root
//
// The smoke integration test in tests/integration/harvest-eval.test.ts
// imports `runHarvest()` directly and exercises the fixture path
// end-to-end. The CLI thin wrapper around it just parses argv.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { parseCorpusManifest, type CorpusEntry, type CorpusManifest } from '../src/eval/corpus-manifest';
import { applyPlantedFailure } from '../src/eval/planted-failure-applier';
import { emitHarvestedCase, type HarvestManifest } from '../src/eval/harvest-case-emitter';

export type RunHarvestOpts = {
  // Repo root — used to resolve manifestPath, localFixturePath, and
  // outputRoot when they're given as relative paths. Defaults to cwd().
  repoRoot?: string;
  // Path to harvest-corpus.json. Defaults to `<repoRoot>/harvest-corpus.json`.
  manifestPath?: string;
  // Output root for emitted case directories. Defaults to
  // `<repoRoot>/tests/diagnostic-eval/cases/synthetic-from-corpus`.
  outputRoot?: string;
  // If set, process only the entry with this name. Throws if no
  // entry matches — silent zero-iteration would be a footgun.
  entryName?: string;
};

export type HarvestRunResult = {
  emittedCaseDirs: string[];
  skippedEntries: string[];
};

// Slug-safe a name: lowercase, replace non-alnum with hyphens, trim.
// Used for the case-N-<slug> directory tail. The repo-slug component
// of the path comes verbatim from CorpusEntry.name (already validated
// non-empty by the schema).
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Decide the next case-N-<slug> directory under repoSlugDir. Existing
// case-* dirs are scanned to pick max(N)+1, so re-running the harvest
// adds cases instead of overwriting. Slug uses the planted-failure
// description so the dir name is self-descriptive on a `ls`.
function nextCaseDir(repoSlugDir: string, entry: CorpusEntry): string {
  const slug = slugify(entry.plantedFailure.description) || 'planted';
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
  return join(repoSlugDir, `case-${padded}-${slug}`);
}

// Copy the local fixture into a fresh tmpdir. Returns the tmpdir path.
function sourceFromFixture(repoRoot: string, entry: CorpusEntry): string {
  const fixturePath = resolve(repoRoot, entry.localFixturePath!);
  if (!existsSync(fixturePath)) {
    throw new Error(
      `Corpus entry '${entry.name}': localFixturePath does not exist: ${fixturePath}. Fix harvest-corpus.json.`,
    );
  }
  const tmp = mkdtempSync(join(tmpdir(), `reactlens-harvest-${slugify(entry.name)}-`));
  cpSync(fixturePath, tmp, { recursive: true });
  return tmp;
}

// `git clone --depth 1` (or checkout a specific commit) into a tmpdir.
// Network-dependent path — exercised by operators, not by the smoke
// test. Errors propagate verbatim from git; we don't try to interpret
// them.
function sourceFromRealRepo(entry: CorpusEntry): string {
  const tmp = mkdtempSync(join(tmpdir(), `reactlens-harvest-${slugify(entry.name)}-`));
  // Shallow clone first for speed; if a specific commitSha is requested
  // we unshallow + checkout. Keeps the common case (HEAD of default
  // branch) cheap.
  execSync(`git clone --depth 1 ${JSON.stringify(entry.repoUrl)} ${JSON.stringify(tmp)}`, {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (entry.commitSha !== undefined) {
    execSync(`git fetch --depth 1 origin ${entry.commitSha}`, { cwd: tmp, stdio: 'inherit' });
    execSync(`git checkout ${entry.commitSha}`, { cwd: tmp, stdio: 'inherit' });
  }
  return tmp;
}

function processEntry(
  entry: CorpusEntry,
  repoRoot: string,
  outputRoot: string,
): string {
  // 1. Source.
  const sourceMode = entry.localFixturePath !== undefined ? 'local-fixture' : 'real-clone';
  const sourceDir = sourceMode === 'local-fixture'
    ? sourceFromFixture(repoRoot, entry)
    : sourceFromRealRepo(entry);

  try {
    // 2. Plant.
    applyPlantedFailure(sourceDir, entry.plantedFailure);

    // 3. Capture.
    const componentAbs = join(sourceDir, entry.candidateComponent);
    const specAbs = join(sourceDir, entry.candidateSpec);
    if (!existsSync(componentAbs)) {
      throw new Error(`Corpus entry '${entry.name}': candidateComponent missing after plant: ${entry.candidateComponent}`);
    }
    if (!existsSync(specAbs)) {
      throw new Error(`Corpus entry '${entry.name}': candidateSpec missing after plant: ${entry.candidateSpec}`);
    }
    const componentSrc = readFileSync(componentAbs, 'utf8');
    const specSrc = readFileSync(specAbs, 'utf8');

    // 4. Emit.
    const repoSlugDir = join(outputRoot, slugify(entry.name));
    mkdirSync(repoSlugDir, { recursive: true });
    const caseDir = nextCaseDir(repoSlugDir, entry);
    mkdirSync(caseDir);

    const manifest: HarvestManifest = {
      entryName: entry.name,
      sourceRepo: entry.localFixturePath ?? entry.repoUrl ?? '<unknown>',
      sourceMode,
      plantedFailure: entry.plantedFailure,
      harvestedAt: new Date().toISOString(),
      ...(entry.commitSha !== undefined ? { commitSha: entry.commitSha } : {}),
    };

    emitHarvestedCase(caseDir, { componentSrc, specSrc, manifest });
    return caseDir;
  } finally {
    // Cleanup tmp source dir always — keeps ADR-0003 invariant
    // (nothing persisted outside the repo). Force + recursive
    // because cloned dirs include readonly .git internals on some
    // platforms (Windows runners) where rmSync's default refuses.
    rmSync(sourceDir, { recursive: true, force: true });
  }
}

export function runHarvest(opts: RunHarvestOpts = {}): HarvestRunResult {
  const repoRoot = opts.repoRoot ?? process.cwd();
  const manifestPath = opts.manifestPath ?? join(repoRoot, 'harvest-corpus.json');
  const outputRoot = opts.outputRoot
    ?? join(repoRoot, 'tests', 'diagnostic-eval', 'cases', 'synthetic-from-corpus');

  if (!existsSync(manifestPath)) {
    throw new Error(`harvest manifest not found at ${manifestPath}. Create harvest-corpus.json or pass --manifest.`);
  }
  const manifest: CorpusManifest = parseCorpusManifest(readFileSync(manifestPath, 'utf8'));

  // outputRoot is the directory under which per-entry subdirs land.
  // mkdir -p here (not inside emitHarvestedCase, which deliberately
  // throws on missing — that's the operator-error-catching surface).
  mkdirSync(outputRoot, { recursive: true });

  const targets = opts.entryName !== undefined
    ? manifest.entries.filter((e) => e.name === opts.entryName)
    : manifest.entries;
  if (opts.entryName !== undefined && targets.length === 0) {
    throw new Error(
      `--entry '${opts.entryName}' matched no corpus entries. Available: ${manifest.entries.map((e) => e.name).join(', ')}`,
    );
  }

  const emittedCaseDirs: string[] = [];
  const skippedEntries: string[] = [];
  for (const entry of targets) {
    try {
      const caseDir = processEntry(entry, repoRoot, outputRoot);
      emittedCaseDirs.push(caseDir);
    } catch (err) {
      // One bad entry should not abort the whole sweep — log and
      // continue. The script's exit code is non-zero if anything was
      // skipped, so CI can still notice.
      console.error(`✗ skipped entry '${entry.name}': ${(err as Error).message}`);
      skippedEntries.push(entry.name);
    }
  }
  return { emittedCaseDirs, skippedEntries };
}

// ─── CLI ──────────────────────────────────────────────────────────────
// Run as a script only when invoked directly (not when imported by the
// smoke test). The argv[1] check works across `node` and `tsx`.
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
  const result = runHarvest(opts);
  console.log(`emitted ${result.emittedCaseDirs.length} case(s):`);
  for (const d of result.emittedCaseDirs) console.log(`  ${d}`);
  if (result.skippedEntries.length > 0) {
    console.error(`skipped ${result.skippedEntries.length} entry/entries: ${result.skippedEntries.join(', ')}`);
    process.exit(1);
  }
}
