# Configuration

reactlens reads configuration from `reactlens.config.ts` (or `.js`/`.mjs`/`.cjs`) at the project root. A default config is created by `reactlens init`.

## Schema

```ts
import { defineConfig } from 'reactlens/config';

export default defineConfig({
  componentGlobs: string[];     // default: ['src/pages/**/*.tsx', 'src/components/**/*.tsx']
  output: {
    pages: string;              // default: 'e2e/pages'
    specs: string;              // default: 'e2e/specs'
  };
  msw: {
    handlers: string;           // default: 'src/mocks/handlers.ts'
  };
  dashboard: {
    port: number;               // default: 7777
    open: boolean;              // default: true
  };
});
```

If the config is absent, all defaults apply. If a single field is provided, the other fields fall back to defaults — there is no need to spell out the entire object.

## Environment variables

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Required for `generate`, `regen`, `analyze`, and on-failure diagnosis during `run`. |
| `REACTLENS_LOG_LEVEL` | `debug` / `info` / `warn` / `error`. Defaults to `info`. |
| `REACTLENS_WS_URL` | Set automatically by `reactlens run` when the dashboard is on. The probe and screencast fixtures read this. Don't set it manually unless you're driving the runner yourself. |
| `REACTLENS_NO_WEB_SERVER` | When `=1`, `playwright.config.ts` skips its `webServer` block. Useful when you're starting your own dev server or running tests against a static build. |
| `REACTLENS_PROBE_PATH` | Override path to the probe IIFE bundle. Used during reactlens development; published packages don't need this. |

## CLI flags vs config

CLI flags always take precedence:

```bash
reactlens run --no-open       # overrides dashboard.open: true
reactlens run --ci            # disables dashboard regardless of config
```
