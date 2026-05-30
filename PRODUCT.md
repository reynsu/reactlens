# Product

## Register

product

## Users

React developers writing and maintaining Playwright E2E tests, sitting in front of
a red test result trying to answer two questions: (1) is this a test bug or a real
bug? (2) where in the code do I fix it? They work at a desk under monitor light,
inside an editor + terminal flow; reactlens is the third surface they pivot to
when an assertion fails. Power users; the dashboard must reward keyboard, scale to
suites of 200+ specs, and never make them context-switch into a SaaS to find the
answer their own code already contains.

## Product Purpose

`reactlens` is the first E2E testing tool that understands the React component tree,
not just the DOM. Every other E2E tool (Playwright, Cypress, QA Wolf, Octomind, Mabl)
treats the app as a black box; reactlens injects a probe into the running React app,
captures component snapshots at every test step, and uses them to (a) generate tests
that exercise all visual branches the AST analyzer enumerates, and (b) classify each
failure as `real-bug | test-bug | flaky | env-issue` with a concrete suggested fix.

Success looks like: a dev opens the dashboard on a failed test, reads the structured
diagnosis + the active-owner React fiber + the proposed code patch, and either
clicks Apply Fix or commits the spec-side correction. Two minutes of triage,
zero context-switching, zero "let me read the trace and grep".

## Brand Personality

**Technical · Honest · Opinionated.**

The voice is concrete: specific nouns and verbs about what the product literally
does (`captures the React tree at every step`, `diagnoses with high confidence`),
never the streamline/empower/transform family of marketing words. Tone is plain
and refined; humble where humility is warranted (calibration is asserted on evidence,
not on claims), confident where the moat is real (component-tree awareness is
something no competitor can ship without a corresponding rewrite). Sovereignty-first
is a stated invariant, not a checkbox: no SaaS, no telemetry, no cloud sync ever.
The brand reads like a dev tool that has self-respect.

## Anti-references

This product is NOT, and the visual design must not collapse toward:

- **Cypress dashboard.** Tabs cluttered, IA confused, marketing layered on top of
  a debugger. We are not selling tiers.
- **Playwright UI.** Functional and useful, but visually flat and unmemorable.
  The component tree is invisible because Playwright doesn't have one. We do.
- **Vitest UI.** Monospace-heavy, no real design system, the bare minimum. We are
  not the same category, even though we use Playwright underneath.
- **GitHub Actions runs.** Admin-panel vibes, vertical text walls of step output.
  We diagnose; we don't reproduce the CI log surface.
- **Sentry.** Production-ops register. reactlens is a dev tool that lives next to
  the editor, not a triage SaaS for an SRE.
- **Storybook.** Component cataloging is a different job from failure diagnosis;
  we are not a component browser, we are a test debugger that happens to render
  the component tree.
- **Datadog / Grafana.** Metric-first ops dashboards. Wrong vibe for task-mode
  dev work.
- **Cursor / Zed (admiration, not aspiration).** We respect IDEs and learn from
  them, but reactlens is a focused single-lens tool, not a general-purpose editor.
  We do one thing (E2E diagnosis with component context) extraordinarily well.

## Design Principles

1. **The component tree is the hero.** It's the moat made visible; every UI
   decision evaluates whether it makes the tree easier to read, navigate, or
   connect to a failing step. Render-as-code (`<ComponentName>` with syntax tokens)
   is the signature, not a flourish.

2. **Capture is sacred, processing is replaceable.** The probe → snapshot →
   diagnosis pipeline is the foundation. Cut corners on dashboard polish first,
   on the capture → diagnosis path last. A diagnosis that doesn't reach the
   developer is dead weight, no matter how good the capture was.

3. **Confidence is calibrated, not asserted.** The diagnosis agent only claims
   "high confidence" when the eval set proves it earns the right at that frequency.
   Never softer than "I don't know" when uncertain; never louder than "high" when
   ablation can't justify it.

4. **Sovereignty over convenience.** No SaaS, no telemetry, no proprietary lock-in.
   Offline operation is preserved for non-LLM commands. LLM-backed commands
   (`generate`, `diagnose`) require network and we say so plainly, never hide it.

5. **The diagnosis is always actionable.** A classification without a concrete
   suggested fix is a bug in the system. Either we ship a patch or we say
   explicitly what additional information would let us produce one. Never
   wishy-washy "it might be a timing issue, try adding waits".

6. **One framework, deeply.** React-only is intentional. Every time we are tempted
   to "make it work for Vue too" we lose part of the moat. The component-tree
   integration depends on React-specific internals and that is the entire point.

## Accessibility & Inclusion

WCAG 2.2 AA across the dashboard. Verified in the in-session audit (May 2026):

- Color contrast — body text ≥ 4.5:1 against panel surfaces. `--muted` runs at
  4.74:1 against white (was 3.27:1 before the audit raised it).
- ARIA Tree pattern on the component tree (`role="tree"`, `role="treeitem"`,
  `aria-level`, `aria-selected`, `aria-expanded`), with keyboard navigation
  (Enter / Space to select, ArrowLeft / ArrowRight to collapse / expand).
- Status text on test rows is screen-reader-readable (`sr-only` labels +
  `aria-label` summarising "Failed, cart shows the correct subtotal, 6103
  milliseconds"). Status dots are decorative (`aria-hidden="true"`).
- Tabs primitive (Tree | Diagnostics) follows WAI-ARIA Tabs Pattern with arrow-key
  navigation, roving tabindex, and accessible labels.
- `prefers-reduced-motion: reduce` globally suppresses animations and transitions
  (1ms duration override, scroll-behavior auto).
- Focus indicators on every interactive element: `:focus-visible` with a 2px
  `var(--color-accent)` outline.

Future work: keyboard shortcuts (`n` next-failed, `⌘K` command palette, `?`
cheatsheet) are scaffolded in the footer hint but not yet wired; once wired, the
keyboard story will be fully on par with the mouse story.
