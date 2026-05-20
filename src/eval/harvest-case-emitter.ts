// Harvest case emitter — writes one corpus-harvested case directory.
//
// After the harvest pipeline (slice #12 of v0.3 #7) has cloned/copied
// a source repo, applied the planted-failure recipe, and collected
// the resulting component + spec sources, this module writes them
// into the standard case directory layout:
//
//   <outputDir>/
//   ├── component.tsx     (mutated source from the planted file)
//   ├── spec.ts           (the spec verbatim from the source)
//   ├── manifest.json     (harvest provenance — slice #12 addition)
//   └── truth.json        (STUB — curated: false, awaits human review)
//
// The truth.json is deliberately a stub. The whole point of the
// synthetic-from-corpus convention (per ADR-0004) is that harvested
// cases enter UNCURATED and a human marks them curated only after
// verifying the planted failure actually exercises what the recipe
// claims. Emitting a curated truth at harvest time would silently
// inflate the headline accuracy with un-reviewed cases — exactly
// the false-confidence regression Principle 2 forbids.
//
// Pure-ish: no network, no global state. Writes to the caller-owned
// `outputDir`. The caller is responsible for creating outputDir; we
// throw on missing instead of mkdir -p'ing because a typo'd path
// silently creating a phantom directory is operator pain we'd rather
// surface at write time.
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PlantedFailure } from './corpus-manifest';

// Provenance manifest written alongside the case. Records what was
// planted, against what source, when, by which corpus entry — enough
// for a future operator to reproduce the case or invalidate it when
// the upstream source has drifted.
export type HarvestManifest = {
  // Entry name from harvest-corpus.json. Doubles as the directory
  // slug under tests/diagnostic-eval/cases/synthetic-from-corpus/.
  entryName: string;
  // localFixturePath OR repoUrl, surfaced verbatim so the operator
  // doesn't have to cross-reference the corpus manifest.
  sourceRepo: string;
  sourceMode: 'local-fixture' | 'real-clone';
  // The recipe that was applied, copied from the corpus entry. Lets
  // the curator see what was planted without diffing against the
  // unplanted source.
  plantedFailure: PlantedFailure;
  // ISO-8601 UTC. Reproducibility marker for the corpus entry's
  // upstream state at harvest time.
  harvestedAt: string;
  // Optional commit SHA — present only when sourceMode === 'real-clone'
  // AND the entry pinned a commit. Fixture-mode entries have no SHA.
  commitSha?: string;
};

export type HarvestArtifacts = {
  // Contents of the (planted) component file from the source repo,
  // verbatim. The caller has already applied the planted-failure
  // recipe — this is the broken state.
  componentSrc: string;
  // Contents of the spec file from the source repo, verbatim.
  // Specs are typically not modified by the recipe; the planted
  // failure breaks the component such that the existing spec fails.
  specSrc: string;
  manifest: HarvestManifest;
};

export function emitHarvestedCase(outputDir: string, artifacts: HarvestArtifacts): void {
  // Refuse a missing output directory — see file-header rationale.
  if (!existsSync(outputDir)) {
    throw new Error(
      `emitHarvestedCase: outputDir does not exist: ${outputDir}. The caller must create the directory before calling this function (we deliberately do not mkdir -p to surface typo'd paths).`,
    );
  }

  // 2-space indent + trailing newline matches the convention in the
  // existing tests/diagnostic-eval/cases/*/truth.json + snapshot.json
  // — keeps PR diffs and editor formatting consistent across the
  // case set, curated or harvested.
  writeFileSync(join(outputDir, 'component.tsx'), artifacts.componentSrc);
  writeFileSync(join(outputDir, 'spec.ts'), artifacts.specSrc);
  writeFileSync(
    join(outputDir, 'manifest.json'),
    `${JSON.stringify(artifacts.manifest, null, 2)}\n`,
  );

  // Truth stub. expectedClassification: 'env-issue' is the safest
  // wrong-default — it discourages anyone from running this case
  // through the agent expecting a real answer, and minimumConfidence:
  // 'low' means even if the agent does run it and replies, the case
  // contributes nothing to the false-confidence count until the human
  // curates a real truth.
  const truthStub = {
    expectedClassification: 'env-issue' as const,
    minimumConfidence: 'low' as const,
    curated: false,
    notes:
      'UNCURATED — harvested by scripts/harvest-eval.ts. A human MUST verify the planted failure actually triggers the documented behavior, set expectedClassification + minimumConfidence to real values, then either delete this `curated: false` field or move the case to tests/diagnostic-eval/cases/case-N-<slug>/ (the loader treats anything outside synthetic-from-corpus/ as curated).',
  };
  writeFileSync(
    join(outputDir, 'truth.json'),
    `${JSON.stringify(truthStub, null, 2)}\n`,
  );
}
