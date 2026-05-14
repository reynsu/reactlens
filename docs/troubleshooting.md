# Troubleshooting

## `Executable doesn't exist at .../chrome-headless-shell`

Run `npx playwright install chromium`. If reactlens's `init` was supposed to do this, re-run with `--force` or pass `--install-playwright`.

## The dashboard shows "reconnecting" forever

- Confirm `reactlens run` is still running — the dashboard server lives in that process.
- Check the configured port in `reactlens.config.ts`. If something else owns 7777, change `dashboard.port`.
- If you started Playwright directly (without `reactlens run`), the dashboard server isn't running. Either use `reactlens run` or start the server separately.

<a id="reactlens-config-error"></a>
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

<a id="cli-runner-not-found"></a>
## `--use-claude-code` and `REACTLENS_USE_CLAUDE_CODE=1`

Routes generation/diagnosis calls through your local `claude` CLI binary instead of through the Anthropic API. The CLI authenticates against your Claude.ai account, so calls are billed against your Max/Pro subscription rather than per-token.

**This flag is for LOCAL DEVELOPMENT only.** Anthropic's terms of service explicitly prohibit third-party tools from leveraging Claude.ai login for distribution: `https://code.claude.com/docs/en/agent-sdk/quickstart` ("Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products"). If you publish a tool that uses this flag, expect to be told to remove it.

Prerequisites:

- `claude` CLI installed and on your `PATH` (test with `claude --version`).
- Logged in via `claude login` or the Claude desktop app.

Usage:

```bash
# Per-command
reactlens generate --use-claude-code --pages 'src/pages/Login.tsx'
reactlens run --use-claude-code

# Or globally
export REACTLENS_USE_CLAUDE_CODE=1
reactlens run
```

If the binary is missing reactlens errors with `CLI_RUNNER_NOT_FOUND`. Unset the variable or drop the flag to fall back to the SDK + `ANTHROPIC_API_KEY`.

## `pnpm: ignored build scripts: esbuild@x.y.z`

pnpm 11 requires explicit approval for postinstall scripts. Add to `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  esbuild: true
```

---

# Per-error references

These short sections are linked from `ReactLensError.helpUrl` so the CLI can point users straight at the fix.

<a id="init-no-package-json"></a>
## `INIT_NO_PACKAGE_JSON`

`reactlens init` needs a `package.json` in the target directory to know where to write `reactlens.config.ts` and how to install dependencies. Run `npm init -y` (or your package manager's equivalent) first, then re-run init. If you're calling init from a subfolder of a monorepo, pass `--cwd <path-to-app-package>`.

<a id="analyze-no-report"></a>
## `ANALYZE_NO_REPORT`

`reactlens analyze` needs a Playwright report from a prior `reactlens run`. Run `reactlens run` first (or pass `--report <path>` if the JSON report lives somewhere other than the default `playwright-report/results.json`).

<a id="agent-credentials"></a>
## `*_NO_AGENT` — generate / run / analyze / regen need an agent

These commands call Claude to write specs or diagnose failures. Provide one of:

- `ANTHROPIC_API_KEY` in the environment (preferred for CI). Pay-per-token, no flag needed.
- `--use-claude-code` (or `REACTLENS_USE_CLAUDE_CODE=1`) to route through your local `claude` CLI. Local development only — see [`cli-runner-not-found`](#cli-runner-not-found) for prerequisites and the ToS caveat.

`run` and `analyze` can also be invoked with `--no-analyze` to skip the diagnosis step entirely, which removes the need for any credential.

<a id="cli-runner-failures"></a>
## `CLI_RUNNER_NO_STDOUT` / `CLI_RUNNER_NONZERO_EXIT`

The local `claude` CLI launched but produced no stdout pipe (`NO_STDOUT`) or exited non-zero (`NONZERO_EXIT`). Most common causes:

- You're not logged in. Run `claude login`.
- Your Max/Pro session expired. Re-authenticate.
- The CLI's allowed-tool/permission gate blocked the call. Either rerun in an interactive shell and approve, or pre-allow the tool patterns in `~/.claude/settings.json`.
- The CLI is out of date. Update Claude Code and retry.

If the failure persists, rerun with `REACTLENS_LOG_LEVEL=debug` to see the underlying error from execa.

<a id="runner-infra-error"></a>
## `RUNNER_INFRA_ERROR`

Playwright exited with a code outside the expected `{0, 1}` range — meaning the test runner itself crashed (not a test failing). Typically:

- Out of memory in CI. Bump the runner's memory or split the suite via `--shard`.
- A native dependency broke after a Node upgrade. Reinstall (`pnpm rebuild`).
- A custom Playwright config has a syntax error. Run `npx playwright test --reporter=list` directly to see the raw output.

<a id="prompt-missing"></a>
## `GENERATOR_PROMPT_MISSING` / `DIAGNOSIS_PROMPT_MISSING`

A bundled prompt file (`src/generator/prompts/*.md` or `src/analyzer/prompts/*.md`) couldn't be found at runtime. This is almost always a packaging bug — the published tarball is missing the prompts directory. Reinstall the package from npm to recover, and file an issue if it persists.

If you're developing reactlens itself, run `pnpm build` to regenerate `dist/`.
