# harvest-corpus-counter (fixture)

Minimal source-repo shape consumed by `scripts/harvest-eval.ts` via the
`harvest-corpus.json` entry named `counter-fixture`. NOT a real project
— just enough files for the harvest pipeline to copy → plant → emit
without needing network access.

Layout:

```
src/Counter.tsx          # the component the planted-failure recipe targets
tests/counter.spec.ts    # the spec the planted failure breaks
```

The planted failure (defined in `harvest-corpus.json`) changes
`setCount(count + 1)` to `setCount(count - 1)` — the spec's
`toHaveText('1')` then fails because the count goes to `-1` after
clicking increment.

This fixture exists for `tests/integration/harvest-eval.test.ts` and
for documentation / dry-runs of the harvest pipeline.
