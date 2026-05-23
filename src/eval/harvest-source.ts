// HarvestSource — the Interface that unifies the two adapters that
// produce eval cases by harvesting them from somewhere:
//   - DogfoodSource: walks `.reactlens/runs/` to find the last failure
//   - CorpusSource:  reads a corpus manifest and plants failures per recipe
//
// Per LANGUAGE.md (two adapters = real seam) the Interface earns its keep
// today — not on speculation. The two adapters today both end up calling
// `emitHarvestedCase` (the sink) per artifact; the shape they have to
// produce is `HarvestArtifacts` (defined in `harvest-case-emitter.ts`).
//
// Design picks (architecture review):
//   (γ) constructor-captured opts — each adapter is a factory: caller
//       does `new DogfoodSource({cwd})` once, then `.iterate()` takes
//       no args. Lets the Interface stay uniform across adapters.
//   (a) AsyncIterable unit of work — dogfood yields 0-or-1 artifacts;
//       corpus yields N. The iterable abstracts both.
//   (i) build only — Source produces HarvestArtifacts; the caller owns
//       mkdir + emit (each caller has its own path convention). Sources
//       stay pure (no disk writes inside the Source).
//   (C) optional `describeWhyEmpty()` — when iteration ends with 0
//       items, callers MAY read a per-adapter reason string. Free-form
//       (per-adapter vocabulary) so callers should treat it as opaque.
//       The dogfood CLI uses it to distinguish "no runs" vs "no failure".
//
// Re-exports `HarvestArtifacts` so adapters only need one import.
export type { HarvestArtifacts, HarvestManifest } from './harvest-case-emitter';
import type { HarvestArtifacts } from './harvest-case-emitter';

export interface HarvestSource {
  // Yields zero or more HarvestArtifacts. Each call to iterate() walks
  // the source fresh — implementations are NOT required to be re-entrant
  // or to cache. Caller iterates once, then constructs a new Source for
  // a second pass.
  iterate(): AsyncIterable<HarvestArtifacts>;

  // Optional. When iterate() completes with zero yields, callers MAY
  // call this to recover a per-adapter reason string for surfacing in
  // CLI output. Returning null means "no specific reason, just empty";
  // a non-null string is adapter-defined and should be passed verbatim
  // to the operator (callers should NOT pattern-match on it).
  //
  // Adapters that always yield at least one artifact (or whose empty
  // result has no operator-meaningful explanation) MAY omit this method.
  describeWhyEmpty?(): string | null;
}
