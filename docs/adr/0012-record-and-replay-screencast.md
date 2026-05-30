# Record the CDP screencast as a replayable frame track, not just one frame per step

Status: accepted.

## Context

The dashboard Preview panel shows the browser of the test under test. During a **live** run
the Playwright fixture (`templates/fixtures.ts`, `attachScreencast`) starts a **continuous CDP
screencast** (`Page.startScreencast`, jpeg) on the very Chromium page Playwright drives, ACKs
every frame, and forwards each one as a `frame` event over the dashboard WS. So while a test is
running, the operator already sees the real thing — clicks, navigations, form fills — as live
video, not a snapshot.

Two things make it *feel* like "just a snapshot":

1. The motion only exists during the few seconds the test runs. Once the test ends the
   screencast stops and the Preview is left showing the last frame.
2. The persistor (`src/runner/event-persistor.ts`) writes every frame of a step to the **same
   file** `frames/<testId>/<stepId>.jpg`, so each frame overwrites the previous one. On disk
   only the **last frame per step** survives. Replay of a past run (the `TimelineSlider`) is
   therefore per-step stills, never video.

An `<iframe>` embedding the app under test would be a **different, un-driven** Chromium — it
would show none of the test's actions — so it is the wrong tool for "watch the test". The only
faithful live view is mirroring Playwright's browser, which the CDP screencast already does.

(Terminology: in this codebase **"Snapshot"** is the component-tree capture per step
[CLAUDE.md §14]; the browser image is a **"frame"**. This ADR adds a **frame track** — the
recorded per-frame stream for a test — and changes nothing about component snapshots.)

## Decision

Record the full screencast as a replayable **frame track** and play it back, in both live and
replay, instead of keeping only one frame per step.

- **Storage: a sequence of timestamped jpegs, no ffmpeg.** Each screencast frame is persisted as
  `frames/<testId>/<seq>.jpg` (monotonic per test) and indexed by a per-frame JSONL line
  carrying `ts` + `stepId` + `frameRef`. Playback swaps the `<img>` src at the recorded cadence.
  This reuses the existing jpeg-frame infrastructure and adds **no native binary** — ffmpeg was
  rejected because a native encoder cuts against the zero-friction install and the bundled
  shape of the tool.
- **Protocol (§9): extend `frame` additively.** Add an optional `timestamp?: number` to the
  `frame` event (sourced from `Page.screencastFrame` metadata), validated through
  `parseRunEvent` like every other ingestion. The disk `frame` line becomes **per-frame**
  (no overwrite). This is a coordinated change across runner / persistor / server / frontend in
  one commit, per CLAUDE.md §13. A new dedicated event type was rejected — it would duplicate
  the "frame" concept across all five ingestion points for no gain.
- **Playback: a video transport in the Preview panel**, independent of the step `TimelineSlider`.
  Play/pause + a time scrubber play the frame track; the step slider still drives the
  component-tree / a11y dimension per step. Scrubbing the video may optionally sync the step
  slider to the step containing the current timestamp. The step slider is **not** replaced —
  the per-step semantics it gives the inspector are kept.
- **Rate + retention: one ~15fps stream, bounded retention.** The screencast runs at ~15fps
  (`everyNthFrame`) — enough to follow clicks/navigations — feeding **both** live and recording
  from a single stream (no separate sampling path). CDP only emits frames on visual change, so
  idle costs nothing. The full frame track is kept only for the **most recent 5 runs**; older
  runs degrade to the last-frame-per-step they already have. This bounds growth of
  `.reactlens/runs/`, which has no other auto-pruning today.

## Consequences

- **Capture pipeline change in a moat-adjacent area** (§10 "capture is sacred"): the persistor
  stops overwriting and writes a per-frame sequence; `run-paths` grows a per-frame path; a
  retention step prunes old frame tracks. Done carefully and behind `parseRunEvent`.
- **Disk**: a recorded run is meaningfully larger than today's per-step stills (bounded by the
  ~15fps rate, change-only emission, and the 5-run retention). The `.reactlens/.gitignore`
  already keeps it out of user repos.
- **Live UX**: live preview drops from ~30 to ~15fps — imperceptible for reviewing a test, and
  it buys a single, simple stream that is both shown and recorded.
- **Frontend (dashboard-ui)**: `BrowserPreview` gains a video transport; `replay-timeline.ts`
  builds a frame track; the App reducer ingests per-frame `frame` lines. Pure player work; no
  diagnosis-path impact.
- **Cross-repo**: the substantive part (protocol, capture, persistence, retention) lands in
  `reactlens`; the player lands in `@reynsu/reactlens-dashboard-ui`. They ship coordinated.
- **Not in scope**: an interactive embedded browser, and the Playwright trace viewer (a
  different, heavier artifact). Both were considered and rejected — see Context.
