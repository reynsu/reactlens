// CorpusSource — HarvestSource adapter that reads a corpus manifest
// (`harvest-corpus.json` by default), processes each entry's recipe
// (copy local fixture OR `git clone` a real repo, apply the planted
// failure, capture component + spec source), and yields one
// HarvestArtifacts per successfully processed entry.
//
// Extracted from `scripts/harvest-eval.ts` in the HarvestSource
// migration. The script keeps a thin `runHarvest()` wrapper + the CLI
// argv parsing on top of this Source so the existing integration test
// (tests/integration/harvest-eval.test.ts) continues to work unchanged.
//
// Per HarvestSource design pick (i): the Source does NOT write to disk
// inside the repo. It DOES use `mkdtempSync` for the per-entry sandbox
// (clone / fixture copy / plant) — that's transient OS-tmp state cleaned
// up before the artifact is yielded.
//
// Per ADR-0003: no telemetry, no global state, no writes inside the repo.
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { parseCorpusManifest, type CorpusEntry } from './corpus-manifest';
import { applyPlantedFailure } from './planted-failure-applier';
import type {
  HarvestArtifacts,
  HarvestManifest,
  HarvestSource,
} from './harvest-source';
import { slugify } from './slug';

export type CorpusSourceOpts = {
  // Repo root — used to resolve `manifestPath` and `localFixturePath`
  // when they're given as relative paths. Defaults to cwd().
  repoRoot?: string;
  // Path to the corpus manifest JSON. Defaults to
  // `<repoRoot>/harvest-corpus.json`.
  manifestPath?: string;
  // If set, process only the entry with this name. iterate() will
  // yield zero artifacts and describeWhyEmpty() will return
  // 'entry-name-no-match' if no entry matches — caller decides
  // whether that's an error condition (CLI wrappers usually throw).
  entryName?: string;
};

export type SkippedEntry = {
  name: string;
  reason: string;
};

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
// Network-dependent path — exercised by operators, not by unit tests
// (which use the fixture path). Errors propagate verbatim from git.
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

// Process one entry through the sandbox → plant → capture pipeline.
// Returns the HarvestArtifacts (caller decides where to land it on disk).
// The tmpdir is cleaned up in a `finally` so a thrown plant error
// doesn't leak transient state.
function processEntry(entry: CorpusEntry, repoRoot: string): HarvestArtifacts {
  const sourceMode = entry.localFixturePath !== undefined ? 'local-fixture' : 'real-clone';
  const sourceDir = sourceMode === 'local-fixture'
    ? sourceFromFixture(repoRoot, entry)
    : sourceFromRealRepo(entry);

  try {
    applyPlantedFailure(sourceDir, entry.plantedFailure);

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

    const manifest: HarvestManifest = {
      entryName: entry.name,
      sourceRepo: entry.localFixturePath ?? entry.repoUrl ?? '<unknown>',
      sourceMode,
      plantedFailure: entry.plantedFailure,
      harvestedAt: new Date().toISOString(),
      ...(entry.commitSha !== undefined ? { commitSha: entry.commitSha } : {}),
    };

    return { componentSrc, specSrc, manifest };
  } finally {
    // Cleanup tmp source dir always — keeps ADR-0003 invariant
    // (nothing persisted outside the repo's intended outputs). Force +
    // recursive because cloned dirs include readonly .git internals on
    // some platforms (Windows runners) where rmSync's default refuses.
    rmSync(sourceDir, { recursive: true, force: true });
  }
}

export class CorpusSource implements HarvestSource {
  private readonly opts: CorpusSourceOpts;
  // Populated DURING iterate(). describeWhyEmpty() reads it after.
  // Reset on each iterate() call so a Source instance can be re-walked
  // without carrying stale state.
  private whyEmpty: 'entry-name-no-match' | null = null;
  private skipped: SkippedEntry[] = [];

  constructor(opts: CorpusSourceOpts = {}) {
    this.opts = opts;
  }

  describeWhyEmpty(): 'entry-name-no-match' | null {
    return this.whyEmpty;
  }

  // Adapter-specific extension (NOT part of the HarvestSource Interface).
  // The CLI wrapper (scripts/harvest-eval.ts) reads this after iteration
  // to log per-entry failures + set a non-zero exit code without losing
  // partial-success behavior (one bad entry doesn't abort the sweep).
  getSkippedEntries(): SkippedEntry[] {
    return this.skipped;
  }

  async *iterate(): AsyncIterable<HarvestArtifacts> {
    // Reset state for this iteration pass.
    this.whyEmpty = null;
    this.skipped = [];

    const repoRoot = this.opts.repoRoot ?? process.cwd();
    const manifestPath = this.opts.manifestPath ?? join(repoRoot, 'harvest-corpus.json');
    if (!existsSync(manifestPath)) {
      throw new Error(
        `harvest manifest not found at ${manifestPath}. Create harvest-corpus.json or pass manifestPath.`,
      );
    }
    const manifest = parseCorpusManifest(readFileSync(manifestPath, 'utf8'));

    // Empty `entries` is rejected at schema parse time, so manifest.entries
    // always has ≥ 1 here. The only "empty result with an explicit reason"
    // case is entry-name-no-match — every other zero-result outcome is
    // surfaced via getSkippedEntries().
    const targets = this.opts.entryName !== undefined
      ? manifest.entries.filter((e) => e.name === this.opts.entryName)
      : manifest.entries;

    if (this.opts.entryName !== undefined && targets.length === 0) {
      this.whyEmpty = 'entry-name-no-match';
      return;
    }

    for (const entry of targets) {
      try {
        const artifact = processEntry(entry, repoRoot);
        yield artifact;
      } catch (err) {
        // One bad entry must not abort the whole sweep — record it for
        // the caller and continue. Mirrors the pre-extraction script's
        // behavior (single entry-level failure → non-zero exit but the
        // healthy entries still land).
        this.skipped.push({
          name: entry.name,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}
