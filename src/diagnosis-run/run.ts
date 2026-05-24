// DiagnosisRun — the diagnosis pipeline as a single deep Module behind a
// small factory Interface.
//
// External Interface:
//
//   const runner = createDiagnosisRun({ agent });
//   const diagnosis = await runner.run(intent, { onChunk? });
//
// `intent` is a discriminated union over the four caller shapes that need a
// Diagnosis. The kind determines preparation (sandbox? variant transform?
// inline FailedTest?); the execute core is shared across all kinds.
//
// CONTEXT.md owns the vocabulary (DiagnosisRun, DiagnosisIntent, Variant,
// FailedTest-internal, Calibration fence). CLAUDE.md §8 forbids barrel
// `index.ts` files — hence `run.ts` as the entry filename.
//
// Slice status:
//   - #43 (this slice): post-mortem intent (commands/analyze.ts) — wired.
//   - #44: live intent (commands/run.ts).
//   - #45: eval-case intent (runEvalCase) — first owner of the Calibration fence inside the Module.
//   - #46: ablation intent (AblationHarness) — adds the Variant transform.
//   - #47: deletes the legacy `failure-agent.ts` / `agent/run-json.ts` /
//          `production-diagnose-fn.ts` modules that this Module supersedes.
import type { Diagnosis } from '@reynsu/reactlens-diagnosis-prompts';
import type { AgentRunner } from '../agent/runner';
import { executeDiagnosis, type PrepareResult } from './execute';
import { prepareAblation, type AblationIntent } from './prepare-ablation';
import { prepareEvalCase, type EvalCaseIntent } from './prepare-eval-case';
import { prepareLive, type LiveIntent } from './prepare-live';
import { preparePostMortem, type PostMortemIntent } from './prepare-post-mortem';

export type DiagnosisIntent =
  | PostMortemIntent
  | LiveIntent
  | EvalCaseIntent
  | AblationIntent;

export type DiagnosisRunOptions = {
  onChunk?: (text: string) => void;
};

export type DiagnosisRun = {
  run(intent: DiagnosisIntent, opts?: DiagnosisRunOptions): Promise<Diagnosis>;
};

export type CreateDiagnosisRunOptions = {
  agent: AgentRunner;
};

export function createDiagnosisRun(factoryOpts: CreateDiagnosisRunOptions): DiagnosisRun {
  return {
    async run(intent, runOpts) {
      const { prepared, cleanup } = await prepare(intent);
      try {
        return await executeDiagnosis({
          agent: factoryOpts.agent,
          prepared,
          ...(runOpts?.onChunk !== undefined ? { onChunk: runOpts.onChunk } : {}),
        });
      } finally {
        cleanup?.();
      }
    },
  };
}

async function prepare(intent: DiagnosisIntent): Promise<PrepareResult> {
  switch (intent.kind) {
    case 'post-mortem':
      return { prepared: preparePostMortem(intent) };
    case 'live':
      return { prepared: prepareLive(intent) };
    case 'eval-case':
      return prepareEvalCase(intent);
    case 'ablation':
      return prepareAblation(intent);
    default: {
      // Exhaustiveness check — any future intent variant without a
      // matching case becomes a TypeScript error here.
      const _exhaustive: never = intent;
      throw new Error(`unknown DiagnosisIntent kind: ${String((_exhaustive as { kind: string }).kind)}`);
    }
  }
}
