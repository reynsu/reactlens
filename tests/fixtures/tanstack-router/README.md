# fixture: tanstack-router

Real TanStack Router (over Vite) fixture for reactlens e2e tests. Mirrors
the complexity of `vite-react-router/`: same three pages (login,
dashboard, checkout), same testids, same MSW handlers, so specs can be
ported structurally between the two fixtures.

Differences vs. the react-router fixture:

- Router setup uses `createRouter` / `createRoute` / `createRootRoute`
  from `@tanstack/react-router` (code-based routes; no file-based
  codegen, to keep the fixture self-contained).
- Navigation API is `useNavigate()` then `navigate({ to: '/path' })`
  instead of react-router's `navigate('/path')`.
- The root layout uses `<Link to="..." activeProps={...}>` from
  `@tanstack/react-router` and `<Outlet />` from the same package.

To run:

```bash
pnpm install --ignore-workspace
node node_modules/msw/cli/index.js init public/ --save
pnpm dev                                          # localhost:5173
# or via reactlens:
node ../../../bin/reactlens.js run --cwd .
```

Used by the integration test suite to verify the component bridge works
against a third routing convention (Principle 4: "one framework, deeply"
— the moat must hold across all React routing libraries we support).
