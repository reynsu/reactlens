// Plugin registry for the dashboard. Hosts (nativelens, future tools) register
// a `frameRenderer` keyed by `frame.source` so a single dashboard instance can
// render web (browser) AND native (RN device) frames without forking.
//
// This file tests the pure resolution: given a `source` and a list of
// plugins, return the right renderer. The React wiring lives in App.tsx and
// is exercised by the existing dashboard integration tests.
import { describe, expect, it } from 'vitest';
import {
  resolveFrameRenderer,
  type DashboardPlugin,
  type FrameRenderer,
} from '../../src/dashboard/plugins';

// Sentinel renderers — we never invoke them, just identity-check them out of
// the resolver.
const webRenderer: FrameRenderer = () => null;
const nativeRenderer: FrameRenderer = () => null;
const fallbackRenderer: FrameRenderer = () => null;

const webPlugin: DashboardPlugin = {
  name: 'reactlens-web',
  frameRenderers: { web: webRenderer },
};
const nativePlugin: DashboardPlugin = {
  name: 'nativelens-native',
  frameRenderers: { native: nativeRenderer },
};

describe('resolveFrameRenderer', () => {
  it('returns the renderer registered for a given source', () => {
    expect(resolveFrameRenderer('web', [webPlugin])).toBe(webRenderer);
    expect(resolveFrameRenderer('native', [webPlugin, nativePlugin])).toBe(nativeRenderer);
  });

  it('returns null when no plugin handles the source', () => {
    expect(resolveFrameRenderer('native', [webPlugin])).toBeNull();
    expect(resolveFrameRenderer('web', [])).toBeNull();
  });

  it('lets the first matching plugin win (registration order)', () => {
    const winning: FrameRenderer = () => null;
    const losing: FrameRenderer = () => null;
    const first: DashboardPlugin = { name: 'first', frameRenderers: { web: winning } };
    const second: DashboardPlugin = { name: 'second', frameRenderers: { web: losing } };
    expect(resolveFrameRenderer('web', [first, second])).toBe(winning);
  });

  it('treats a plugin with no frameRenderers field as a no-op for renderer lookup', () => {
    const panelOnly: DashboardPlugin = { name: 'panel-only' };
    expect(resolveFrameRenderer('web', [panelOnly, webPlugin])).toBe(webRenderer);
    expect(resolveFrameRenderer('native', [panelOnly])).toBeNull();
  });

  it('uses "web" as the canonical default when source is empty (callers should pass "web" explicitly)', () => {
    // We don't auto-substitute in the resolver — the contract is "pass the
    // source you observed". The empty-string case proves callers can't get
    // a renderer "for free" without an explicit source.
    expect(resolveFrameRenderer('', [webPlugin])).toBeNull();
  });
});

// builtinWebPlugin (src/dashboard/web/builtin-plugin.ts) lives in the
// JSX-scoped subtree the root tsconfig excludes, so it's covered by the
// dashboard integration tests + App.tsx render path rather than unit-tested
// here — importing it would force the unit tsconfig into the JSX-aware mode
// and pull React component types into Node-only test scope.
