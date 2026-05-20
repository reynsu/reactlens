# Table-stakes capabilities stay, but stop being sold as differentiators

reactlens currently markets nine "differentiating capabilities" in CLAUDE.md §4. Two of them — watch mode (4.6) and built-in axe-core (4.9) — are features any developer with Playwright can add in an afternoon (`@axe-core/playwright` exists; every test runner has watch mode). Listing them as differentiators dilutes the message and obscures what reactlens actually offers that nothing else does.

**Decision:** keep the commodity features in the codebase — they are built and they work — but stop calling them differentiators. CLAUDE.md §4 narrows to capabilities that depend structurally on the component-tree integration; commodity features move to a separate "Built-in conveniences" subsection. README is rewritten in the same shape: lead with what only reactlens does, treat axe and watch mode as table stakes that come for free because you're already using Playwright. Future effort allocation favors the moat — a deliberate, recorded policy, not a vague aspiration.

**Consequences:**

- CLAUDE.md §4 and README need a pass to re-categorize 4.6, 4.9, and any other capability that fails the differentiation test (e.g., parts of 4.8's a11y-tree diff). Out of scope for this ADR; tracked separately.
- CLAUDE.md §13 ("Things you must not do") gains one invariant: do not market as a differentiator anything a competitor with Playwright + npm can replicate in under a day.
- "Effort allocation favors the moat" is a stated policy. Its enforcement mechanism is resolved by [ADR-0008](0008-moat-is-defined-by-serving-diagnosis.md): the moat is defined as work that makes diagnosis better under the ablation methodology of [ADR-0001](0001-ablation-as-moat-metric.md). Reviewers apply that rubric to classify any given PR.
- 4.7 (behavior contracts) and 4.8 (a11y-tree diff) sit in a gray zone — they aren't pure commodities but neither are they uniquely enabled by the moat. A future ADR may demote one or both if their differentiation claim weakens on inspection.
