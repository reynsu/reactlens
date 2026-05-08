import { useMemo } from 'react';
import type { TestRow } from '../types';

type Props = {
  tests: TestRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

function statusIcon(status: TestRow['status']): { glyph: string; cls: string } {
  switch (status) {
    case 'running':
      return { glyph: '·', cls: 'run' };
    case 'passed':
      return { glyph: '✓', cls: 'pass' };
    case 'failed':
    case 'timedOut':
      return { glyph: '✗', cls: 'fail' };
    case 'skipped':
      return { glyph: '−', cls: 'skip' };
  }
}

export function TestList({ tests, selectedId, onSelect }: Props): JSX.Element {
  const groups = useMemo(() => {
    const grouped = new Map<string, TestRow[]>();
    for (const t of tests) {
      const key = t.suite || t.file;
      const arr = grouped.get(key) ?? [];
      arr.push(t);
      grouped.set(key, arr);
    }
    return Array.from(grouped.entries());
  }, [tests]);

  return (
    <div className="panel">
      <div className="panel-header">Tests</div>
      {tests.length === 0 ? (
        <div className="empty-state">Waiting for run…</div>
      ) : (
        groups.map(([suite, rows]) => (
          <div key={suite}>
            <div className="suite-header">{suite}</div>
            {rows.map((t) => {
              const { glyph, cls } = statusIcon(t.status);
              return (
                <div
                  key={t.id}
                  className={`test-row ${selectedId === t.id ? 'selected' : ''}`}
                  onClick={() => onSelect(t.id)}
                >
                  <span className={`icon ${cls}`}>{glyph}</span>
                  <span className="title" title={t.title}>{t.title}</span>
                  <span className="duration">{t.duration !== undefined ? `${t.duration}ms` : ''}</span>
                </div>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}
