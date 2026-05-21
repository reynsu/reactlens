// Drift check between src/component-object/snapshot-accessor.ts (source-of-truth,
// covered by unit tests) and templates/component-object.ts (sync'd copy that
// init places in user projects). The two files MUST have identical bodies
// from `import WebSocket from 'ws';` onwards. Header comments differ by
// design — one explains the production location, the other explains the
// template-copy contract.
//
// Exit codes:
//   0 = bodies match (sync'd)
//   1 = bodies drift (printed diff stub)
//   2 = could not locate the anchor in one or both files (refactor caused
//       the import line to move — fix the script or the files)
//
// Run locally:  pnpm tsx scripts/check-component-object-drift.ts
// Run in CI:    same — wired by .github/workflows/component-object-drift.yml

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..');
const SOURCE_PATH = join(REPO_ROOT, 'src', 'component-object', 'snapshot-accessor.ts');
const TEMPLATE_PATH = join(REPO_ROOT, 'templates', 'component-object.ts');

// The first line both files share verbatim — everything below this line
// must be byte-identical. If a refactor changes the import line, update
// both files AND this anchor in lockstep.
const ANCHOR = `import WebSocket from 'ws';`;

function extractBody(label: string, path: string): string {
  const content = readFileSync(path, 'utf8');
  const idx = content.indexOf(ANCHOR);
  if (idx === -1) {
    console.error(`drift-check: anchor not found in ${label} (${path})`);
    console.error(`  expected to find the line: ${ANCHOR}`);
    console.error(`  refactor moved the import? update both files + ANCHOR in this script.`);
    process.exit(2);
  }
  return content.slice(idx);
}

function firstDifferingLine(a: string, b: string): { line: number; aLine: string; bLine: string } | null {
  const al = a.split('\n');
  const bl = b.split('\n');
  const max = Math.max(al.length, bl.length);
  for (let i = 0; i < max; i++) {
    const av = al[i] ?? '<EOF>';
    const bv = bl[i] ?? '<EOF>';
    if (av !== bv) return { line: i + 1, aLine: av, bLine: bv };
  }
  return null;
}

function main(): void {
  const sourceBody = extractBody('source', SOURCE_PATH);
  const templateBody = extractBody('template', TEMPLATE_PATH);
  if (sourceBody === templateBody) {
    console.log(
      `drift-check OK: ${SOURCE_PATH} and ${TEMPLATE_PATH} bodies match (from anchor onwards)`,
    );
    process.exit(0);
  }
  const diff = firstDifferingLine(sourceBody, templateBody);
  console.error(`drift-check FAIL: src and templates copies of component-object have drifted.`);
  console.error(`  source:   ${SOURCE_PATH}`);
  console.error(`  template: ${TEMPLATE_PATH}`);
  if (diff !== null) {
    console.error(`  first difference at body line ${diff.line}:`);
    console.error(`    source:   ${JSON.stringify(diff.aLine)}`);
    console.error(`    template: ${JSON.stringify(diff.bLine)}`);
  }
  console.error('');
  console.error(
    `  Fix: copy the source body into the template (or vice versa). The unit tests live`,
  );
  console.error(`  at tests/unit/snapshot-accessor.test.ts and exercise the SOURCE file.`);
  console.error(
    `  If you changed semantics, update both files AND verify the unit tests still pass.`,
  );
  process.exit(1);
}

main();
