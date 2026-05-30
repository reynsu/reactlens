---
name: reactlens
description: Light browser-window dev tool that puts the React component tree at the centre of E2E test diagnosis.
colors:
  bg: "#e9ebf0"
  window: "#ffffff"
  panel: "#ffffff"
  panel-2: "#f3f5f9"
  panel-3: "#ebeef4"
  border: "#e3e7ee"
  border-strong: "#d6dbe5"
  ink: "#1d2230"
  text: "#2a3140"
  muted: "#6b7480"
  muted-2: "#8a93a0"
  accent: "#5a57e6"
  accent-soft: "#ecebff"
  accent-ink: "#3d3ab8"
  pass: "#2ea043"
  pass-soft: "#e6f4ea"
  pass-ink: "#166534"
  fail: "#e5484d"
  fail-soft: "#fdecec"
  fail-ink: "#861c20"
  warn: "#e08a1e"
  warn-soft: "#fdf3e1"
  warn-ink: "#92400e"
  skip: "#aeb4c0"
  evidence-bg: "#fef3c7"
  evidence-fg: "#78350f"
  code-tag: "#4c46d8"
  code-key: "#475569"
  code-string: "#b8430a"
  code-number: "#0e7490"
  code-bool: "#0e7490"
  code-punct: "#94a3b8"
  code-sentinel: "#6b7280"
typography:
  display:
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.005em"
  headline:
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "-0.005em"
  title:
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "12.5px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
  body:
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
    fontFeature: "'ss01', 'cv01', 'cv09'"
  label:
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.07em"
  code:
    fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.85
    letterSpacing: "-0.005em"
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.window}"
    rounded: "{rounded.sm}"
    padding: "4px 10px"
  button-primary-hover:
    backgroundColor: "{colors.accent-ink}"
  button-ghost:
    backgroundColor: "{colors.window}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "4px 12px"
  stat-pill-pass:
    backgroundColor: "{colors.pass-soft}"
    textColor: "{colors.pass-ink}"
    rounded: "{rounded.pill}"
    padding: "4px 9px"
  stat-pill-fail:
    backgroundColor: "{colors.fail-soft}"
    textColor: "{colors.fail-ink}"
    rounded: "{rounded.pill}"
    padding: "4px 9px"
  panel-surface:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
  tab-selected:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.md}"
    padding: "5px 12px"
  test-row-selected:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.md}"
    padding: "9px 14px"
  badge-real-bug:
    backgroundColor: "{colors.fail-soft}"
    textColor: "{colors.fail}"
    rounded: "{rounded.pill}"
    padding: "2px 9px"
  badge-test-bug:
    backgroundColor: "{colors.warn-soft}"
    textColor: "{colors.warn}"
    rounded: "{rounded.pill}"
    padding: "2px 9px"
---

# Design System: reactlens

## 1. Overview

**Creative North Star: "The Watchmaker's Bench"**

reactlens is the workspace of a careful technician. The dashboard is the bench:
flat, well-lit, materials laid out where you need them. The React component tree
is the movement under the loupe, magnified and rendered as code so you can read
the gears. The browser-window chrome (traffic-light dots, rounded surface, soft
ambient drop-shadow floating over a pearl-grey desk) places the work in a frame
without dressing it. Every other element of the dashboard exists to serve the
moment of diagnosis: which test failed, what the component was rendering, where
in the code to make the change.

The voice is **Technical, Honest, Opinionated** (carried verbatim from PRODUCT.md).
The aesthetic is **product-restrained**, not editorial: dense where information
demands it, generous where the operator needs to breathe. Indigo (`#5a57e6`)
is the brand colour but appears on ≤10% of any surface; it carries selection,
primary action, and the brand mark, nothing decorative. Semantic state colours
(green / red / amber / slate) appear only where status is the actual content.

What this system explicitly rejects, restated here from PRODUCT.md:

- Cluttered tab UIs (Cypress dashboard) and admin-panel walls of step output
  (GitHub Actions runs).
- Flat dev tooling that doesn't have a design system at all (Vitest UI,
  Playwright UI's bare functional surface).
- Production-ops dashboards (Sentry, Datadog, Grafana) that load with metrics
  before they load with intent.
- Component-cataloguing patterns (Storybook): we render the live tree, not
  the catalogue. The tree shown in the dashboard belongs to the running test.
