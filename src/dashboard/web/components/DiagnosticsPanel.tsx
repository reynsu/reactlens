import type { Diagnosis, TestRow } from '../types';

type Props = {
  test?: TestRow;
  diagnosis?: { streamingText: string; final?: Diagnosis };
};

export function DiagnosticsPanel({ test, diagnosis }: Props): JSX.Element {
  if (test === undefined || (test.status !== 'failed' && test.status !== 'timedOut')) {
    return (
      <>
        <div className="panel-header">Diagnostics</div>
        <div className="empty-state">No failure to diagnose</div>
      </>
    );
  }
  if (diagnosis === undefined) {
    return (
      <>
        <div className="panel-header">Diagnostics</div>
        <div className="empty-state">Diagnosis not started</div>
      </>
    );
  }
  if (diagnosis.final === undefined) {
    return (
      <>
        <div className="panel-header">Diagnostics</div>
        <div className="diagnostics">
          <div className="stream">analyzing failure…</div>
          {diagnosis.streamingText.length > 0 && (
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, color: 'var(--muted)' }}>
              {diagnosis.streamingText}
            </pre>
          )}
        </div>
      </>
    );
  }
  const d = diagnosis.final;
  return (
    <>
      <div className="panel-header">Diagnostics</div>
      <div className="diagnostics">
        <div>
          <span className={`badge ${d.classification}`}>{d.classification}</span>
          <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--muted)' }}>
            confidence: {d.confidence}
          </span>
        </div>
        <div className="root-cause">{d.rootCause}</div>
        {d.evidence.length > 0 && (
          <ul className="evidence">
            {d.evidence.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        )}
        {d.suggestedFix.length > 0 && (
          <div>
            <div style={{ fontWeight: 600, margin: '8px 0 4px' }}>Suggested fix</div>
            <div style={{ fontSize: 12 }}>{d.suggestedFix}</div>
          </div>
        )}
        {d.patch !== undefined && d.patch.length > 0 && (
          <div>
            <div style={{ fontWeight: 600, margin: '12px 0 4px' }}>Patch</div>
            {d.patch.map((p, i) => (
              <div key={i} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{p.file}</div>
                <pre className="patch">- {p.oldStr}{'\n'}+ {p.newStr}</pre>
              </div>
            ))}
          </div>
        )}
        {d.gitContext?.componentLastChanged !== undefined && (
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
            Component last changed: {d.gitContext.componentLastChanged.author} ·{' '}
            {d.gitContext.componentLastChanged.message}
          </div>
        )}
      </div>
    </>
  );
}
