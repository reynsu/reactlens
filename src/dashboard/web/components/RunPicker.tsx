import { useEffect, useState } from 'react';
import type { PastRun } from '../types';

type Props = {
  // Currently-viewed run. When undefined, the picker shows "Live" as selected.
  currentRunId: string | null;
  // Switches the dashboard to live mode (incoming WS events are processed
  // again and the state resets to initial — see App.tsx live:resume).
  onSelectLive: () => void;
  // Loads a past run by id. The App.tsx loader fetches the JSONL and
  // replaces the reducer state in a single dispatch.
  onSelectRun: (runId: string) => void;
  // True while the picker is loading a run; disables interaction.
  busy: boolean;
};

function formatStartedAt(ts: number | undefined): string {
  if (ts === undefined) return '—';
  const d = new Date(ts);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z').replace('T', ' ');
}

function summarize(run: PastRun): string {
  const parts: string[] = [];
  if (run.passed !== undefined) parts.push(`${run.passed}✓`);
  if (run.failed !== undefined && run.failed > 0) parts.push(`${run.failed}✗`);
  if (run.skipped !== undefined && run.skipped > 0) parts.push(`${run.skipped}−`);
  if (run.totalTests !== undefined) parts.push(`/${run.totalTests}`);
  if (run.duration !== undefined) parts.push(`${(run.duration / 1000).toFixed(1)}s`);
  return parts.join(' ');
}

export function RunPicker({ currentRunId, onSelectLive, onSelectRun, busy }: Props): JSX.Element {
  const [runs, setRuns] = useState<PastRun[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const res = await fetch('/api/runs');
        if (!res.ok) throw new Error(`status ${res.status}`);
        const list = (await res.json()) as PastRun[];
        if (!cancelled) {
          setRuns(list);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [currentRunId]);

  function onChange(e: React.ChangeEvent<HTMLSelectElement>): void {
    const value = e.target.value;
    if (value === '__live__') onSelectLive();
    else onSelectRun(value);
  }

  const value = currentRunId !== null && runs.some((r) => r.runId === currentRunId)
    ? currentRunId
    : '__live__';

  return (
    <div className="run-picker" title="Switch between the live run and past runs">
      <select value={value} onChange={onChange} disabled={busy}>
        <option value="__live__">● Live</option>
        {runs.map((r) => (
          <option key={r.runId} value={r.runId}>
            {formatStartedAt(r.startedAt)} · {summarize(r) || r.runId.slice(0, 19)}
          </option>
        ))}
      </select>
      {busy && <span className="run-picker-status">loading…</span>}
      {error !== null && <span className="run-picker-status err">{error}</span>}
    </div>
  );
}
