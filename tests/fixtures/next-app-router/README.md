# fixture: next-app-router

Minimal placeholder fixture for testing reactlens stack detection against Next.js App Router.

This is intentionally NOT a runnable Next.js app — it exists so:

- `detectStack()` correctly identifies `router: 'next-app'`, `buildTool: 'next'`, `devServerPort: 3000`
- The detector unit tests have a target

A full Next.js fixture mirroring the complexity of `vite-react-router/` is on the v0.1.0 roadmap (Phase 7.5) but deferred to a follow-up to keep the moat work focused.
