/**
 * Base class for all reactlens-thrown errors. Every typed error in the codebase
 * MUST extend this — never throw a plain Error. The CLI boundary catches
 * ReactLensError instances and pretty-prints them with the help URL.
 *
 * Help URLs default to a docs/troubleshooting.md anchor keyed off the error
 * code (see HELP_URLS below). A throw site can override by passing helpUrl
 * explicitly, but the default keeps the throw site terse and ensures every
 * user-facing error has a remediation page.
 */

const DOCS_BASE = 'docs/troubleshooting.md';

// Single source of truth for error-code → docs anchor. When you add a new
// ReactLensError throw site, also add a section to docs/troubleshooting.md
// with the matching anchor and register it here. Codes that share a remediation
// path (e.g. all four NO_AGENT variants) point at the same anchor.
const HELP_URLS: Record<string, string> = {
  REACTLENS_CONFIG_ERROR: `${DOCS_BASE}#reactlens-config-error`,
  INIT_NO_PACKAGE_JSON: `${DOCS_BASE}#init-no-package-json`,
  ANALYZE_NO_REPORT: `${DOCS_BASE}#analyze-no-report`,
  GENERATE_NO_AGENT: `${DOCS_BASE}#agent-credentials`,
  RUN_NO_AGENT: `${DOCS_BASE}#agent-credentials`,
  ANALYZE_NO_AGENT: `${DOCS_BASE}#agent-credentials`,
  REGEN_NO_AGENT: `${DOCS_BASE}#agent-credentials`,
  CLI_RUNNER_NOT_FOUND: `${DOCS_BASE}#cli-runner-not-found`,
  CLI_RUNNER_NO_STDOUT: `${DOCS_BASE}#cli-runner-failures`,
  CLI_RUNNER_NONZERO_EXIT: `${DOCS_BASE}#cli-runner-failures`,
  RUNNER_INFRA_ERROR: `${DOCS_BASE}#runner-infra-error`,
  GENERATOR_PROMPT_MISSING: `${DOCS_BASE}#prompt-missing`,
  DIAGNOSIS_PROMPT_MISSING: `${DOCS_BASE}#prompt-missing`,
  AGENT_COST_EXCEEDED: `${DOCS_BASE}#agent-cost-exceeded`,
};

export class ReactLensError extends Error {
  readonly code: string;
  readonly helpUrl?: string;

  constructor(message: string, opts: { code: string; helpUrl?: string; cause?: unknown } = { code: 'REACTLENS_ERROR' }) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = new.target.name;
    this.code = opts.code;
    const url = opts.helpUrl ?? HELP_URLS[opts.code];
    if (url !== undefined) this.helpUrl = url;
  }
}
