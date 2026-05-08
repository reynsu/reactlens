// Single source of truth lives in templates/streaming-reporter.ts so users who
// copy the template into their project get a self-contained file. tsup bundles
// this re-export entry into dist/runner/reporter.js for projects that prefer
// to reference the installed package directly.
export { default } from '../../templates/streaming-reporter';
