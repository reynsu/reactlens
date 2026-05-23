// `scripts/capture-snapshot.ts` — CLI for capturing a snapshot.json for
// a single corpus-harvested case (issue #41).
//
// Operator workflow:
//   1. Run `pnpm tsx scripts/harvest-eval.ts --entry <name>` (lands a
//      case dir with component.tsx + spec.ts + manifest.json + truth.json
//      under tests/diagnostic-eval/cases/synthetic-from-corpus/<entry>/case-N-<slug>/).
//   2. Start the fork's dev server manually (`pnpm dev` in the cloned
//      upstream repo). Note its base URL (e.g. http://localhost:5173).
//   3. Run this script with --case-dir + --base-url + --path. The
//      script drives chromium against the dev server, injects the
//      reactlens probe, and writes snapshot.json next to the existing
//      case files.
//   4. Re-run `pnpm test:eval REACTLENS_ABLATION=1`. The case now
//      participates in the ablation harness (no longer filtered out
//      by the `existsSync(snapshot.json)` gate in eval-runner.test.ts).
//
// Per AC #3 of issue #41: no commit to reactlens mutates user fork
// repos. The script only writes inside <case-dir> (always under
// reactlens's own tests/diagnostic-eval/ tree).
import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { captureSnapshot, type CaptureSnapshotOpts } from '../src/eval/snapshot-capture';

type CliOpts = {
  caseDir: string;
  baseUrl: string;
  path: string;
  waitMs?: number;
  testId?: string;
};

function parseArgs(argv: string[]): CliOpts {
  const out: Partial<CliOpts> = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--case-dir' && v !== undefined) { out.caseDir = resolve(v); i++; }
    else if (k === '--base-url' && v !== undefined) { out.baseUrl = v; i++; }
    else if (k === '--path' && v !== undefined) { out.path = v; i++; }
    else if (k === '--wait-ms' && v !== undefined) { out.waitMs = Number(v); i++; }
    else if (k === '--test-id' && v !== undefined) { out.testId = v; i++; }
    else if (k === '--help' || k === '-h') {
      printUsage();
      process.exit(0);
    } else {
      console.error(`unknown arg: ${k}`);
      printUsage();
      process.exit(2);
    }
  }
  if (out.caseDir === undefined || out.baseUrl === undefined || out.path === undefined) {
    console.error('error: --case-dir, --base-url, and --path are required');
    printUsage();
    process.exit(2);
  }
  return out as CliOpts;
}

function printUsage(): void {
  console.log(`usage: pnpm tsx scripts/capture-snapshot.ts \\
  --case-dir <dir>   case directory to write snapshot.json into
  --base-url <url>   dev server base URL (e.g. http://localhost:5173)
  --path <p>         path to navigate to (e.g. /dashboard/invoices-compare/1/2)
  [--wait-ms <n>]    settle delay after navigation (default 2000)
  [--test-id <s>]    probe testId tag (default "capture")

example (case-021 sibling-cache-leak):
  pnpm tsx scripts/capture-snapshot.ts \\
    --case-dir tests/diagnostic-eval/cases/case-021-real-bug-sibling-cache-leak \\
    --base-url http://localhost:5173 \\
    --path /dashboard/invoices-compare/1/2 \\
    --wait-ms 3000
`);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  if (!existsSync(opts.caseDir)) {
    console.error(`✗ case dir does not exist: ${opts.caseDir}`);
    process.exit(2);
  }

  const captureOpts: CaptureSnapshotOpts = {
    baseUrl: opts.baseUrl,
    path: opts.path,
    ...(opts.waitMs !== undefined ? { waitMs: opts.waitMs } : {}),
    ...(opts.testId !== undefined ? { testId: opts.testId } : {}),
  };

  console.log(`capturing snapshot from ${opts.baseUrl}${opts.path} (waitMs=${opts.waitMs ?? 2000}) …`);
  const snapshot = await captureSnapshot(captureOpts);

  if (snapshot === null) {
    console.error(
      `✗ no component:snapshot received from the probe.\n` +
      `  Possible causes:\n` +
      `   - dev server at ${opts.baseUrl} not reachable\n` +
      `   - target app is not a React app (probe only attaches to React fiber roots)\n` +
      `   - waitMs too short — try --wait-ms 5000\n` +
      `   - probe bundle missing — run \`pnpm build\` first`,
    );
    process.exit(1);
  }

  const outPath = join(opts.caseDir, 'snapshot.json');
  // 2-space indent + trailing newline matches the convention in
  // tests/diagnostic-eval/cases/*/snapshot.json — keeps PR diffs
  // consistent across hand-curated and captured cases.
  writeFileSync(outPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`✓ wrote ${outPath}`);
  console.log(`  tree root: <${snapshot.name}>, ${countNodes(snapshot)} nodes`);
}

function countNodes(node: { children?: { children?: unknown[] }[] }): number {
  const stack: Array<{ children?: { children?: unknown[] }[] }> = [node];
  let count = 0;
  while (stack.length > 0) {
    const n = stack.pop();
    if (n === undefined) continue;
    count += 1;
    for (const child of n.children ?? []) {
      stack.push(child as { children?: { children?: unknown[] }[] });
    }
  }
  return count;
}

// Run only when invoked directly (not when imported by a test).
const invokedAsScript = (() => {
  try {
    return process.argv[1] !== undefined && process.argv[1].endsWith('capture-snapshot.ts');
  } catch {
    return false;
  }
})();

if (invokedAsScript) {
  main().catch((err: unknown) => {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  });
}
