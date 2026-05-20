# The moat is defined by serving diagnosis — this is the rubric

ADR-0002 committed to "moat-first effort allocation" but left the enforcement mechanism open: how does anyone — reviewer, contributor, future agent — *decide* whether a given piece of work qualifies as moat work? Without a rubric, the policy is aspirational and devolves into argument every PR. The moat itself was also defined enumeratively (the snapshot, the testIdIndex, the AST analysis, etc.), which is fragile — new capabilities don't fit cleanly into the enumeration and the list grows by accretion.

**Decision:** the moat is **defined by its function, not by its components**. The function is **diagnosis**. The rubric is a single, non-negotiable question applied to every feature proposal, every refactor, every prompt change, every probe extension:

> **Does this work make diagnosis better?**

Concretely, "better" means: improves accuracy, improves calibration, reduces false-confidence, broadens the failure classes the agent can correctly classify, makes the patch more often correct, makes the patch more often applicable, or makes the diagnosis available where it previously wasn't (e.g., in CI, in time-travel replay). Measured by the ablation methodology of ADR-0001 — not by intuition.

Work that passes this filter is **moat work** and gets prioritization weight. Work that fails this filter is not disqualified — commodities (watch mode, axe-core integration, dashboard UX polish) can still ship — but they do not count toward the moat-favoring effort allocation. This is the rubric ADR-0002 was missing.

**Status:** this is an **invariant**, not a guideline. It belongs in CLAUDE.md §13 ("Things you must not do"), phrased as: *"Do not label work as moat / differentiator unless it makes diagnosis measurably better under the ablation methodology of ADR-0001."* A PR violating the invariant is rejected; a feature that's useful but fails the rubric is shipped under the "Built-in conveniences" framing from ADR-0002, with no claim to differentiation.

**Consequences:**

- The enumerative definition of the moat in CLAUDE.md §4 is supplanted by this functional one. Components of the moat are derived (they're whatever happens to serve diagnosis) rather than declared.
- The Component-Object Pattern (ADR-0006) passes the rubric: it lets specs capture richer evidence at assertion time, which strengthens the snapshot fed to diagnosis. The loop closure of ADR-0007 passes: an unapplied patch is a diagnosis that didn't deliver. Both v0.3 priorities remain valid under the rubric.
- The a11y-tree branch of the semantic diff (ADR-0002's gray-zone item) gets a clean test: does it improve diagnosis accuracy on the eval set? If the next ablation shows it doesn't, it demotes to "Built-in convenience". If it does, it stays moat. The rubric replaces argument.
- Future temptations — adding more probes, more capture, more dashboard panels — must answer the question first. Capture for its own sake (CLAUDE.md §10 Principle 1 said "capture is sacred") is reinterpreted: capture is sacred *because* it serves diagnosis, not as an end in itself. If a particular capture signal never reaches diagnosis, it is not actually sacred.
- This ADR closes the loose end from ADR-0002 and supersedes the "future ADR will resolve enforcement" placeholder there. ADR-0002 is updated in this same turn to point here.
