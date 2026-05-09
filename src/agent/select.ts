import { logger } from '../utils/logger';
import { ReactLensError } from '../utils/errors';
import { cliRunner, ensureClaudeCli } from './cli-runner';
import type { AgentRunner } from './runner';
import { sdkRunner } from './sdk-runner';

export type AgentSelection = {
  // Explicit user choice via `--use-claude-code` flag.
  useClaudeCode?: boolean;
  // The command name (eg 'generate', 'analyze') used in error messages.
  commandName: string;
};

export async function pickAgentRunner(opts: AgentSelection): Promise<AgentRunner> {
  const envOptIn = process.env.REACTLENS_USE_CLAUDE_CODE === '1';
  const useCli = opts.useClaudeCode === true || envOptIn;

  if (useCli) {
    await ensureClaudeCli();
    logger.info({ command: opts.commandName }, 'routing through local claude CLI (Max-billed)');
    return cliRunner;
  }

  if (process.env.ANTHROPIC_API_KEY === undefined) {
    throw new ReactLensError(
      `\`reactlens ${opts.commandName}\` needs an agent. Either set ANTHROPIC_API_KEY (token-billed) or pass --use-claude-code (Max-billed via local claude CLI; local-dev only).`,
      { code: `${opts.commandName.toUpperCase()}_NO_AGENT` },
    );
  }
  return sdkRunner;
}
