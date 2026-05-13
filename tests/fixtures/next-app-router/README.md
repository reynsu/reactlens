# fixture: next-app-router

Real Next.js 14 App Router fixture for reactlens e2e tests. Mirrors the
complexity of `vite-react-router/`: same three pages (login, dashboard,
checkout), same testids, same MSW handlers, so specs can be ported
structurally between the two fixtures.

Differences vs. the Vite fixture:

- Routing via Next App Router (`app/login/page.tsx`, etc.) instead of
  react-router. Navigation uses `next/navigation`'s `useRouter`.
- MSW is started inside a client-only `Providers` component that gates
  child rendering on the worker being ready. This avoids the SSR/CSR race
  where a server-rendered fetch hits real network before the worker
  intercepts.
- `app/page.tsx` renders `<LoginPage />` directly so `/` and `/login` are
  equivalent (mirroring the Vite fixture's index route).

To run:

```bash
pnpm install
pnpm dev                 # localhost:3000
# or via reactlens:
node ../../../bin/reactlens.js run --cwd .
```

Used by the integration test suite to verify the component bridge works
through Next's hydration boundary (Principle 4: "one framework, deeply" —
the moat must hold even when the initial render comes from the server).
