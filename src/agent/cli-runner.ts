// Runs the local `claude` CLI binary in headless print-mode and parses its
// stream-json output. Because the CLI authenticates via OAuth against your
// Claude.ai account, calls billed go against your subscription rather than
// per-token API billing. Local development only — do NOT enable in published
// products (Anthropic's TOS prohibits third-party tools from leveraging
// Claude.ai login).
import { execa, type ResultPromise, type Subprocess } from 'execa';
import { resolve } from 'node:path';
import { ReactLensError } from '../utils/errors';
import { logger } from '../utils/logger';
import type { AgentMessage, AgentQueryOptions, AgentRunner } from './runner';

async function isClaudeCliAvailable(): Promise<boolean> {
  try {
    const { exitCode } = await execa('claude', ['--version'], { reject: false });
    return exitCode === 0;
  } catch {
    return false;
  }
}

function buildArgs(opts: AgentQueryOptions): string[] {
  const args: string[] = [
    '-p',
    '--output-format', 'stream-json',
    '--input-format', 'text',
    '--verbose',
    '--max-turns', String(opts.maxTurns),
    '--permission-mode', opts.permissionMode,
    '--append-system-prompt', opts.systemPromptAppend,
  ];
  if (opts.allowedTools.length > 0) {
    args.push('--allowed-tools', opts.allowedTools.join(','));
  }
  return args;
}

async function* readLines(stream: NodeJS.ReadableStream): AsyncIterable<string> {
  let buf = '';
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let start = 0;
    let nl = buf.indexOf('\n', start);
    while (nl >= 0) {
      yield buf.slice(start, nl);
      start = nl + 1;
      nl = buf.indexOf('\n', start);
    }
    buf = start === 0 ? buf : buf.slice(start);
  }
  if (buf.length > 0) yield buf;
}

export async function ensureClaudeCli(): Promise<void> {
  if (!(await isClaudeCliAvailable())) {
    throw new ReactLensError(
      'REACTLENS_USE_CLAUDE_CODE is set but `claude` CLI was not found in PATH. Install Claude Code and run `claude login` first, or unset the variable to use the SDK + ANTHROPIC_API_KEY.',
      { code: 'CLI_RUNNER_NOT_FOUND' },
    );
  }
}

export const cliRunner: AgentRunner = {
  async *query(opts: AgentQueryOptions): AsyncIterable<AgentMessage> {
    const args = buildArgs(opts);
    logger.debug({ args }, 'spawning claude CLI');
    const child = execa('claude', args, {
      cwd: resolve(opts.cwd),
      reject: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf8',
    }) as ResultPromise<{ reject: false; encoding: 'utf8' }> & Subprocess;

    // Pipe the prompt in via stdin to avoid argv-length limits on long prompts.
    child.stdin?.write(opts.prompt);
    child.stdin?.end();

    // Surface stderr through the logger so users can see auth/CLI errors.
    if (child.stderr !== null) {
      void (async () => {
        for await (const line of readLines(child.stderr!)) {
          if (line.trim().length > 0) logger.warn({ line }, 'claude CLI stderr');
        }
      })();
    }

    if (child.stdout === null) {
      throw new ReactLensError('claude CLI produced no stdout pipe', { code: 'CLI_RUNNER_NO_STDOUT' });
    }
    for await (const line of readLines(child.stdout)) {
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed[0] !== '{') continue;
      try {
        yield JSON.parse(trimmed) as AgentMessage;
      } catch (err) {
        logger.debug({ line: trimmed.slice(0, 200), err }, 'unparseable claude CLI line');
      }
    }

    const result = await child;
    if (result.exitCode !== 0 && !result.isCanceled) {
      throw new ReactLensError(
        `claude CLI exited with code ${result.exitCode}`,
        { code: 'CLI_RUNNER_NONZERO_EXIT' },
      );
    }
  },
};
