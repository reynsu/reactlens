/**
 * Base class for all reactlens-thrown errors. Every typed error in the codebase
 * MUST extend this — never throw a plain Error. The CLI boundary catches
 * ReactLensError instances and pretty-prints them with the help URL.
 */
export class ReactLensError extends Error {
  readonly code: string;
  readonly helpUrl?: string;

  constructor(message: string, opts: { code: string; helpUrl?: string; cause?: unknown } = { code: 'REACTLENS_ERROR' }) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = new.target.name;
    this.code = opts.code;
    if (opts.helpUrl !== undefined) this.helpUrl = opts.helpUrl;
  }
}
