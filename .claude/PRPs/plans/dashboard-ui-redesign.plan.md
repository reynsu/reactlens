# Plan: Dashboard UI redesign (light/soft theme + render-as-code)

## Summary
Restyle the reactlens dashboard SPA to match the provided wireframe — a light, soft, rounded "browser window" aesthetic with a monospace, syntax-highlighted React tree — while keeping every current element (test list, browser preview, component inspector, props/hooks/source, diagnostics, run picker, timeline slider, live/replay stats). Any code reference (JSX tags in the tree, prop values, patches) must render **as syntax-highlighted code**, not as a plain string. The UI lives in a separate repo — `@reynsu/reactlens-dashboard-ui` at `../reactlens-dashboard-ui` — so this is cross-repo work; reactlens itself only serves the built bundle.

## User Story
As a developer watching the reactlens dashboard, I want the React tree and prop values to read like real code (colored JSX tags, quoted strings, typed booleans/numbers) in a clean light UI, so that I can scan a failing test's component state at a glance instead of parsing raw JSON strings.

## Problem → Solution
Today the dashboard is a dark theme; the component tree renders `node.name` as plain uncolored text (`CheckoutPage`, not `<CheckoutPage>`), and props render via `<pre>{typeof v === 'string' ? v : JSON.stringify(v)}</pre>` — so a string prop shows as `123` (no quotes, no color), indistinguishable from a number. → A light/soft themed UI matching the wireframe, with a zero-dependency code tokenizer that renders tree nodes as colored JSX tags and prop values typed (`cvv: "123"`, `cvvValid: false`), keeping all panels and behaviors intact.

## Metadata
- **Complexity**: Medium-Large (frontend restyle across 6 components + new tokenizer module; ~8-10 files; mostly CSS + presentational TSX; no protocol/state changes)
- **Source PRD**: N/A (free-form, from a wireframe image)
- **PRD Phase**: N/A
- **Estimated Files**: ~9 in `../reactlens-dashboard-ui`; 1 temporary dep edit in reactlens for local validation (reverted before commit)

---

