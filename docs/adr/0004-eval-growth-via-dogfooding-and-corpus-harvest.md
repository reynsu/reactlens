# Eval set grows via dogfooding plus corpus harvest, not beta recruitment

ADR-0001 commits reactlens to evaluating every change against a with/without-snapshot ablation, but the existing 16-case eval set is too small to produce statistically meaningful deltas, and every case was authored by the same person who wrote the diagnosis prompts — a textbook overfitting setup. The only sustainable fix is more diverse cases, and the only sources of diversity are (a) real users, (b) the maintainer using the tool on their own projects, (c) a public corpus of React + Playwright repos to harvest failures from. Recruiting beta users is expensive in time and currently has no allocated effort; the eval set cannot wait.

**Decision:** grow the eval set via two parallel channels — (β) **dogfooding**: the maintainer runs reactlens on their own non-trivial React projects, and every real failure encountered is a candidate eval case; (δ) **corpus harvest**: a `scripts/harvest-eval.ts` clones a curated list of open-source React repos with Playwright suites, plants known failures (commit reverts, dependency bumps, prop renames) and runs reactlens against them, dropping the results into `tests/diagnostic-eval/cases/synthetic-from-corpus/` for human curation. (γ) beta recruitment is deferred — it costs time we haven't allocated and (β) plus (δ) is enough to unblock ADR-0001's ablation methodology. Pure synthetic eval-writing by the maintainer (α) is rejected as guaranteed overfitting.

**Consequences:**

- The `synthetic-from-corpus/` subdirectory is new; eval-runner needs to discover cases recursively rather than from a flat list (small refactor).
- Corpus-harvest cases must be **curated** before being included in headline accuracy numbers — raw harvest output is candidate, not truth. A `curated: true` field (or directory split) marks the boundary.
- Treating dogfooding as a first-class eval growth channel implies the maintainer commits to running reactlens regularly on a real project. If that doesn't happen, channel (β) silently produces zero cases and the strategy collapses to (δ) alone — which is still better than (α) but worth tracking.
- This decision does not introduce a sustained dependency on any external service or change the sovereignty-first invariant from ADR-0003 — both channels are local scripts.
- Beta recruitment (γ) is not closed forever; it is reopened if (β) + (δ) plateau or if a concrete user reports a failure the agent gets wrong.