- IDE-as-a-product surfaces (Cursor, Zed): we admire them, we are not them;
  reactlens is one lens, focused on one job.

**Key Characteristics:**

- Layered light surfaces (`bg` → `window` → `panel` → `panel-2` → `panel-3`), each
  ~1-2% luminance step apart, so depth reads without grayness.
- Two-family typography: Inter for sans body / UI, JetBrains Mono for the tree
  and code. No display face; weight contrast carries hierarchy.
- A semantic colour ramp per state (`-soft` tinted bg + `-ink` deeper text)
  so badges, pills, and rows read consistently across the surface.
- ARIA tree pattern + full keyboard navigation + WCAG 2.2 AA contrast: the
  accessibility story is part of the design, not bolted on.
- A 3-column grid (`tests / preview / inspector`) that collapses gracefully:
  3-col at ≥1100px → tighter at 900-1099px → 2-col with horizontal-strip
  test list at 600-899px → vertical stack at <600px.

## 2. Colors: The Bench Palette

The palette is a layered light-gray field anchored by a single indigo accent and
four semantic state hues with consistent triplets (base / soft / ink). No
decorative colour: every value carries meaning.

### Primary

- **Probe Indigo** (`#5a57e6`): the brand. Used for the active tab, the selected
  test row, the brand-mark glyph gradient, primary-action buttons (Apply Fix),
  the active-owner underline under the React fiber the current Playwright step
  is acting on, the run-mode pill ring. Never decorative.
- **Lens Mist** (`#ecebff`): the tinted bg behind selected rows and the active
  tab. Soft enough to coexist with the panel; bright enough to be unmistakable.
- **Probe Sapphire** (`#3d3ab8`): the deeper indigo used for text against
  `Lens Mist` (selected test title, active tab label) so contrast stays ≥4.5:1.

### Tertiary (semantic state)

The four state colours each ship as a triplet: the saturated base for dots and
single-character glyphs, the tinted soft for pill backgrounds, the deep ink for
text on the soft tint. The pattern is uniform across pass / fail / warn / skip.

- **Verified Green** (`#2ea043` / soft `#e6f4ea` / ink `#166534`): passing tests,
  pass step pills in the timeline, the "Expected" diff value, the +/`add` diff
  line gutter.
- **Stop Signal** (`#e5484d` / soft `#fdecec` / ink `#861c20`): failing tests,
  the EXPECT FAILED badge, the "Received" diff value, the -/`del` diff line
  gutter, the breadcrumb status dot when the selected test is red.
- **Workshop Amber** (`#e08a1e` / soft `#fdf3e1` / ink `#92400e`): running /
  timing-out states, the test-bug classification, the running-status row dot
  in the test list (with its `pulse` animation).
- **Bench Slate** (`#aeb4c0`): skipped tests, no other use.

### Neutral

- **Studio Pearl** (`#e9ebf0`): the desk the bench floats on (page bg outside the
  window chrome).
- **Bench White** (`#ffffff`): the window surface; the panel surface.
- **Tooltray Mist** (`#f3f5f9`): hover fills and subtle differentiated panels
  (timeline, tabs strip, error block).
- **Tooltray Slate** (`#ebeef4`): nested fills inside `Tooltray Mist` panels.
- **Bench Frame** (`#e3e7ee`): standard 1px dividers between surfaces.
- **Bench Frame Strong** (`#d6dbe5`): the slightly heavier border used on inputs
  and chip outlines (still 1px, just darker).
- **Editor Black** (`#1d2230`): hero text, brand wordmark, breadcrumb step label,
  selected diagnostic root cause, h1/h2 in the panels.
- **Console Slate** (`#2a3140`): default body text. 13.03:1 contrast on
  `Bench White`.
- **Margin Slate** (`#6b7480`): meta / muted text. 4.74:1 contrast on
  `Bench White` (deliberately raised from `#9aa2b1` after the May 2026 audit;
  the muted-but-readable bar).
- **Margin Slate 2** (`#8a93a0`): the lightest readable muted, used for separator
  glyphs (the `›` in the breadcrumb), the pending-status dot.

### Code-syntax palette

A second small palette only for code: the tree-as-hero renderer and the diff
patch renderer (via prism-react-renderer) both pull from these. Same tokens =
same visual vocabulary across the inspector and the patches.

- **Tag Indigo** (`#4c46d8`): JSX tags (`<RouterProvider>`), JS keywords (`return`,
  `const`), function names. Rendered weight 600.
