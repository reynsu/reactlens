// Operator-gated integration test for the Component-Object generate → run
// round-trip (v0.3 slice 6 / issue #13, phase 3).
//
// =================================================================
// OPERATOR RUNBOOK
// =================================================================
// Skipped by default. Costs agent tokens — only run when you intend
// to validate that `reactlens generate --pattern=component-object`
// produces a spec that actually executes against the live fixture.
//
// To run locally with the Claude Code CLI (subscription billing,
// preferred — see CLAUDE.md §10 Principle 3 and `--use-claude-code`):
//
//   REACTLENS_RUN_GENERATE_INTEGRATION=1 \
//   REACTLENS_USE_CLAUDE_CODE=1 \
//     pnpm test:integration -t "co-generate-roundtrip"
//
// To run with the Anthropic API (per-token billing):
//
//   REACTLENS_RUN_GENERATE_INTEGRATION=1 \
//   ANTHROPIC_API_KEY=sk-... \
//     pnpm test:integration -t "co-generate-roundtrip"
//
// Expected wall-clock: ~3-6 min (generate phase typically dominates).
// Expected token cost: low — one small component, one spec, no eval
// loop. Budget under $0.50 even on the API path; effectively free on
// the CLI subscription path.
//
// What it verifies:
//   1. `reactlens generate --pattern=component-object` resolves an
//      agent, writes a `<Pagination>.spec.ts` plus the matching
//      `<Pagination>.contract.md`, and the spec uses the
//      `Component(name).props.<x>` surface.
//   2. `reactlens run` against the generated spec passes end-to-end
//      (probe → bridge → Component() helper → assertion green).
//
// What it does NOT verify (separate concerns, separate gates):
//   - Ablation accuracy regression — that is REACTLENS_ABLATION=1 +
//     REACTLENS_ABLATION_UPDATE_BASELINE=1 in `tests/diagnostic-eval/
//     eval-runner.test.ts`. The CO-shaped case lives at
//     `tests/diagnostic-eval/cases/case-018-co-real-bug-pagination/`
//     and gets picked up automatically by the harness; recompute the
//     baseline after merging this PR. See PR description.
// =================================================================
import { execa } from 'execa';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..');
const FIXTURE = join(REPO_ROOT, 'tests', 'fixtures', 'vite-react-router');
const CLI = join(REPO_ROOT, 'bin', 'reactlens.js');

// The component we target — small, prop-rich, already wired into the fixture
// at /eval/case-005. Matches the hand-written spec at
// tests/fixtures/vite-react-router/e2e/specs/component-object-pagination.spec.ts
// so we know the runtime path works end-to-end.
const COMPONENT_GLOB = 'src/components/eval/Pagination.tsx';
const EXPECTED_SPEC_BASENAME_PATTERN = /Pagination.*\.spec\.ts$/;
const EXPECTED_CONTRACT_PATTERN = /Pagination.*\.contract\.md$/;

// Single env knob — keeps the default `pnpm test:integration` run green
// without secrets or agent quota. Mirrors the `REACTLENS_ABLATION` pattern
// in `tests/diagnostic-eval/eval-runner.test.ts`.
const GATE = process.env.REACTLENS_RUN_GENERATE_INTEGRATION === '1';

// Scratch directory for the generator output. We write into a temp subdir of
// the fixture (so the analyzer's cwd-relative paths resolve) and clean up
// afterwards regardless of pass/fail. Putting this inside the fixture is
// intentional — the generator resolves componentGlobs relative to its cwd
// and the spec writer drops files under cwd/output.specs.
const SCRATCH_SUBDIR = 'e2e/specs-co-roundtrip';
const SCRATCH_ABS = join(FIXTURE, SCRATCH_SUBDIR);

