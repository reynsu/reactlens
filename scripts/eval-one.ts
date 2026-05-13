// Operator helper: run the diagnosis agent against a single eval case and
// print the CaseResult as JSON. Useful for dry-running before committing to
// the full eval set sweep.
//
// Usage:
//   REACTLENS_USE_CLAUDE_CODE=1 pnpm tsx scripts/eval-one.ts <case-dir-name>
//   ANTHROPIC_API_KEY=...      pnpm tsx scripts/eval-one.ts <case-dir-name>
//
// The case dir name is relative to tests/diagnostic-eval/cases/.
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { pickAgentRunner } from '../src/agent/select';
import { runEvalCase } from '../src/analyzer/eval-pipeline';

async function main(): Promise<void> {
  const caseName = process.argv[2];
  if (caseName === undefined || caseName.length === 0) {
    console.error('usage: tsx scripts/eval-one.ts <case-dir-name>');
    process.exit(2);
  }

  const caseDir = resolve(join('tests', 'diagnostic-eval', 'cases', caseName));
  if (!existsSync(caseDir)) {
    console.error(`case dir not found: ${caseDir}`);
    process.exit(2);
  }

  const startedAt = Date.now();
  const agent = await pickAgentRunner({ commandName: 'eval' });

  const result = await runEvalCase({
    caseDir,
    agent,
    onChunk: (text) => process.stderr.write(text),
  });

  const elapsedMs = Date.now() - startedAt;
  console.log(
    JSON.stringify(
      {
        ...result,
        elapsedMs,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error('eval-one failed:', err);
  process.exit(1);
});
