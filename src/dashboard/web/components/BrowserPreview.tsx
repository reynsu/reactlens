import type { TestRow } from '../types';

type Props = { frame?: string; test?: TestRow };

export function BrowserPreview({ frame, test }: Props): JSX.Element {
  return (
    <div className="preview">
      <div className="meta">
        {test !== undefined ? (
          <>
            <span style={{ color: 'var(--text)' }}>{test.title}</span>
            <span>·</span>
            <span>{test.suite}</span>
          </>
        ) : (
          <span>No test selected</span>
        )}
      </div>
      <div className="frame">
        {frame !== undefined ? (
          <img src={`data:image/jpeg;base64,${frame}`} alt="browser preview" />
        ) : (
          <div className="placeholder">
            {test === undefined ? 'Select a test to see the live browser' : 'Waiting for frames…'}
          </div>
        )}
      </div>
      {test?.error !== undefined && (
        <pre style={{ background: 'var(--panel-2)', padding: 12, borderRadius: 4, fontSize: 11, whiteSpace: 'pre-wrap' }}>
          {test.error}
        </pre>
      )}
    </div>
  );
}
