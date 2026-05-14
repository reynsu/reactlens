// Picks an AgentRunner with a precedence designed to avoid silently billing
// the API when a Claude Code subscription is available.
//
// Default policy (post change-of-default 2026-05-14):
//   1. Force-API path explicit         → SDK (or fail if no key)
//   2. Force-CLI path explicit         → CLI (or fail if not installed)
//   3. Claude Code CLI present         → CLI [DEFAULT]
//   4. ANTHROPIC_API_KEY present       → SDK (with a "no CLI found" log)
//   5. Otherwise                       → throw NO_AGENT
//
// Why this order: Anthropic explicitly warns that the presence of
// ANTHROPIC_API_KEY in the environment can make Claude Code bill against the
// API instead of the subscription. We mirror their guidance — the local
// subscription wins by default, and the API path requires an explicit
// opt-in (--force-api or REACTLENS_FORCE_API=1) so the developer never gets
// surprised by a per-token bill from a forgotten env var.
import { logger } from '../utils/logger';
import { ReactLensError } from '../utils/errors';
import { cliRunner, isClaudeCliAvailable } from './cli-runner';
import type { AgentRunner } from './runner';
import { sdkRunner } from './sdk-runner';

export type AgentSelection = {
  // Hard request for the CLI path. Fails if the `claude` binary is not
  // installed. Useful when the caller wants to be sure they're billing the
  // subscription and refuses to silently fall back to the API.
  useClaudeCode?: boolean;
  // Hard request for the API path, ignoring any local Claude Code
  // installation. Required for CI scenarios where there is no local
  // subscription, or to opt out of the new subscription-first default.
  forceApi?: boolean;
  // Command name (eg 'generate', 'analyze') for error/log context.
  commandName: string;
};

// Hook seam for tests. Production calls go through the real CLI detector.
export type AgentDetectors = {
  hasClaudeCli: () => Promise<boolean>;
  hasApiKey: () => boolean;
};

const defaultDetectors: AgentDetectors = {
  hasClaudeCli: isClaudeCliAvailable,
  hasApiKey: () => process.env.ANTHROPIC_API_KEY !== undefined,
};

export async function pickAgentRunner(
  opts: AgentSelection,
  detectors: AgentDetectors = defaultDetectors,
): Promise<AgentRunner> {
  const envForceApi = process.env.REACTLENS_FORCE_API === '1';
  const envForceCli = process.env.REACTLENS_USE_CLAUDE_CODE === '1';
  const wantApi = opts.forceApi === true || envForceApi;
  const wantCli = opts.useClaudeCode === true || envForceCli;
  const hasApiKey = detectors.hasApiKey();

  // Reject contradiction up front rather than silently picking one.
  if (wantApi && wantCli) {
    throw new ReactLensError(
      'Conflicting agent selection: both --force-api and --use-claude-code are set. Pick one.',
      { code: `${opts.commandName.toUpperCase()}_NO_AGENT` },
    );
  }

  // 1. Explicit API. Required when CI has no local subscription, or when
  //    the developer deliberately wants per-token billing for this run.
  if (wantApi) {
    if (!hasApiKey) {
      throw new ReactLensError(
        `--force-api / REACTLENS_FORCE_API=1 set but ANTHROPIC_API_KEY is missing.`,
        { code: `${opts.commandName.toUpperCase()}_NO_AGENT` },
      );
    }
    logger.info(
      { command: opts.commandName },
      'forced API path: per-token billing via ANTHROPIC_API_KEY',
    );
    return sdkRunner;
  }

  // 2. Explicit CLI. Strict — fails rather than falling back to the API
  //    so the caller can be confident about subscription billing. Uses the
  //    injected detector so tests can mock the CLI presence without
  //    spawning the real binary.
  if (wantCli) {
    if (!(await detectors.hasClaudeCli())) {
      throw new ReactLensError(
        'Claude Code CLI requested (--use-claude-code or REACTLENS_USE_CLAUDE_CODE=1) but the `claude` binary was not found in PATH. Install Claude Code and run `claude login` first, or pass --force-api to use the SDK + ANTHROPIC_API_KEY instead.',
        { code: 'CLI_RUNNER_NOT_FOUND' },
      );
    }
    logger.info(
      { command: opts.commandName },
      'using Claude Code subscription (explicit --use-claude-code)',
    );
    return cliRunner;
  }

  // 3. Default: prefer the local Claude Code subscription when available.
  const cliAvailable = await detectors.hasClaudeCli();
  if (cliAvailable) {
    if (hasApiKey) {
      // Both present: subscription wins by policy, but tell the user so
      // they aren't surprised that ANTHROPIC_API_KEY isn't being used.
      logger.warn(
        { command: opts.commandName },
        'ANTHROPIC_API_KEY detected but using Claude Code subscription. Pass --force-api (or set REACTLENS_FORCE_API=1) to bill against the API instead.',
      );
    } else {
      logger.info({ command: opts.commandName }, 'using Claude Code subscription');
    }
    return cliRunner;
  }

  // 4. Fall back to the SDK if an API key is available, with a hint about
  //    the subscription path.
  if (hasApiKey) {
    logger.info(
      { command: opts.commandName },
      'Claude Code CLI not found in PATH; falling back to SDK + ANTHROPIC_API_KEY (per-token). Install Claude Code (`claude login`) to bill against the subscription instead.',
    );
    return sdkRunner;
  }

  // 5. No path resolved.
  throw new ReactLensError(
    `\`reactlens ${opts.commandName}\` needs an agent. Install Claude Code (\`claude login\`) for subscription billing, OR set ANTHROPIC_API_KEY for per-token API billing.`,
    { code: `${opts.commandName.toUpperCase()}_NO_AGENT` },
  );
}

// Non-throwing variant used by `reactlens run` to decide whether to wire up
// the diagnosis pipeline at all. Mirrors the success conditions of
// pickAgentRunner without actually constructing a runner. Accepts the same
// per-call opts so a `--use-claude-code` or `--force-api` flag is honored
// when deciding whether diagnosis is reachable.
export async function canResolveAgent(
  opts: Pick<AgentSelection, 'useClaudeCode' | 'forceApi'> = {},
  detectors: AgentDetectors = defaultDetectors,
): Promise<boolean> {
  const envForceApi = process.env.REACTLENS_FORCE_API === '1';
  const envForceCli = process.env.REACTLENS_USE_CLAUDE_CODE === '1';
  const wantApi = opts.forceApi === true || envForceApi;
  const wantCli = opts.useClaudeCode === true || envForceCli;
  const hasApiKey = detectors.hasApiKey();
  if (wantApi && wantCli) return false;
  if (wantApi) return hasApiKey;
  if (wantCli) return await detectors.hasClaudeCli();
  if (await detectors.hasClaudeCli()) return true;
  return hasApiKey;
}
