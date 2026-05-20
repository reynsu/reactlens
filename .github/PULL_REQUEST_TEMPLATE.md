<!-- Title format: `<type>(<scope>): <imperative summary>` per CONTRIBUTING / commit conventions. -->

## What this PR does

<!-- One short paragraph. Focus on the change, not the motivation — that goes in "Why". -->

## Why

<!-- The user-visible problem this solves, the bug it fixes, or the capability it
unlocks. Reference the issue with `Closes #<n>` if applicable. -->

## Moat rubric (ADR-0008)

reactlens claims exactly one moat capability: **the diagnosis agent is
better with the component snapshot than without it**. Every PR is
filtered through that rubric.

**Does this work make diagnosis better?**

Pick one:

- [ ] **Yes — moat work.** I expect the ablation delta to improve OR stay flat.
      The CI ablation gate (`.github/workflows/ablation.yml`) will compare
      this branch's delta against `tests/diagnostic-eval/ablation-baseline.json`.
      If the gate fails, that is a signal to investigate before merge — not a
      reason to relax the threshold.
- [ ] **No — built-in convenience or infrastructure.** This PR does not claim
      moat status (per [ADR-0002](docs/adr/0002-table-stakes-vs-moat-capabilities.md)).
      It can ship even if the ablation delta is unmoved.
- [ ] **N/A — docs / chore / non-functional.** No effect on the diagnosis path.

See [ADR-0008](docs/adr/0008-moat-is-defined-by-serving-diagnosis.md)
for the full rubric and why the rule exists.

## Verification

<!-- What you did to convince yourself this works. Examples:
- `pnpm typecheck && pnpm test` green
- Ran against `tests/fixtures/vite-react-router` locally
- Reproduced the bug from #N, observed the patched code fixes it
- Eyeballed the dashboard at localhost:7777 against the new event shape
-->

## Risks / follow-ups

<!-- Anything you punted, anything fragile, anything you'd want a reviewer to
look at twice. Honest is better than reassuring. -->
