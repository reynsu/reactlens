# Close the diagnosis loop in v0.3, with patch safety via uniqueness check

CLAUDE.md §10 Principle 5 declares "the diagnosis is always actionable" but EXECUTION_PLAN explicitly marks "Apply fix" button and server-side patch application as deferred (`[~]`). Today the agent produces a structured `{file, oldStr, newStr, rationale}` patch that the user has to read as JSON and apply by hand. That is the same kind of documented-but-unmet promise flagged in ADR-0005, and it is the place where the moat fails to convert into delivered value: without loop closure, reactlens is "Sentry + Copilot Chat + a nice dashboard" instead of "the tool that actually fixes your React tests".

**Decision:** ship two pieces of loop closure in v0.3, alongside the Component-Object Pattern from ADR-0006:

- **(P) Patch-as-Markdown.** The diagnosis panel renders the patch as a `diff`-fenced markdown block, with a "Copy as `git apply`" button that copies a unified-diff-formatted string to the clipboard. Zero filesystem writes; pure UI improvement. Shippable immediately, independent of (Q).
- **(Q) Apply-with-confirmation.** Dashboard gets an "Apply fix" button (enabled only when `patch` is present). Click → WS message → server reads the file, verifies `oldStr` appears **exactly once** in the file, applies `oldStr → newStr` with `fs.writeFile`, emits `patch:applied`. Frontend shows confirmation and offers a "Re-run this test" action. If `oldStr` is not unique (zero or multiple matches), the server refuses the apply and emits `patch:rejected` with a reason; the panel surfaces the reason and tells the user the patch must be applied manually for now.

**Patch safety — the uniqueness check.** Patches are simple `oldStr/newStr` replaces, not context-lined unified diffs. The safety guard is a uniqueness check before write: the file must contain `oldStr` exactly once. This is the simplest mechanism that prevents the worst class of bug (wrong location overwritten) without forcing the agent prompt to emit a more complex format. If usage data later shows uniqueness-check failures are common, the format can be upgraded — but that is evolution under evidence, not speculation up front. Documented limitation: "patches only apply automatically when their `oldStr` is unique in the file; otherwise reactlens shows the patch and asks the user to apply manually."

**(R) Apply-with-git-safety is v0.4.** Wrapping the apply in `git stash` / dedicated branch / rollback flow is the robust version but requires real design decisions (conflicts, dirty trees, where to anchor branches). Bundling it into v0.3 would delay (Q). Better to ship (Q) imperfect than block on (R) perfect — and (R) lands in v0.4 with time to do it right.

**Consequences:**

- v0.3 scope is now: Component-Object Pattern (ADR-0006) + (P) + (Q) + the ablation tooling implied by ADR-0001 + the eval-harvest channels from ADR-0004. The v0.3 roadmap is overdetermined enough that it warrants a written plan; updating EXECUTION_PLAN.md is the next concrete artifact.
- The diagnosis prompt does not change shape — `patch[i].oldStr / newStr` stays the contract. Only the consumer (dashboard) gains behaviors.
- CLAUDE.md §10 Principle 5 can stay as written because v0.3 closes the gap. Until v0.3 ships, README and any external messaging should not claim "auto-fix" — only "diagnose with patch".
- The "Apply fix" UX is opinionated by design: explicit modal confirmation, dry-run preview of the new file content, no quiet writes. Sovereignty (ADR-0003) is preserved — the developer remains the one who says yes.
