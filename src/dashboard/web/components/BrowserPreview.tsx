import type { FrameSource, TestRow } from '../types';

type Props = { frame?: FrameSource; test?: TestRow };

function frameToSrc(frame: FrameSource): string {
  // Live (base64) and replay (URL) frames meet here. The discriminator lives
  // on FrameSource, not on a sibling prop, so this component stays agnostic
  // of which mode produced the data.
  return frame.kind === 'base64' ? `data:image/jpeg;base64,${frame.data}` : frame.url;
}

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
          <img src={frameToSrc(frame)} alt="browser preview" />
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
