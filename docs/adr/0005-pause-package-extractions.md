# Pause new package extractions until existing ones have a second production consumer

Three packages — `@reynsu/reactlens-{diagnosis-prompts, diff-core, dashboard-ui}` — were extracted from reactlens in the past month with the justification that the sibling project `nativelens` would reuse them. As of 2026-05-19, nativelens consumes none of them. CLAUDE.md §15 also documents a deferred-then-reversed decision on `dashboard-ui` ("Dashboard extraction is deferred… until nativelens P6 starts"), which happened anyway. The coordination overhead is already visible: a `feature/consume-dashboard-ui` branch sits ahead of `main` without an upstream, and the `zod` peer-dependency incident in §15 describes a published-then-fixed mistake — exactly the kind of friction extraction was supposed to avoid, not introduce.

**Decision:** stop extracting code from reactlens into new `@reynsu/*` published packages until the three existing packages have proven their reuse claim — defined as **either two production consumers, or one production consumer with a written commitment to ship within 60 days, validating the API surface in real use**. The three packages already extracted are sunk cost: they work and removing them would be louder than the benefit. The rule is recorded in CLAUDE.md §15 as a soft guideline, not in §13 as a hard invariant — a violating PR is discussed, not auto-rejected, because the right answer in a specific case might be to override the guideline with a recorded justification rather than to refuse the extraction outright.

**Consequences:**

- CLAUDE.md §15 gets an admission-rule paragraph. §13 is not touched.
- The `feature/consume-dashboard-ui` branch is resolved (merged if stable, closed if not) — separate cleanup task, not part of this ADR.
- The `@reynsu/nativelens-event-protocol` migration mentioned in §15 stays planned but is subject to this rule when its time comes — reactlens does not migrate to consume it just because the package exists, only when nativelens is actually shipping with it.
- "Sunk cost" framing is explicit: keeping the three packages is not an endorsement of the extraction strategy, it's a recognition that un-publishing is noisier than leaving them.
- If nativelens ships and consumes the three packages, this ADR is naturally superseded — extraction is re-enabled by default and the bar resets.
