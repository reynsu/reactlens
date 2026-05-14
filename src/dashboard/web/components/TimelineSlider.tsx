// Scrubs through TimelineStep[] for a single test during replay. The parent
// (App.tsx) hooks the onChange callback into a `select:step` dispatch which
// rewires the head-of-test frame + tree maps; BrowserPreview and
// ComponentInspector then re-render off the chosen step.
//
// Hidden in live mode entirely (parent doesn't render it). Hidden in replay
// when the test has 0 or 1 step — a slider over a single tick is just noise.
import type { TimelineStep } from '../types';

type Props = {
  steps: TimelineStep[];
  currentIdx: number;
  onChange: (idx: number) => void;
};

export function TimelineSlider({ steps, currentIdx, onChange }: Props): JSX.Element | null {
  if (steps.length <= 1) return null;
  const clampedIdx = Math.max(0, Math.min(currentIdx, steps.length - 1));
  const step = steps[clampedIdx];

  return (
    <div className="timeline-slider" role="group" aria-label="Step timeline">
      <div className="timeline-slider-row">
        <span className="timeline-step-counter">
          {clampedIdx + 1}/{steps.length}
        </span>
        <input
          type="range"
          min={0}
          max={steps.length - 1}
          step={1}
          value={clampedIdx}
          onChange={(e) => onChange(parseInt(e.target.value, 10))}
          aria-label="scrub through test steps"
        />
      </div>
      <div className="timeline-step-title" title={step?.title ?? ''}>
        {step?.title ?? '—'}
      </div>
    </div>
  );
}