describe.skipIf(!GATE)('reactlens generate --pattern=component-object round-trip', () => {
  it('generates a CO spec for <Pagination /> and runs it green', async () => {
    // Clean any prior scratch output so a partial previous run can't make
    // this iteration look like it succeeded by re-using stale files.
    if (existsSync(SCRATCH_ABS)) {
      rmSync(SCRATCH_ABS, { recursive: true, force: true });
    }
    mkdirSync(SCRATCH_ABS, { recursive: true });

    try {
      // ---- generate -----------------------------------------------------
      // We pass --pattern explicitly even though it's also the per-PR
      // config default the operator might toggle — the test should not
      // depend on fixture config drift to exercise the CO branch.
      //
      // --pages limits generation to the single component we care about,
      // keeping the agent budget bounded.
      //
      // We do NOT pass --skip-typecheck: a CO spec that doesn't typecheck
      // is a broken roundtrip, and we want this test to surface that.
      const generate = await execa(
        'node',
        [
          CLI,
          'generate',
          '--cwd',
          FIXTURE,
          '--pattern',
          'component-object',
          '--pages',
          COMPONENT_GLOB,
        ],
        {
          cwd: REPO_ROOT,
          reject: false,
          stdio: ['ignore', 'pipe', 'pipe'],
          // The generator typically returns inside a few minutes; leave headroom.
          timeout: 10 * 60 * 1000,
          env: {
            ...process.env,
            // Override config.output.specs for this run only — funnels the
            // generated artifact into our scratch dir so cleanup is trivial
            // and so we don't clobber the hand-written reference spec.
            REACTLENS_OUTPUT_SPECS: SCRATCH_SUBDIR,
          },
        },
      );
      expect(generate.exitCode, `generate stderr:\n${generate.stderr}`).toBe(0);

      // ---- assert the generated artifact looks right --------------------
      // We assert on filename pattern rather than exact name because the
      // generator may include the component path prefix; we just need to
      // find ONE spec matching Pagination.spec.ts in our scratch dir.
      const written = readdirSync(SCRATCH_ABS, { withFileTypes: true })
        .filter((d) => d.isFile())
        .map((d) => d.name);
      const specFile = written.find((name) => EXPECTED_SPEC_BASENAME_PATTERN.test(name));
      expect(specFile, `expected a Pagination spec in ${SCRATCH_ABS}, got: ${written.join(', ')}`).toBeDefined();
      const contractFile = written.find((name) => EXPECTED_CONTRACT_PATTERN.test(name));
      expect(
        contractFile,
        `expected a Pagination contract in ${SCRATCH_ABS}, got: ${written.join(', ')}`,
      ).toBeDefined();

      const specPath = join(SCRATCH_ABS, specFile!);
      const specBody = readFileSync(specPath, 'utf8');
      // The whole point of --pattern=component-object: the spec MUST use
      // the Component() helper. If the generator silently fell back to
      // POM, this assertion fires and the operator sees the regression.
      expect(specBody, 'generated spec does not call Component(...)').toMatch(/\bComponent\s*\(/);
      // Sanity: the spec must address our component by name.
      expect(specBody).toMatch(/Pagination/);

      // ---- run ----------------------------------------------------------
      // `reactlens run` boots Playwright + dashboard + probe. We pass
      // --no-open so no browser pops; --no-analyze so we don't spend
      // tokens on diagnosis (the assertion is that the spec PASSES, not
      // that diagnosis returns a useful classification when it fails).
      const run = await execa(
        'node',
        [
          CLI,
          'run',
          '--cwd',
          FIXTURE,
          '--no-open',
          '--no-analyze',
          // Limit to just our generated spec — keeps wall-clock down.
          '--',
          specPath,
        ],
        {
          cwd: REPO_ROOT,
          reject: false,
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 5 * 60 * 1000,
        },
      );
      expect(
        run.exitCode,
        `generated CO spec failed under reactlens run.\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
      ).toBe(0);
    } finally {
      // Best-effort cleanup. We don't fail the test on cleanup errors —
      // the operator may want to inspect the scratch dir if anything went
      // wrong above, and the next iteration's setup wipes it anyway.
      try {
        rmSync(SCRATCH_ABS, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  },
  // Total budget: generate (up to 10 min) + run (up to 5 min) + slack.
  20 * 60 * 1000);
});
