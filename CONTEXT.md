# reactlens

Domain vocabulary for the reactlens project — the React-aware E2E testing tool whose moat is component-tree-aware diagnosis. CLAUDE.md §14 holds the wider glossary (engine/infra terms like `runEventSchema`, `RunsArea`, `AblationCache`); this file holds the **domain** terms the codebase models — the nouns and verbs of the testing-and-diagnosis workflow itself.

## Language

**Diagnosis**:
The structured output of the diagnosis agent — a classification (`real-bug | test-bug | flaky | env-issue`), confidence, evidence, suggested fix, optional patch, optional git context. Defined as a type in CLAUDE.md §9.
_Avoid_: "analysis", "report" (too generic), "verdict" (too final).

**DiagnosisRun**:
A single invocation of the diagnosis pipeline against one **DiagnosisIntent**, producing one **Diagnosis**. Owns the prepare-then-execute split: intent-specific preparation (sandbox decisions, FailedTest construction, prompt transforms) followed by a shared execution core (system+user prompt → streamed agent call → JSON extraction → Zod validation → retry). The §13 calibration fence (truth.json never reaches the agent-visible cwd) lives in the preparation step for eval/ablation intents — not at the caller boundary.
_Avoid_: "diagnose call" (too vague), "diagnosis request" (sounds like just data), "diagnosis job" (implies queue/async semantics we don't have).

**DiagnosisIntent**:
The shape of a DiagnosisRun's input — a discriminated union over the four kinds of caller that need a Diagnosis: `live` (failure during `reactlens run`), `post-mortem` (failure parsed from a Playwright JSON report by `reactlens analyze`), `eval-case` (a single labeled case from `tests/diagnostic-eval/`), `ablation` (a case × variant tuple driven by the AblationHarness). The kind determines the preparation pipeline; the execution core is shared across all four.
_Avoid_: "FailedTest" (a FailedTest is the *normalized internal* shape; intents are the *external* shapes — distinct).

**FailedTest** (internal):
The normalized input shape the execution core consumes after preparation. Holds `{ testId, testTitle, specFile, errorMessage?, componentSnapshot?, componentFile? }`. All four DiagnosisIntent kinds reduce to a FailedTest before the execute core runs. Not exposed at the DiagnosisRun Interface.
_Avoid_: confusing with Playwright's own failure types.

**Variant** (in DiagnosisRun context):
A prompt-transform applied during preparation of an `ablation` intent. Today `'with-snapshot' | 'without-snapshot'`. The transform strips snippets of the system prompt marked by `<!-- ablation:snapshot-* -->` markers (owned by `@reynsu/reactlens-diagnosis-prompts`). Not visible to non-ablation intents.

**Calibration fence**:
The §13 invariant that `truth.json` must never reach the agent-visible cwd during a DiagnosisRun. Enforced in the preparation step for `eval-case` and `ablation` intents via per-run sandbox temp dirs. Violating it makes ADR-0001's ablation metric meaningless (the agent can just `Read` the expected answer).
_Avoid_: "sandbox" by itself (sandbox is the *mechanism*; the fence is the *invariant*).

## Relationships

- A **DiagnosisRun** is parameterized by exactly one **DiagnosisIntent** and produces exactly one **Diagnosis**.
- A **DiagnosisIntent** of kind `eval-case` or `ablation` triggers the **Calibration fence** during preparation; `live` and `post-mortem` do not.
- An **ablation** **DiagnosisIntent** carries a **Variant**; other intents do not.
- The **AblationHarness** (CLAUDE.md §14) is the only caller that drives a **DiagnosisRun** with the `ablation` intent kind.

## Example dialogue

> **Dev:** "If `reactlens analyze` and `reactlens run` both end up calling diagnose, do they share the same prepare step?"
> **Maintainer:** "No — they're two different **DiagnosisIntent** kinds (`post-mortem` and `live`). They share the *execute* core of **DiagnosisRun**, but their prepare steps differ. `live` already has a `componentSnapshot` from the live probe; `post-mortem` rebuilds the **FailedTest** from a Playwright JSON report and never has a snapshot."

> **Dev:** "Why does ablation need a separate intent — couldn't it just be an `eval-case` with a prompt override?"
> **Maintainer:** "Because the **Variant** transform is load-bearing for ADR-0001. Making it a discriminated intent forces every ablation call site to declare which variant it's running; making it an optional kwarg lets a caller forget to set it and silently measure the wrong thing."

## Flagged ambiguities

- "diagnose" was used in CLAUDE.md as both the noun (the output Diagnosis type) and the verb (the act of running the pipeline). Resolved: **Diagnosis** is the output; **DiagnosisRun** is the act. The legacy `diagnose()` function in `src/analyzer/failure-agent.ts` is shrinking into the execute core of DiagnosisRun.