- **Key Slate** (`#475569`): prop names (`testid:`), JSX attribute names.
- **String Rust** (`#b8430a`): all string values, including JSX attribute strings.
- **Number Teal** (`#0e7490`): numbers, booleans, `null`, `undefined`.
- **Punctuation Slate** (`#94a3b8`): brackets `< > { } [ ]`, separators `: ,
  =>`, operators.
- **Sentinel Gray** (`#6b7280`, italic): probe-emitted non-values (`[Function]`,
  `[Circular]`, `[Symbol(...)]`). Italic + same colour as `Margin Slate` so it
  reads as "marker, not data".

### Named Rules

**The 10% Indigo Rule.** Probe Indigo (`#5a57e6`) appears on ≤10% of any
rendered surface. Its rarity is the point: it is what the operator is supposed
to look at. When it appears everywhere it stops carrying selection.

**The Triplet Rule.** Every semantic state colour ships as a triplet:
base / soft / ink. Pills use `bg = soft`, `text = ink`, `border = base @ 18-25% alpha`.
If a state can't supply the triplet, it can't ship a pill.

**The Same-Code-Two-Surfaces Rule.** The component tree and the patch diff
both render code; both must use the code-syntax palette unmodified. A `return`
keyword in the tree and a `return` keyword in a patch are the same colour. The
operator's eye learns the syntax once.

## 3. Typography

**Display / Body Font:** Inter (with `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` fallback)
**Code Font:** JetBrains Mono (with `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` fallback)

**Character:** A single well-tuned sans (Inter) carries all UI weights from
hero (`600`) to body (`400`), with weight + size + letter-spacing doing the
hierarchy work. JetBrains Mono is reserved for code surfaces (the React tree,
prop / hook values, syntax-highlighted patches, file paths, kbd hints) so the
moment text becomes code it is also visibly code. No display face: the system
is technical, not editorial.

### Hierarchy

- **Display** (600, 14px, 1.3): the test title in the preview header
  (`▸ cart shows the correct subtotal`). The largest weighted text on any
  given screen.
- **Headline** (500, 13px, 1.4): selected test row title (when the indigo
  selection ink lifts it), the active-step-banner step name, the panel-header
  test list rows.
- **Title** (600, 12.5px, 1.4): the brand wordmark "reactlens" in the header.
- **Body** (400, 13px, 1.5, OpenType `ss01, cv01, cv09` on): every other piece
  of UI text. Anti-aliased. 65-75ch line cap doesn't apply (no prose blocks
  long enough); the diagnostic root-cause sentence is the longest body block
  and runs naturally within the inspector tab width.
- **Label** (600, 11px, line-height 1, letter-spacing 0.07em, uppercase): the
  `TESTS / COMPONENT TREE / DIAGNOSTICS` panel headers. Used as eyebrows
  intentionally and sparingly (one per panel), not on every section.
- **Code** (400, 13.5px, line-height 1.85, letter-spacing -0.005em, JetBrains
  Mono): the React tree, prop / hook values, diff lines, file paths, the
  RunPicker option text. The line-height of 1.85 is deliberate: more air than
  body so the syntax tokens have room to read as code.

### Named Rules

**The Hero-Is-The-Tree Rule.** The component tree is rendered at 13.5px
JetBrains Mono with the generous 1.85 line-height. It is the only "display"
surface in the dashboard. Body UI never crowds the tree.

**The One-Eyebrow-Per-Panel Rule.** Each panel may declare one uppercase
`Label` header. Sub-sections inside the panel must use other weight + size
contrasts, never additional eyebrows.

**The No-Display-Font Rule.** No serif, no extra sans, no display face. Two
families total. The technical brand is carried by JetBrains Mono used boldly,
not by adding a third typeface.

## 4. Elevation

The system is **flat by default**. Depth is conveyed by layered surface
luminance (Studio Pearl → Bench White → Tooltray Mist → Tooltray Slate) and by
1px borders in two strengths, not by shadows. The only shadows used are
ambient / atmospheric, not structural.

### Shadow Vocabulary

- **Window Ambient** (`box-shadow: 0 12px 40px rgba(40,49,64,0.10)`): the soft
  drop shadow under the app window itself, making the whole dashboard appear
  to hover one finger above the Studio Pearl page. The only persistent shadow
  on the whole UI.
