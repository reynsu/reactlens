# Troubleshooting

## `Executable doesn't exist at .../chrome-headless-shell`

Run `npx playwright install chromium`. If reactlens's `init` was supposed to do this, re-run with `--force` or pass `--install-playwright`.

## The dashboard shows "reconnecting" forever

- Confirm `reactlens run` is still running — the dashboard server lives in that process.
- Check the configured port in `reactlens.config.ts`. If something else owns 7777, change `dashboard.port`.
- If you started Playwright directly (without `reactlens run`), the dashboard server isn't running. Either use `reactlens run` or start the server separately.

<a id="config"></a>
## `ConfigError: invalid reactlens config`

The error message includes the offending key path (e.g. `dashboard.port: Number must be greater than or equal to 1`). Edit `reactlens.config.ts` accordingly. If you used `defineConfig` from `reactlens/config`, your editor's TypeScript should catch most of these before you save.

## My MSW handlers aren't being used in tests

Two layers can intercept requests:

1. MSW's service worker, registered at app start.
2. Playwright's `page.route(...)`.

In our default fixtures, MSW wins because it intercepts at the browser layer before Playwright sees the request. To let `page.route` win, navigate with `?mocks=off` (the fixture's `main.tsx` skips MSW when this query param is set). The hand-written canonical specs use this pattern for tests that need request-by-request route control.

## `[reactlens] probe loaded but no WS url; idle`

The probe shipped with the page but no `__REACTLENS__.wsUrl` was set. This is correct when running `playwright test` directly (without `reactlens run`) — the probe goes silent rather than crashing. To enable component capture, run via `reactlens run` so the dashboard's WS URL is injected.

## Diagnosis says `env-issue` with `low` confidence

Two likely causes:

- The diagnosis agent's output didn't parse as JSON twice in a row. Re-run with `REACTLENS_LOG_LEVEL=debug` to see what the agent emitted.
- `ANTHROPIC_API_KEY` is unset or invalid. Diagnosis runs only when the key is present; the run otherwise completes without diagnoses.

## `pnpm: ignored build scripts: esbuild@x.y.z`

pnpm 11 requires explicit approval for postinstall scripts. Add to `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  esbuild: true
```
