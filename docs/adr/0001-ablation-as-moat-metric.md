# Snapshot ablation is the moat-contribution metric

reactlens claims its differentiator is the component:snapshot captured at every test step — but until 2026-05-19 we had never measured whether the diagnosis agent actually uses that signal. The 16-case eval reporting "100% accuracy" was run only in the `with-snapshot` condition; a strong baseline (spec + source + git log) could plausibly score equally well, in which case the entire `src/component-bridge/` investment is unmeasured.

**Decision:** from now on, every change that touches the diagnosis prompt, the probe, or the snapshot payload MUST be evaluated under two conditions — `with-snapshot` (current) and `without-snapshot` (the same prompt with the component-snapshot section removed). The metric of interest is the **delta** in accuracy and false-confidence rate between the two. A change that does not move the delta in the intended direction is, by definition, not a moat improvement. The 16-case eval set is also treated as too small for definitive claims; growing it is first-class work from now on, not a chore.

**Consequences:**

- README's "100% accuracy" claim is on hold until the without-snapshot baseline exists. If the delta turns out to be zero or near-zero on the current 16 cases, the claim becomes misleading and must be rewritten.
- The eval-runner needs an ablation mode (env flag or CLI arg) before this ADR is operationally meaningful.
- "Moat" stops being a monolithic concept — future ADRs will narrow it to specific signals (component tree, testIdIndex, a11y tree, hook values) that can each be ablated independently.
