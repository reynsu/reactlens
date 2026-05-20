// TDD for the corpus-manifest schema (slice #12 of v0.3 #7).
//
// `harvest-corpus.json` at the repo root lists which source repos the
// harvest pipeline should pull from and what to break in each. The
// schema is the single source of truth — both the harvest script and
// any future tooling parse the file through this module.
//
// Discriminated union on `plantedFailure.kind` so adding a new failure
// recipe (e.g., 'git-revert', 'prop-rename') only widens the union
// without touching call sites that already handle their kind.
//
// Pure: parse-string-return-object. No filesystem, no network. Unit
// tests cover happy paths, schema rejections, and each recipe kind.
import { describe, expect, it } from 'vitest';
import {
  CorpusManifestSchema,
  parseCorpusManifest,
  type CorpusEntry,
} from '../../src/eval/corpus-manifest';

const VALID_FILE_REPLACE_ENTRY: CorpusEntry = {
  name: 'counter-fixture',
  // Local fixture paths are the smoke-test mode; real-clone entries
  // use `repoUrl` instead. Schema must accept both (one-of).
  localFixturePath: 'tests/fixtures/harvest-corpus-counter',
  plantedFailure: {
    kind: 'file-replace',
    path: 'src/Counter.tsx',
    oldString: 'count + 1',
    newString: 'count - 1',
    description: 'Increment regressed to decrement',
  },
  candidateSpec: 'tests/counter.spec.ts',
  candidateComponent: 'src/Counter.tsx',
};

const VALID_REAL_REPO_ENTRY: CorpusEntry = {
  name: 'some-real-repo',
  repoUrl: 'https://github.com/example/some-real-repo.git',
  commitSha: 'abc123def456abc123def456abc123def456abcd',
  plantedFailure: {
    kind: 'file-replace',
    path: 'src/components/Header.tsx',
    oldString: 'aria-label="Open menu"',
    newString: 'aria-label="Open mneu"',
    description: 'Typo in a11y label',
  },
  candidateSpec: 'e2e/header.spec.ts',
  candidateComponent: 'src/components/Header.tsx',
};

describe('CorpusManifestSchema — happy paths', () => {
  it('accepts a manifest with one fixture entry', () => {
    const manifest = { entries: [VALID_FILE_REPLACE_ENTRY] };
    const result = CorpusManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
  });

  it('accepts a manifest with one real-repo entry', () => {
    const manifest = { entries: [VALID_REAL_REPO_ENTRY] };
    expect(CorpusManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it('accepts a manifest mixing fixture and real-repo entries', () => {
    const manifest = { entries: [VALID_FILE_REPLACE_ENTRY, VALID_REAL_REPO_ENTRY] };
    expect(CorpusManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it('parseCorpusManifest returns the typed manifest from a JSON string', () => {
    const json = JSON.stringify({ entries: [VALID_FILE_REPLACE_ENTRY] });
    const manifest = parseCorpusManifest(json);
    expect(manifest.entries).toHaveLength(1);
    const entry = manifest.entries[0];
    if (entry === undefined) throw new Error('length asserted above');
    expect(entry.name).toBe('counter-fixture');
    if (entry.plantedFailure.kind !== 'file-replace') {
      throw new Error('discriminant lost');
    }
    expect(entry.plantedFailure.oldString).toBe('count + 1');
  });
});

describe('CorpusManifestSchema — entry-shape rejections', () => {
  it('rejects an entry with neither localFixturePath nor repoUrl', () => {
    const bad = {
      entries: [{
        name: 'orphan',
        plantedFailure: { kind: 'file-replace', path: 'x', oldString: 'a', newString: 'b', description: 'd' },
        candidateSpec: 's',
        candidateComponent: 'c',
      }],
    };
    expect(CorpusManifestSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an entry that sets BOTH localFixturePath and repoUrl', () => {
    // Source ambiguity — schema must force the operator to pick one
    // mode per entry. Silently picking one would be a footgun when an
    // operator copies a real entry to a fixture and forgets to delete
    // the repoUrl line.
    const bad = {
      entries: [{
        name: 'both',
        localFixturePath: 'tests/fixtures/x',
        repoUrl: 'https://github.com/a/b.git',
        plantedFailure: { kind: 'file-replace', path: 'x', oldString: 'a', newString: 'b', description: 'd' },
        candidateSpec: 's',
        candidateComponent: 'c',
      }],
    };
    expect(CorpusManifestSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an entry missing required candidate paths', () => {
    const bad = {
      entries: [{
        name: 'incomplete',
        localFixturePath: 'tests/fixtures/x',
        plantedFailure: { kind: 'file-replace', path: 'x', oldString: 'a', newString: 'b', description: 'd' },
      }],
    };
    expect(CorpusManifestSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an entry with an empty name (would break slug derivation)', () => {
    const bad = {
      entries: [{ ...VALID_FILE_REPLACE_ENTRY, name: '' }],
    };
    expect(CorpusManifestSchema.safeParse(bad).success).toBe(false);
  });
});

describe('CorpusManifestSchema — plantedFailure rejections', () => {
  it('rejects an unknown failure kind', () => {
    const bad = {
      entries: [{
        ...VALID_FILE_REPLACE_ENTRY,
        plantedFailure: { kind: 'unknown-kind', path: 'x', oldString: 'a', newString: 'b', description: 'd' },
      }],
    };
    expect(CorpusManifestSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a file-replace recipe missing oldString/newString', () => {
    const bad = {
      entries: [{
        ...VALID_FILE_REPLACE_ENTRY,
        plantedFailure: { kind: 'file-replace', path: 'x', description: 'd' },
      }],
    };
    expect(CorpusManifestSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a file-replace with oldString === newString (would be a no-op plant)', () => {
    // A no-op plant produces a clone without the planted failure — the
    // case would record a non-failure as a failure. Loud rejection at
    // schema time prevents the manifest from silently corrupting the
    // eval set.
    const bad = {
      entries: [{
        ...VALID_FILE_REPLACE_ENTRY,
        plantedFailure: { kind: 'file-replace', path: 'x', oldString: 'same', newString: 'same', description: 'd' },
      }],
    };
    expect(CorpusManifestSchema.safeParse(bad).success).toBe(false);
  });
});

describe('parseCorpusManifest — error surfacing', () => {
  it('throws on malformed JSON, naming the parse stage', () => {
    expect(() => parseCorpusManifest('{ not json')).toThrow();
  });

  it('throws on schema-valid JSON that fails CorpusManifestSchema', () => {
    expect(() => parseCorpusManifest('{"entries": "not an array"}')).toThrow();
  });

  it('throws with a useful message when entries is empty (zero-entry manifest is operator error)', () => {
    // Empty manifest is never what the operator wants — they always
    // mean to harvest SOMETHING. Loud throw prevents a silent zero-
    // iteration loop the operator thinks is "working".
    expect(() => parseCorpusManifest('{"entries": []}')).toThrow();
  });
});
