// Dashboard plugin registry — pure resolver + shared types.
//
// Lives outside `src/dashboard/web/` so the unit tests (which run under the
// root NodeNext tsconfig) can typecheck it without dragging JSX in. Built-in
// renderers (which DO import React components) live in `web/builtin-plugin.ts`
// next to the components they wrap.
//
// Hosts (reactlens itself, nativelens, future tools) register a renderer
// keyed by `frame.source` so a single dashboard instance can render web
// (browser) AND native (RN device) frames without forking.
//
// The shape is intentionally minimal for v0.1: a plugin is a name plus an
// optional `frameRenderers` map. Future plugins may add panel slots; we add
// fields here when a concrete consumer needs them, not before.
import type { ComponentType } from 'react';
import type { FrameSource, TestRow } from './web/types';

export type FrameRendererProps = {
  frame?: FrameSource;
  test?: TestRow;
};

export type FrameRenderer = ComponentType<FrameRendererProps>;

export type DashboardPlugin = {
  // Identifier for diagnostics / future plugin-conflict detection. Not used
  // for lookup — sources are.
  name: string;
  // Keyed by the value of `frame.source` (defaulting to 'web' when absent).
  // Optional so plugins that only add panels can omit it entirely.
  frameRenderers?: Record<string, FrameRenderer>;
};

export function resolveFrameRenderer(
  source: string,
  plugins: DashboardPlugin[],
): FrameRenderer | null {
  for (const p of plugins) {
    const r = p.frameRenderers?.[source];
    if (r !== undefined) return r;
  }
  return null;
}
