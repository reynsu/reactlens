# fixture: vite-react-router

A non-trivial Vite + React Router + React Query + MSW app used as the canonical test subject for `reactlens`. Every visual state below MUST be reachable so that:

- Phase 1 stack detection has a real target
- Phase 2.5 hand-written canonical specs cover all branches
- Phase 5 AST analysis can enumerate the same states
- Phase 6 diagnosis has a believable subject

## Pages and visual states

| Page | States the component can be in |
|---|---|
| `/login` | idle · field validation error · submitting · server error (banner) |
| `/dashboard` | loading · error (with retry) · empty · success (one or more orders) |
| `/checkout` | idle · field validation errors (per field) · submitting · success · declined · network error |

## Run it

```bash
pnpm install
pnpm dev          # http://localhost:5173
pnpm build        # vite build + tsc --noEmit
```

## Forcing states

APIs are mocked by MSW. Defaults live in `src/mocks/handlers.ts` and can be overridden per test:

- Login success: `user@example.com` / `password123`
- Login failure: any other credentials
- Checkout decline: card number starting with `4000`
- Checkout success: any other 16-digit card

Dashboard `loading`/`error`/`empty` are reached by overriding `/api/orders` from a Playwright spec.