- **Modal Lift** (`box-shadow: 0 20px 50px color-mix(in srgb, var(--text) 25%, transparent)`):
  the Apply Fix confirmation card, lifted noticeably above its `backdrop-filter:
  blur(2px)` backdrop. Heavier than Window Ambient because it interrupts the flow.
- **Step Pill Active** (`box-shadow: 0 2px 8px rgba(90,87,230,0.30)`): the only
  on-element shadow, on the currently-active fail step in the step timeline.
  Indigo-tinted: the shadow itself carries the brand.
- **Stat Dot Halo** (`box-shadow: 0 0 0 3px rgba(229,72,77,0.10)`): a 3px
  semi-transparent ring around the fail status dot on test rows. Reads as a
  soft pulse rather than a shadow per se.

### Named Rules

**The Flat-By-Default Rule.** Surfaces are flat at rest. Depth comes from
luminance steps (one of five named surfaces) and 1px borders, not from shadows.

**The Ambient-Only Rule.** Shadows are atmospheric: they signal "this thing
floats / lifts / pulses", never "this thing is heavy". No cards stack shadow
on shadow. The window and the modal each get one; nothing else gets two.

## 5. Components

For each component: a one-line character note, then shape / colour / state
behaviour. Snippets and the renderable HTML/CSS live in
`.impeccable/design.json`; this section is the spec, not the bundle.

### Buttons

- **Shape:** 6px radius (`rounded.sm`). Compact horizontal padding (`4px 10px`)
  to read as inline controls in dense panels, not as block primary actions.
- **Primary (Apply Fix):** `bg = Probe Indigo`, `text = Bench White`, `border:
  1px solid Probe Indigo`. Hover: `filter: brightness(1.06)`. Affirmative
  action only; the visual weight matches the consequence of the click (apply
  a code patch). The May 2026 audit specifically moved this away from
  `Stop Signal` red — Apply Fix is the affirmative path, not the destructive
  one; the colour now says approve, not danger.
- **Ghost (Copy as git apply):** `bg = transparent`, `text = Margin Slate`,
  `border: 1px solid Bench Frame`. Hover: `bg = Tooltray Mist`.
- **Modal Confirm:** uses Primary; modal Cancel uses Ghost. The pair lives in
  the Apply Fix confirmation dialog.

### Stat Pills (header)

Right-aligned cluster in the header chrome: passed / failed / total / duration /
run-mode. Each pill is a 999px rounded inline-flex of `glyph + number`. Numbers
use `font-feature-settings: 'tnum'` (tabular nums) so they don't shift.

- **Pass:** `bg = Verified Green soft`, `text = Verified Green ink`, `border =
  Verified Green @ 18% alpha`.
- **Fail:** `bg = Stop Signal soft`, `text = Stop Signal ink`, `border = Stop
  Signal @ 20% alpha`.
- **Neutral (counts, duration):** `bg = Bench White`, `text = Editor Black`,
  `border = Bench Frame`.

### Run Mode Pill

The dashboard's mode indicator: replay / live / reconnecting. Same shape as the
stat pills, but coloured with the brand accent (live + replay both use indigo;
reconnecting flips to Stop Signal soft + an animated pulsing inner dot).

### Filter Chips (test-list filters)

Segmented control of three chips (All / Failed / Passed). Each chip uses
`flex: 1 1 0` so all three share row width equally; the label hugs the left,
the count chip hugs the right via `justify-content: space-between`.

- **Default:** `bg = Bench White`, `text = Margin Slate`, `border = Bench Frame`.
  Count badge: `bg = Tooltray Mist`, `text = Margin Slate`.
- **Active:** `bg = Editor Black`, `text = Bench White`, `border = Editor Black`.
  Count badge: `bg = white @ 18% alpha`, `text = Bench White`.
- **Fail variant (Failed chip when inactive):** `border = Stop Signal @ 30% alpha`,
  count `bg = Stop Signal soft`, count `text = Stop Signal ink` — the failing
  count gets brand-state weight even before the user clicks the chip.

### Test Rows

The atomic unit of the test list. 3-column grid: 14px status dot, title (flex),
duration (mono, tabular nums).

- **Default:** `bg = transparent`. Hover: `bg = Tooltray Mist`.
- **Selected:** `bg = Lens Mist`, `box-shadow: inset 0 0 0 1px rgba(90,87,230,0.20)`,
  `title text = Probe Sapphire`, `font-weight: 500`. No side stripe.
