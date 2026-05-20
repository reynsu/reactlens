// File-backed AblationCache — issue #8 acceptance criterion:
// `(case-hash, variant)` keyed cache so re-running with no input
// changes does not re-invoke the agent.
//
// The harness sees only the AblationCache interface (get + set) from
// `ablation-harness.ts`. This file owns hashing + on-disk layout —
// future cache strategies (in-memory LRU, content-addressable across
// repos) drop in without touching the harness wiring.
//
// Hash inputs (minimum): component.tsx + spec.ts + truth.json + variant.
// These are the canonical case inputs from CLAUDE.md §6 + issue #8.
// Optional case files (error.txt, snapshot.json, prompt-context.md)
// land in a follow-up cycle once a behavior test forces the extension.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Diagnosis } from '@reynsu/reactlens-diagnosis-prompts';
import type { AblationVariant } from './ablation-variant-generator';
import type { AblationCache } from './ablation-harness';
import type { EvalCase } from './eval-case-loader';

// Files that contribute to the cache key. Ordering is part of the hash
// contract — re-ordering this list invalidates every existing cache
// entry, so do not reorder casually.
const HASHED_FILES: readonly string[] = ['component.tsx', 'spec.ts', 'truth.json'] as const;

export type CreateFileCacheOpts = {
  // Directory where the cache lives. Created on first write if absent.
  // Production wires this to `<cwd>/.reactlens/eval-cache/`; tests pass
  // a mkdtempSync dir.
  root: string;
};

export function createFileCache(opts: CreateFileCacheOpts): AblationCache {
  const { root } = opts;

  function keyFor(args: { case: EvalCase; variant: AblationVariant }): string {
    const h = createHash('sha256');
    for (const name of HASHED_FILES) {
      // Include the file name in the hash so an empty file at `spec.ts`
      // and an empty file at `component.tsx` don't collide.
      h.update(name);
      h.update('\0');
      h.update(readFileSync(join(args.case.path, name)));
      h.update('\0');
    }
    h.update(args.variant);
    return h.digest('hex');
  }

  function pathFor(key: string): string {
    return join(root, `${key}.json`);
  }

  return {
    async get({ case: c, variant }) {
      const file = pathFor(keyFor({ case: c, variant }));
      if (!existsSync(file)) return undefined;
      return JSON.parse(readFileSync(file, 'utf8')) as Diagnosis;
    },
    async set({ case: c, variant, diagnosis }) {
      mkdirSync(root, { recursive: true });
      const file = pathFor(keyFor({ case: c, variant }));
      writeFileSync(file, JSON.stringify(diagnosis));
    },
  };
}
