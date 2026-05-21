// Component-Object Pattern runtime helper (v0.3 slice 6).
//
// Specs that opt into the Component-Object Pattern (ADR-0006) assert on
// React component props at the spec level, not just the DOM:
//
//   await expect.poll(() => Component('LoginForm').props.isPending).toBe(false);
//
// This module is the runtime that resolves Component(name).props.<x> against
// the live component:snapshot stream. The design (addressing scheme,
// composition, subscription mechanism, error contract) is locked in
// docs/design/snapshot-accessor.md.
//
// Module-scope singleton state is intentional: Playwright workers are per
// process, so one worker = one accessor instance. testIds are unique within
// a process.
import WebSocket from 'ws';

type Json = string | number | boolean | null | { [k: string]: Json } | Json[];

type ComponentNode = {
  id?: string;
  name: string;
  key?: string | null;
  props: Record<string, unknown>;
  children: ComponentNode[];
};

type ComponentSnapshotEvent = {
  t: 'component:snapshot';
  testId: string;
  stepId: string;
  tree: ComponentNode;
};

// Error message format is locked — diagnosis prompts match against these
// prefixes. Changing the message is a breaking change for the prompts package.
export class ComponentNotMountedError extends Error {
  readonly kind = 'ComponentNotMountedError' as const;
  constructor(public readonly componentName: string, public readonly testId: string) {
    super(
      `Component(${JSON.stringify(componentName)}) not found in latest snapshot for test ${testId}. ` +
        `The component may be unmounted, or the displayName does not match the React fiber name.`,
    );
    this.name = 'ComponentNotMountedError';
  }
}

export class SnapshotStreamDisconnectedError extends Error {
  readonly kind = 'SnapshotStreamDisconnectedError' as const;
  constructor(
    public readonly testId: string,
    public readonly lastSnapshotAt: number | null,
  ) {
    const last = lastSnapshotAt === null ? 'never' : `${Date.now() - lastSnapshotAt}ms ago`;
    super(
      `Snapshot stream disconnected (test ${testId}, last snapshot ${last}). ` +
        `The dashboard WS closed before a snapshot for the queried component arrived.`,
    );
    this.name = 'SnapshotStreamDisconnectedError';
  }
}

type AccessorState = {
  ws: WebSocket | null;
  latestByTest: Map<string, ComponentSnapshotEvent>;
  closedAfterConnect: boolean;
  lastSnapshotAt: number | null;
  boundTestId: string | null;
};

const state: AccessorState = {
  ws: null,
  latestByTest: new Map(),
  closedAfterConnect: false,
  lastSnapshotAt: null,
  boundTestId: null,
};

export function bindTestId(testId: string): void {
  state.boundTestId = testId;
}

export async function connectAccessor(wsUrl: string): Promise<void> {
  if (state.ws !== null) return;
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const onError = (err: Error): void => {
      ws.removeAllListeners();
      reject(err);
    };
    ws.once('open', () => {
      ws.off('error', onError);
      state.ws = ws;
      state.closedAfterConnect = false;
      resolve();
    });
    ws.once('error', onError);
    ws.on('message', (raw) => {
      let event: { t?: string };
      try {
        event = JSON.parse(raw.toString()) as { t?: string };
      } catch {
        return;
      }
      if (event.t !== 'component:snapshot') return;
      const snap = event as ComponentSnapshotEvent;
      state.latestByTest.set(snap.testId, snap);
      state.lastSnapshotAt = Date.now();
    });
    ws.on('close', () => {
      state.closedAfterConnect = true;
      state.ws = null;
    });
  });
}

export function disconnectAccessor(): void {
  if (state.ws !== null) {
    try {
      state.ws.close();
    } catch {
      /* ignore */
    }
    state.ws = null;
  }
}

// Test-only: clear state between cases so the singleton doesn't leak across
// describe blocks. Production code (the reactlens fixture) does not call this.
export function resetAccessorForTest(): void {
  if (state.ws !== null) {
    try {
      state.ws.terminate();
    } catch {
      /* ignore */
    }
  }
  state.ws = null;
  state.latestByTest.clear();
  state.closedAfterConnect = false;
  state.lastSnapshotAt = null;
  state.boundTestId = null;
}

function findByName(node: ComponentNode, name: string): ComponentNode | null {
  if (node.name === name) return node;
  for (const child of node.children) {
    const hit = findByName(child, name);
    if (hit !== null) return hit;
  }
  return null;
}

export type ComponentHandle = {
  readonly name: string;
  readonly props: PropAccessor;
};

type PropAccessor = {
  readonly [key: string]: Json | undefined;
};

export function Component(name: string): ComponentHandle {
  return {
    name,
    props: new Proxy({} as PropAccessor, {
      get(_target, propKey): Json | undefined {
        if (state.boundTestId === null) {
          throw new Error(
            'Component(...).props read before bindTestId() — call bindTestId(testInfo.testId) in your fixture beforeEach.',
          );
        }
        if (state.closedAfterConnect && state.ws === null) {
          throw new SnapshotStreamDisconnectedError(state.boundTestId, state.lastSnapshotAt);
        }
        const latest = state.latestByTest.get(state.boundTestId);
        if (latest === undefined) {
          throw new ComponentNotMountedError(name, state.boundTestId);
        }
        const hit = findByName(latest.tree, name);
        if (hit === null) {
          throw new ComponentNotMountedError(name, state.boundTestId);
        }
        if (typeof propKey !== 'string') return undefined;
        return hit.props[propKey] as Json | undefined;
      },
    }),
  };
}