- **Status dot:** 9px circle, `bg = state base colour`. Fail dots additionally
  carry a 3px soft halo (`Stat Dot Halo`). Pending uses `box-shadow: inset 0 0 0 1.5px Margin Slate`
  (hollow ring) to distinguish from filled-gray skipped.

### Cards / Containers

Two card forms:

- **Panel chrome:** `bg = Bench White`, no shadow, separated from neighbours by
  1px `Bench Frame`. The three columns of the layout are panels.
- **Inline cards inside a panel** (the structured error block, the
  selected-node-card under the tree, the diagnostics card): `bg = Tooltray Mist`,
  `border = 1px Bench Frame`, `border-radius = 8px (rounded.md)`. Internal
  padding 14px / 16px (`spacing.lg`). Never nested cards.

### Inputs

- **Search input (test filter):** `bg = Bench White`, `border = 1px Bench
  Frame Strong`, `border-radius = 8px (rounded.md)`, leading magnifier icon
  inset 10px, trailing `⌘F` kbd hint inset 6px. Focus: `border = Probe Indigo`,
  `box-shadow: 0 0 0 3px rgba(90,87,230,0.12)` (a soft outer glow ring, not a
  black outline). Placeholder text is `Margin Slate 2` so it sits under the
  filled-text contrast bar (the placeholder is deliberately quieter
  than typed input).

### Tabs (Inspector primitive)

The Tree | Diagnostics tabs at the top of the inspector panel. Follows
WAI-ARIA Tabs Pattern (roving tabindex, arrow-key nav, Home/End jumps).

- **Tablist row:** `bg = Tooltray Mist`, sticky top, 1px bottom border.
- **Tab default:** `bg = transparent`, `text = Margin Slate`, label uppercase
  `Label` style.
- **Tab selected:** `bg = Bench White`, `text = Probe Sapphire`, `border = 1px
  Bench Frame Strong`, slight `box-shadow: 0 1px 2px rgba(40,49,64,0.04)` to
  lift it off the tablist surface.
- **Tab badge:** the Diagnostics tab carries a 7px Stop Signal dot with 3px
  soft halo when the selected test failed. Indicates "something to read here"
  without forcing the operator into the tab.

### Navigation (RunPicker + Breadcrumb)

- **RunPicker select:** `bg = Bench White`, `border = 1px Bench Frame`,
  `font-family = inherit`. Native `<select>` (no custom dropdown) for the
  ARIA + keyboard-accessibility baseline. Sits inside the header window-id
  cluster.
- **Breadcrumb (header centre):** status dot + file path (mono) + `›` separator
  (`Margin Slate 2`) + test title (`Editor Black`). All on one line; truncates
  the file path with `text-overflow: ellipsis` and the title same. Full path
  preserved in `title` attribute for tooltip.

### Signature Component: Tree-as-Hero (Component Inspector)

This is the moat made visible. JetBrains Mono 13.5px, line-height 1.85,
each `<ComponentName />` rendered as syntax-coloured code (Tag Indigo bold on
the name, Punctuation Slate on the brackets, Key Slate on `key=` prop names,
String Rust on string values). The active-owner (the fiber the current
Playwright step is acting on) wears `bg = Evidence Yellow` (`#fef3c7`) with
a `Probe Indigo` 2px underline at the bottom edge of the highlighted label.

Selecting a tree node opens a `selected-node-card` inline directly under it:
indented 22px past the node's depth indent, `bg = rgba(90,87,230,0.05)` (a
washed-out Lens Mist), three optional sub-sections (PROPS / HOOKS / SOURCE)
each marked with a `Label`-style eyebrow in `Probe Sapphire` at 70% opacity,
content rendered with the same code-syntax palette. Nested objects render
collapsed by default (`{ … N keys }` as a clickable button); `[Function: name]`
and `[Circular]` render with `Sentinel Gray` italic. The whole experience
reads as code citing itself.

### Signature Component: Structured Error Block

The Playwright failure summary, parsed and rendered inside the preview column.
A pill-style `EXPECT FAILED` badge in `Stop Signal soft / ink` mono uppercase,
followed by the summary sentence; then a `<dl>` grid of LOCATOR / EXPECTED /
RECEIVED / TIMEOUT with the per-character `<mark class="pw-diff-char">` on the
differing character (`"1[4]"` vs `"1[1]"`); then a collapsible `Call log (N steps)`
via native `<details>`. Replaces what was previously a raw `<pre>` dump of
ANSI escape codes.