## Key Decisions (confirmed with maintainer)
1. **Cross-repo scope = redesign + validate locally.** Edit `../reactlens-dashboard-ui` (separate git repo, `main`, clean), build it, and link it into reactlens (`file:` / `pnpm link`) to view live in the sandbox dashboard. **No npm publish, no version bump, no reactlens dep bump** in this plan — those are a noted follow-up once the look is approved.
2. **Syntax highlighting = custom lightweight tokenizer, zero runtime deps.** The package currently has ZERO runtime dependencies; do NOT add Shiki/Prism/highlight.js. Build small presentational helpers that color JSX tags + typed prop values.
3. **`evidence` chip = restyle-only.** Provide the chip styling, but do NOT wire diagnosis-evidence→prop linkage (that needs structured evidence refs the Diagnosis type doesn't carry today). Follow-up.

---

## UX Design

### Before (current, dark)
```
┌ reactlens  [RunPicker]      ✓2 ✗1 −0  2/4 run  ●live ┐  (dark #0d0d10)
├───────────┬─────────────────────────┬───────────────┤
│ TESTS     │  browser frame (black)  │ COMPONENT TREE│
│ ● login   │                         │ CheckoutPage  │  ← plain text
│ ● login   │                         │   cvv: 123    │  ← string w/o quotes
│ ● checkout│                         │ PROPS (table) │
│ ● dashbd  │                         │  name | value │
└───────────┴─────────────────────────┴───────────────┘
```

### After (wireframe, light/soft)
```
╭───────────────────────────────────────────────────────────────╮ ← rounded "window"
│ ● ● ●   localhost:7777 · reactlens dashboard                    │   traffic lights + title
├──────────────────┬───────────────────────┬─────────────────────┤
│ TESTS · 2/4 …     │ ▸ /checkout           │ REACT TREE · STEP 3 │ ← uppercase muted headers
│ 🟢 login …  0.4s  │  ┌───────────────┐    │ ▾ <App>             │ ← colored JSX tags
│ 🟢 login …  0.9s  │  │  form preview │    │   ▾ <RouterProvider>│
│ 🟠 checkout  ⋯    │  └───────────────┘    │    ▾ <CheckoutPage> │
│ 🔴 dashbd … 2.1s  │  [cvv too short]      │   cvv: "123" 🚩evid │ ← quoted+colored string
│                   │  ⌜step: click submit⌟ │   cvvValid: false   │ ← typed boolean
╰──────────────────┴───────────────────────┴─────────────────────╯
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Theme | dark | light/soft, rounded panels | CSS-var palette swap |
| App shell | flat header bar | rounded "browser window" w/ traffic-light dots + `localhost:7777 · reactlens dashboard` title | header restyle only; no behavior change |
| Tree node | `CheckoutPage` plain | `<CheckoutPage>` colored JSX tag | new tokenizer |
| Prop value | `123` (raw pre) | `"123"` string-colored / `false` bool-colored | new tokenizer; replaces kv-table `<pre>` |
| Active fiber | yellow row bg | same highlight, light-theme tuned | keep P9 exact/heuristic logic untouched |
| Diagnostics patch | black code block | light code block, monospace, kept | restyle |
| All panels/elements | present | present (none removed) | "sin dejar de mostrar sus elementos actuales" |

---

## Mandatory Reading (all in `../reactlens-dashboard-ui`)

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/styles.css` | 1-107 | The entire visual language to rewrite: CSS vars (`--bg`/`--panel`/`--text`/`--muted`/`--border`/`--pass`/`--fail`/`--skip`/`--warn`/`--accent`), layout grid, `.test-row`, `.tree`, `.kv-table`, `.diagnostics`, badges |
| P0 | `src/components/ComponentInspector.tsx` | 67-103, 184-235 | `PropsTable`/`HooksTable` (the `<pre>` JSON that must become tokenized) + the `.tree` node render (`node.name` → JSX tag). Keep flatten/expand + P9 highlight logic intact |
| P0 | `src/App.tsx` | 459-523 | Layout shell: `.app`/`.header`/`.layout`/`.preview-column`/`.panel`, stats, RunPicker mount. Header becomes the browser-window chrome |
| P1 | `src/components/TestList.tsx` | all | Status icon (`.icon.pass/fail/skip/run`) → colored dots; row layout + panel header text (`TESTS · N/M passed`) |
| P1 | `src/components/DiagnosticsPanel.tsx` | all | Badges per classification, evidence list, patch block — restyle to light + render patch as code |
| P1 | `src/components/BrowserPreview.tsx` | all | Frame card + `▸ /route` header + `step:` pill styling |
| P1 | `src/components/RunPicker.tsx` + `TimelineSlider.tsx` | all | Restyle select + slider to light theme |
| P1 | `src/types.ts` | all | `ComponentNode` (`name`, `key`, `props`, `hooks`, `source`), `HookSnapshot`, `Diagnosis` shapes the tokenizer consumes |
| P2 | `vite.config.ts`, `package.json`, `tsconfig*.json` | all | Build (`pnpm build` = types + `vite build` → `dist/web`), test (`vitest`), zero runtime deps invariant |
| P2 | reactlens `src/dashboard/server.ts` | 49-77 | How reactlens resolves + serves the bundle (`require.resolve('@reynsu/reactlens-dashboard-ui/package.json')` → `dist/web`) — informs local-link validation |

## External Documentation
No external research needed — plain CSS + React 18 + a hand-rolled tokenizer; all established internal patterns.

---

## Patterns to Mirror

### THEME_TOKENS (CSS custom properties are the single source of palette)
// SOURCE: ../reactlens-dashboard-ui/src/styles.css:2-15
```css
:root { --bg:#0d0d10; --panel:#16161b; --border:#2a2a32; --text:#ececec; --muted:#8b8b96;
  --accent:#6a8cff; --pass:#4ade80; --fail:#f87171; --skip:#a1a1aa; --warn:#fbbf24; }
```
Keep the SAME variable NAMES; only change values to the light palette + ADD syntax-token vars (`--code-tag`, `--code-string`, `--code-bool`, `--code-number`, `--code-punct`). Every component already reads these vars, so a palette swap re-themes the whole app.

### LAYOUT_GRID
// SOURCE: ../reactlens-dashboard-ui/src/styles.css:23,60
```css
.app { display:grid; grid-template-rows:auto 1fr; height:100vh; }
.layout { display:grid; grid-template-columns:320px 1fr 360px; height:100%; overflow:hidden; }
```
Preserve the 3-column structure; the wireframe is the same layout.

### TREE_NODE_RENDER (the change target)
// SOURCE: ../reactlens-dashboard-ui/src/components/ComponentInspector.tsx:215
```tsx
{node.name}   // ← becomes <JsxTag name={node.name} open={open} /> rendering `<CheckoutPage>`
```

### PROP_VALUE_RENDER (the change target)
// SOURCE: ../reactlens-dashboard-ui/src/components/ComponentInspector.tsx:97
```tsx
<pre>{typeof v === 'string' ? v : JSON.stringify(v, null, 2)}</pre>
// ← becomes <CodeValue value={v} /> rendering "123" (quoted, colored) / false / 42 / {…}
```

### STATUS_ICON
// SOURCE: ../reactlens-dashboard-ui/src/styles.css:71-76 (.icon.pass/fail/skip/run + pulse)
Reuse the pass/fail/skip/run color classes; render as filled dots (●) like the wireframe.

### TEST_STRUCTURE
// SOURCE: ../reactlens-dashboard-ui/src/lib/patch-to-unified-diff.test.ts (+ vitest/testing-library devDeps)
Vitest + @testing-library/react render tests. New tokenizer gets a render test asserting string vs number vs bool produce distinct token classes.

---

## Files to Change (in `../reactlens-dashboard-ui`)

| File | Action | Justification |
|---|---|---|
| `src/styles.css` | UPDATE (large) | Light palette via CSS vars, rounded "window" chrome, panel headers, code-token colors, restyle test-row/tree/kv→code/diagnostics |
| `src/lib/code-render.tsx` | CREATE | Zero-dep tokenizer: `JsxTag`, `CodeValue` (string/number/boolean/null/object), `PropLine` (`key: value`). Pure presentational |
| `src/lib/code-render.test.tsx` | CREATE | Render tests: string→quoted+`code-string`, number→`code-number`, bool→`code-bool`, JSX tag→`code-tag` |
| `src/components/ComponentInspector.tsx` | UPDATE | Tree node uses `JsxTag`; `PropsTable`/`HooksTable` use `CodeValue`/`PropLine`. Keep flatten/expand + P9 highlight logic byte-for-byte |
| `src/App.tsx` | UPDATE (small) | Header → browser-window chrome (traffic-light dots + `localhost:7777 · reactlens dashboard`); panel header copy. No state/reducer change |
| `src/components/TestList.tsx` | UPDATE | Colored status dots + panel-header summary text |
| `src/components/DiagnosticsPanel.tsx` | UPDATE | Light restyle; render patch as code (reuse code block styling); keep badges/evidence/apply-fix |
| `src/components/BrowserPreview.tsx` | UPDATE | Light frame card + `▸ /route` header + `step:` pill |
| `src/components/RunPicker.tsx`, `src/components/TimelineSlider.tsx` | UPDATE | Light-theme select + slider |
| reactlens `package.json` | TEMP edit (revert) | Point `@reynsu/reactlens-dashboard-ui` → `file:../reactlens-dashboard-ui` for local validation; revert before any commit |

## NOT Building
- **No npm publish / version bump / reactlens dep bump** — local validation only (follow-up).
- **No new runtime dependency** — tokenizer is hand-rolled; package stays zero-dep.
- **No protocol/state/reducer changes** — `App.tsx` reducer, `types.ts`, the WS contract, P9 testIdIndex logic, replay/timeline, apply-fix flow stay functionally identical. This is presentational.
- **No evidence→prop linkage** — the yellow `evidence` chip is styled but not wired to diagnosis evidence.
- **No dark-mode toggle** — single light theme matching the wireframe (the `color-scheme` line may stay for form controls but the palette is light).
- **No changes in the reactlens repo** beyond the temporary, reverted dep-link for validation.

---

## Step-by-Step Tasks

### Task 1: Light theme tokens
- **ACTION**: Rewrite the `:root` palette in `src/styles.css` to the wireframe's light/soft values (e.g. `--bg` ~`#f4f5f7`, `--panel` `#ffffff`, `--panel-2` ~`#eef0f4`, `--border` ~`#e3e6ec`, `--text` ~`#1c2230`, `--muted` ~`#8a909c`, soft `--accent` indigo). Keep `--pass/--fail/--skip/--warn` as legible light-bg variants. ADD `--code-tag` (indigo/purple), `--code-string` (red/orange), `--code-bool`/`--code-number`, `--code-punct` (muted).
- **MIRROR**: THEME_TOKENS — same var names.
- **VALIDATE**: `pnpm build:web` succeeds; opening the bundle shows a light app with no hard-coded dark colors leaking (grep for literal `#0d0d10`/`black` in components).

### Task 2: Browser-window chrome (header)
- **ACTION**: Restyle `.header` into the rounded window top bar: three traffic-light dots + left title `localhost:7777 · reactlens dashboard`. Keep RunPicker + stats + live/replay indicator (move into the chrome). Round the outer `.app`/`.layout` container corners + soft shadow.
- **MIRROR**: LAYOUT_GRID (don't change the grid).
- **GOTCHA**: Keep `h1 reactlens` accessible (visually-hidden or fold into the title) — don't drop the landmark.
- **VALIDATE**: Header matches wireframe; RunPicker/stats still function.

### Task 3: Code tokenizer module (`src/lib/code-render.tsx`)
- **ACTION**: Create pure presentational helpers:
  - `JsxTag({ name, open?, hasChildren? })` → renders `<App>` / `<App` with `code-tag`-classed angle brackets + name.
  - `CodeValue({ value })` → `string` → `"…"` in `code-string`; `number` → `code-number`; `boolean`/`null` → `code-bool`; object/array → compact `{…}`/`[…]` expandable or `JSON` in code colors.
  - `PropLine({ name, value })` → `<span class="code-key">name</span>: <CodeValue/>`.
- **MIRROR**: PROP_VALUE_RENDER / TREE_NODE_RENDER targets; classes map to the `--code-*` vars.
- **IMPORTS**: React only.
- **GOTCHA**: Must handle the depth-limited/serialized props the probe emits (already JSON-safe). NaN serializes to `null` over the wire — render `null`, don't crash.
- **VALIDATE**: `code-render.test.tsx` asserts each type → expected token class + text (incl. quotes around strings).

### Task 4: Tree renders as code
- **ACTION**: In `ComponentInspector.tsx` tree map (line ~215), replace `{node.name}` with `<JsxTag name={node.name} open={open} hasChildren={hasChildren} />`; keep the toggle, `key=` suffix, and the P9 `isActive`/`isExact` highlight + banner exactly as-is.
- **MIRROR**: TREE_NODE_RENDER.
- **GOTCHA**: Do NOT touch `flatten`, `expanded`, `exactIds`/`matchers`, or the testIdIndex resolution — those are load-bearing P9 logic, not visual.
- **VALIDATE**: Tree shows `<App>`/`<CheckoutPage>` colored; expand/collapse + active highlight still work.

### Task 5: Props & hooks render as code
- **ACTION**: Replace `PropsTable`/`HooksTable` `<pre>{…}</pre>` cells with `PropLine`/`CodeValue`. Layout can stay a table or become a flat `key: value` list like the wireframe (`cvv: "123"`).
- **MIRROR**: PROP_VALUE_RENDER.
- **VALIDATE**: A string prop shows quoted+colored (`"123"`), a boolean shows `false` typed — distinguishable at a glance; `(no props)` empty-state preserved.

### Task 6: Restyle remaining panels (TestList, Diagnostics, BrowserPreview, RunPicker, TimelineSlider)
- **ACTION**: Apply the light theme: filled status dots (TestList), light badges + code-styled patch block (Diagnostics), light frame card + `▸ /route` + `step:` pill (BrowserPreview), light select/slider. All elements preserved.
- **MIRROR**: STATUS_ICON; diagnostics badge classes (`.badge.real-bug` etc.) keep their semantic colors, light-tuned.
- **VALIDATE**: Every panel renders in light theme; diagnostics badges (real-bug/test-bug/flaky/env-issue), evidence list, patch, apply-fix button all visible & styled.

### Task 7: Build, test, and link-validate against reactlens + sandbox
- **ACTION**: In `../reactlens-dashboard-ui`: `pnpm typecheck && pnpm test && pnpm build`. Then in reactlens: temporarily set `@reynsu/reactlens-dashboard-ui` to `file:../reactlens-dashboard-ui`, `pnpm install`, `pnpm build`. From `../reactlens-sandbox`: `npx reactlens run` and open `localhost:7777` to see the live redesigned dashboard against a real run (the sandbox already has captured runs with a tree + diagnoses).
- **GOTCHA**: reactlens's `findStaticDir` resolves the package's `dist/web` — the linked package MUST be built (`dist/web/index.html` present) or the server shows the "Frontend bundle not found" fallback. Revert the `file:` dep edit in reactlens before committing anything there.
- **VALIDATE**: Dashboard at :7777 shows the light wireframe look with the tree as colored code; all panels populated from the sandbox run.

---

## Testing Strategy

### Unit Tests (vitest + @testing-library/react, in dashboard-ui repo)
| Test | Input | Expected | Edge? |
|---|---|---|---|
| `CodeValue` string | `"123"` | text `"123"` with `.code-string` class | |
| `CodeValue` number | `42` | `42` with `.code-number` | |
| `CodeValue` boolean | `false` | `false` with `.code-bool` | |
| `CodeValue` null | `null` | `null` with `.code-bool` | NaN-over-wire edge |
| `JsxTag` | `name="App"` | renders `<App>` with `.code-tag` | |
| `ComponentInspector` tree | snapshot tree | nodes render as JSX tags; active fiber highlighted | keep P9 test if present |

### Edge Cases Checklist
- [ ] Empty props → `(no props)` preserved
- [ ] Deeply nested / object prop values render without crashing
- [ ] `null`/NaN-as-null value
- [ ] Long string prop wraps (no overflow)
- [ ] Replay mode + timeline slider still re-themes correctly
- [ ] Active-fiber highlight legible on the light background

---

## Validation Commands

### Dashboard-ui repo (where the work happens)
```bash
cd ../reactlens-dashboard-ui
pnpm typecheck && pnpm test && pnpm build
```
EXPECT: zero type errors, tests green, `dist/web/index.html` produced.

### Local link + reactlens build
```bash
cd ../reactlens   # temporarily: "@reynsu/reactlens-dashboard-ui": "file:../reactlens-dashboard-ui"
pnpm install && pnpm build
```
EXPECT: reactlens builds; server resolves the linked bundle.

### Browser validation (the real check)
```bash
cd ../reactlens-sandbox && npx reactlens run   # open http://localhost:7777
```
EXPECT: light wireframe UI; React tree shows `<App>`/`<CheckoutPage>` as colored code; prop `cvv: "123"` quoted+colored, `cvvValid: false` typed; test list dots; diagnostics styled. All current panels present.

### Manual Validation
- [ ] Matches the wireframe aesthetic (light, soft, rounded window, traffic lights)
- [ ] Tree + props read as code, not strings
- [ ] No element from the current dashboard is missing
- [ ] Revert the reactlens `file:` dep edit afterward (`git checkout package.json pnpm-lock.yaml`)

---

## Acceptance Criteria
- [ ] All tasks completed in `../reactlens-dashboard-ui`
- [ ] `pnpm typecheck && pnpm test && pnpm build` green there
- [ ] Tokenizer renders strings/numbers/booleans/JSX tags as distinct colored code
- [ ] Tree + props no longer render code as raw strings
- [ ] Every current dashboard element still present and functional
- [ ] Live look verified in the sandbox dashboard
- [ ] reactlens repo left unchanged (temp dep edit reverted)

## Completion Checklist
- [ ] CSS-var palette swap (names unchanged) — no leaked hard-coded dark colors
- [ ] Zero new runtime dependencies
- [ ] P9 highlight / replay / apply-fix logic untouched (presentational only)
- [ ] Tests follow the existing vitest + testing-library pattern
- [ ] Self-contained — no codebase searching needed during implementation

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Touching the tree/props refactor breaks P9 highlight or expand/collapse | Medium | High | Change ONLY the rendered node label / value cells; leave flatten/expand/exactIds logic byte-for-byte; keep any existing inspector test green |
| Linked package serves a stale `dist/web` (server fallback page) | Medium | Medium | Always `pnpm build` dashboard-ui before linking; verify `dist/web/index.html` exists |
| Forgetting to revert reactlens's `file:` dep edit | Medium | Medium | Explicit revert step in Task 7 + acceptance criteria |
| Object/array prop values are large/deep | Low | Low | CodeValue collapses objects to `{…}` (expandable) rather than dumping full JSON |
| Light palette hurts contrast/a11y | Low | Medium | Pick AA-contrast text/muted on the chosen bg; the dashboard itself can be axe-checked |

## Notes
- The dashboard SPA is NOT in the reactlens repo — `src/dashboard/web/` was removed when the UI was extracted to `@reynsu/reactlens-dashboard-ui` (CLAUDE.md §15 / ADR-0005). reactlens only serves the built bundle via `src/dashboard/server.ts findStaticDir`.
- Because ADR-0005 paused further extractions and the dashboard-ui has a single consumer, shipping this redesign (publish + bump) is deliberately deferred to a follow-up once the look is approved.
- The wireframe's `evidence` chip implies a future "diagnosis evidence ↔ tree prop" linkage; the Diagnosis type today carries evidence as free-text bullets, so that wiring is a separate feature.
- The sandbox at `../reactlens-sandbox` already has persisted runs with a real component tree + diagnoses — ideal for eyeballing the redesign without re-running.
