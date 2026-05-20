# "Local-first" means sovereignty-first, not offline-first

CLAUDE.md §3 and §10 declare reactlens "local-first" but conflate three distinct properties: (1) no SaaS / no proprietary lock-in, (2) no telemetry / no data egress without explicit invocation, (3) functions fully offline. Today reactlens satisfies (1) and (2) but not (3) — the killer features (`generate`, `diagnose`) require `ANTHROPIC_API_KEY`. Future contributors will repeatedly bump into this contradiction when deciding whether some new feature is "aligned with the philosophy".

**Decision:** "local-first" is redefined as **sovereignty-first**. (1) and (2) are hard invariants. (3) is a nice-to-have: reactlens MUST work offline for everything that doesn't need an LLM (`run`, dashboard, replay, `diff`, contracts already on disk), but LLM-backed features are allowed to require network and that is not a violation. The `--use-claude-code` flag stops being a developer-convenience footnote in `docs/troubleshooting.md` and becomes a central piece of the sovereignty story: if the user already pays for Claude Max, reactlens uses that session instead of double-billing. Future LLM-runtime options (local Ollama, llama.cpp, etc.) are philosophically welcome but not roadmap obligations — they're evaluated on diagnosis quality, not dogma.

**Consequences:**

- CLAUDE.md §3 (Goals) and §10 (Principle 3) need to be rewritten to use the three-level distinction. Out of scope for this ADR; tracked separately.
- README's positioning shifts: the local-first claim is rephrased so it's accurate (sovereignty + offline-for-non-LLM). The "How the moat works" section should mention `--use-claude-code` as part of the user-billing story, not as a CLI flag in a table.
- Any future PR that proposes adding telemetry, a hosted backend, or any cloud-sync feature must be rejected on philosophical grounds. Any PR that adds LLM-backed features that require network is acceptable as long as offline functionality for non-LLM commands does not regress.
- `AgentRunner` abstraction already supports the swap; no architectural change needed today. Local-LLM runners can be added later when there's a concrete user request.
