# Component-Object Pattern joins POM as opt-in, prioritized for v0.3

CLAUDE.md §3 declares POM the only test pattern reactlens generates. POM was designed for an era when tests' main fragility was DOM brittleness; reactlens's moat is that it sees the component tree, props, and hooks — information POM-shaped specs structurally cannot express. As a result, today the moat is invisible at spec-authoring time and only surfaces in the post-failure diagnosis. Asked "what makes my reactlens-generated test different from a hand-written Playwright test?", the honest answer is "nothing visible until it fails" — a weak answer to a fair question.

**Decision:** introduce a second generated test pattern — the **Component-Object Pattern** — that surfaces components, props, and state as first-class assertions in the spec itself (e.g. `await expect(LoginForm.props.isPending).toBe(false)`). POM remains the default to preserve spec portability (a POM-generated test runs under plain Playwright without reactlens installed). Component-Object is opt-in via a `pattern: 'component-object'` field in `reactlens.config.ts` (and a `--pattern` flag on `generate`). Component-Object specs require reactlens at runtime — and that is acknowledged as a deliberate trade: teams that opt in get a spec that shows the moat; teams that don't, keep portable specs. This is consistent with sovereignty (ADR-0003): the opt-out path stays open.

**Priority:** this is **v0.3 priority work**, not a backlog signal. It is committed to be built, not just announced. CLAUDE.md §3 softens from "POM is the only test pattern" to "POM is the default; Component-Object is opt-in for teams committed to reactlens."

**Consequences:**

- The generator gains a second prompt (`generate-suite-component-object.md`) and the delegate picks based on config. The `generate-suite.md` prompt's "Hard rule 1" needs softening to "Hard rule 1 (when `pattern: 'pom'`)".
- A new runtime helper is needed in the reactlens fixture so Component-Object specs can read component props/state from the live snapshot stream (not just from the post-failure snapshot used by diagnosis). The shape of this helper API is open and is its own design problem — the right place to capture it is a v0.3 design note, not this ADR.
- Diagnostic-eval cases written in POM remain valid; new cases authored in Component-Object should be added to test that the ablation methodology (ADR-0001) holds for both patterns. The pattern is not expected to change diagnosis accuracy — that is a hypothesis to verify, not an assumption.
- The behavior-contract output (`<Component>.contract.md`) gains a per-pattern variant or a section that documents the Component-Object surface. Small extension, not a redesign.
- Marketing/README implication: the differentiator finally has a *visible* artifact (a spec that looks unmistakably reactlens-shaped). The README's "How the moat works" section gains a side-by-side example. Out of scope for this ADR.