### Step Timeline + Slider

Below the browser preview frame. A horizontal scrolling row of `step-pill`
buttons (`→ goto /cart`, `✓ expect "Your cart"`, `✗ expect "14" subtotal`),
each pill colour-coded by status (pass-soft, fail-soft, active-fail solid
indigo with shadow), auto-scrolled into view as `currentIdx` changes. Below
the pills, a thin range slider for precise scrubbing with a counter in
JetBrains Mono tabular nums (`8/8`).

### Floating Kbd Hint Pill

Fixed at bottom-centre of the viewport: a 999px rounded pill containing three
`<kbd>` rendered keys (`n next failed`, `⌘K command palette`, `?` shortcuts).
The future shortcuts story made visible even before it's wired. Soft shadow
(`0 4px 16px rgba(40,49,64,0.06)`) so it floats over the layout without
demanding attention.

## 6. Do's and Don'ts

### Do:

- **Do** preserve the layered light surface scale. New components belong on
  `Bench White` or `Tooltray Mist`; new fills use those tokens, not raw greys.
- **Do** keep the **10% Indigo Rule**: `Probe Indigo` and its `Lens Mist` /
  `Probe Sapphire` derivatives carry brand + selection + primary action only.
  Decorative indigo dilutes the rule.
- **Do** ship semantic state colours as triplets (base / soft / ink). New
  states either use the existing four (pass / fail / warn / skip) or add a
  full triplet, never just one shade.
- **Do** render the React component tree and code patches with the same
  code-syntax palette. Same syntax = same colour. Cross-surface continuity is
  the **Same-Code-Two-Surfaces Rule**.
- **Do** use Inter at weights 400 / 500 / 600 / 700 for everything that isn't
  code; JetBrains Mono for everything that is. Two families, no exceptions.
- **Do** keep new components flat by default. If you need depth, reach for a
  luminance step or a 1px border before reaching for a shadow.
- **Do** honour `prefers-reduced-motion`: every animation gets a 1ms-duration
  override and `scroll-behavior: auto` under the media query.
- **Do** wire keyboard navigation on every interactive component: `Enter` /
  `Space` to activate, arrow keys to traverse, `:focus-visible` with a 2px
  `Probe Indigo` outline.

### Don't:

- **Don't** add a side stripe (`border-left: 4px solid colour` on cards / rows
  / callouts). Use full borders, semantic fill, or nothing. The May 2026
  refactor specifically removed a 3px inset shadow from selected test rows.
- **Don't** use gradient text (`background-clip: text` over a gradient). The
  brand-mark glyph gradient is the only gradient on the dashboard.
- **Don't** add a third type family. Inter + JetBrains Mono is the cap. If
  you reach for a serif display, the dashboard is becoming editorial: that's
  the wrong register.
- **Don't** use uppercase eyebrows on every section. The **One-Eyebrow-Per-Panel
  Rule** is the cap; sub-section hierarchy comes from weight + size, not from
  more eyebrows.
- **Don't** number sections by reflex (`01 / 02 / 03 / …`). The dashboard has
  no ordered process; numbering implies sequence that isn't there.
- **Don't** look like Cypress dashboard's tab forest, Vitest UI's bare
  monospace, Storybook's catalogue, Sentry / Datadog / Grafana's metric grid.
  These are the named anti-references from PRODUCT.md; they target specific
  failure modes the dashboard must keep clear of.
- **Don't** use `Stop Signal` red for affirmative actions. Apply Fix was
  briefly red; the May 2026 audit re-coloured it `Probe Indigo` because the
  click approves a fix, it doesn't destroy anything.
- **Don't** ship a status dot whose meaning depends only on colour. Every
  status row has a screen-reader `sr-only` label (`"Failed, …"`) and the dot
  is `aria-hidden="true"`. Colour is fast; the label is what the assistive
  tech reads.
- **Don't** render code as plain text. Tree nodes, prop values, diff lines:
  every code surface goes through the tokenizer or `prism-react-renderer` so
  `return` is indigo, strings are rust, sentinels are gray italic. Plain
  monospace text is a bug.
- **Don't** let panels overflow horizontally. The patch diff lines wrap with
  `white-space: pre-wrap` + a hanging indent so the `-`/`+` prefix stays at
  the row edge and continuations align under the code. New code surfaces
  follow the same convention.
