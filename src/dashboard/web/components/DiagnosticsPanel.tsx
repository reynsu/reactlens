import { useState } from 'react';
import type { Diagnosis, TestRow } from '../types';

type Props = {
  test?: TestRow;
  diagnosis?: { streamingText: string; final?: Diagnosis };
};

// Renders a single patch hunk as a copy-pasteable block. Keeping the format
// human-readable (filename header + - / + lines) rather than synthesizing a
// pseudo-unified-diff with fake hunk markers; without real line numbers a
// fake `@@` header would mislead `git apply`. The user reviews and edits
// before applying — per CLAUDE.md §13 we never auto-apply.
function formatPatch(p: NonNullable<Diagnosis['patch']>[number]): string {
  return `# file: ${p.file}\n- ${p.oldStr}\n+ ${p.newStr}`;
}

function CopyButton(props: { text: string; label: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  async function onClick(): Promise<void> {
    try {
      await navigator.clipboard.writeText(props.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard API blocked (insecure context, permission denied). Fall back
      // to a textarea-select trick so the user can still ⌘C the content.
      const ta = document.createElement('textarea');
      ta.value = props.text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      } finally {
        document.body.removeChild(ta);
      }
    }
  }
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        marginLeft: 8,
        padding: '2px 8px',
        fontSize: 11,
        background: copied ? 'var(--pass, #1f883d)' : 'transparent',
        color: copied ? 'white' : 'var(--muted, #888)',
        border: '1px solid var(--border, #444)',
        borderRadius: 3,
        cursor: 'pointer',
      }}
      title="Copy this patch to the clipboard. reactlens never applies patches automatically — you review and apply by hand."
    >
      {copied ? '✓ copied' : props.label}
    </button>
  );
}

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
            <div style={{ fontWeight: 600, margin: '12px 0 4px', display: 'flex', alignItems: 'center' }}>
              <span>Patch</span>
              {d.patch.length > 1 && (
                <CopyButton
                  label="copy all"
                  text={d.patch.map(formatPatch).join('\n\n')}
                />
              )}
            </div>
            {d.patch.map((p, i) => (
              <div key={i} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center' }}>
                  <span>{p.file}</span>
                  <CopyButton label="copy" text={formatPatch(p)} />
                </div>
                <pre className="patch">- {p.oldStr}{'\n'}+ {p.newStr}</pre>
              </div>
            ))}
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
              Review the diff before applying — reactlens never patches files automatically.
            </div>
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
