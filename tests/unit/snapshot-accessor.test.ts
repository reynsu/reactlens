// TDD for the Component-Object Pattern runtime helper (v0.3 slice 6 phase 1).
//
// Locks behavior against the design doc at docs/design/snapshot-accessor.md.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { AddressInfo } from 'node:net';
import {
  Component,
  ComponentNotMountedError,
  SnapshotStreamDisconnectedError,
  bindTestId,
  connectAccessor,
  disconnectAccessor,
  resetAccessorForTest,
} from '../../src/component-object/snapshot-accessor';

type ComponentNode = {
  id?: string;
  name: string;
  key?: string | null;
  props: Record<string, unknown>;
  children: ComponentNode[];
};

function snapshot(testId: string, tree: ComponentNode): string {
  return JSON.stringify({ t: 'component:snapshot', testId, stepId: testId, tree });
}

function leaf(name: string, props: Record<string, unknown> = {}): ComponentNode {
  return { name, props, children: [] };
}

async function startFakeDashboard(): Promise<{
  url: string;
  pushSnapshot: (testId: string, tree: ComponentNode) => void;
  closeAllClients: () => void;
  stop: () => Promise<void>;
}> {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => wss.once('listening', () => resolve()));
  const port = (wss.address() as AddressInfo).port;
  const clients: WebSocket[] = [];
  wss.on('connection', (c) => {
    clients.push(c);
    c.on('close', () => {
      const idx = clients.indexOf(c);
      if (idx >= 0) clients.splice(idx, 1);
    });
  });
  return {
    url: `ws://127.0.0.1:${port}`,
    pushSnapshot: (testId, tree) => {
      const payload = snapshot(testId, tree);
      for (const c of clients) {
        if (c.readyState === c.OPEN) c.send(payload);
      }
    },
    closeAllClients: () => {
      for (const c of clients) {
        try {
          c.terminate();
        } catch {
          /* ignore */
        }
      }
    },
    stop: () =>
      new Promise<void>((resolve) =>
        wss.close(() => {
          resolve();
        }),
      ),
  };
}

async function waitForReady(check: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('timed out waiting for accessor state');
}

describe('SnapshotAccessor', () => {
  let server: Awaited<ReturnType<typeof startFakeDashboard>>;

  beforeEach(async () => {
    resetAccessorForTest();
    server = await startFakeDashboard();
  });

  afterEach(async () => {
    disconnectAccessor();
    await server.stop();
    resetAccessorForTest();
  });

  describe('mounted-component prop lookup', () => {
    it('returns the prop value from the latest snapshot for the bound testId', async () => {
      bindTestId('test-A');
      await connectAccessor(server.url);

      server.pushSnapshot('test-A', {
        name: 'App',
        props: {},
        children: [leaf('Pagination', { total: 11, pageSize: 5 })],
      });

      await waitForReady(() => {
        try {
          return Component('Pagination').props.total === 11;
        } catch {
          return false;
        }
      });
      expect(Component('Pagination').props.total).toBe(11);
      expect(Component('Pagination').props.pageSize).toBe(5);
    });

    it('finds the component depth-first regardless of nesting depth', async () => {
      bindTestId('test-A');
      await connectAccessor(server.url);

      server.pushSnapshot('test-A', {
        name: 'Root',
        props: {},
        children: [
          {
            name: 'Layout',
            props: {},
            children: [
              {
                name: 'Page',
                props: {},
                children: [leaf('Pagination', { total: 7, pageSize: 3 })],
              },
            ],
          },
        ],
      });

      await waitForReady(() => {
        try {
          return Component('Pagination').props.total === 7;
        } catch {
          return false;
        }
      });
      expect(Component('Pagination').props.total).toBe(7);
    });

    it('filters to the bound testId — does not leak snapshots across tests', async () => {
      bindTestId('test-A');
      await connectAccessor(server.url);

      server.pushSnapshot('test-B', {
        name: 'App',
        props: {},
        children: [leaf('Pagination', { total: 999, pageSize: 999 })],
      });
      await new Promise((r) => setTimeout(r, 50));

      expect(() => Component('Pagination').props.total).toThrow(ComponentNotMountedError);
    });
  });

  describe('unmounted-component error', () => {
    it('throws ComponentNotMountedError with the queried name', async () => {
      bindTestId('test-A');
      await connectAccessor(server.url);
      server.pushSnapshot('test-A', leaf('App'));
      await waitForReady(() => {
        try {
          // App is in tree; the read returns undefined (not a throw).
          // We're waiting for the snapshot to land.
          return Component('App').props.anything === undefined;
        } catch {
          return false;
        }
      });

      let caught: unknown = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        Component('NoSuchComponent').props.anything;
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ComponentNotMountedError);
      expect((caught as ComponentNotMountedError).componentName).toBe('NoSuchComponent');
      expect((caught as ComponentNotMountedError).kind).toBe('ComponentNotMountedError');
    });

    it('locks the error message prefix so diagnosis prompts can match it', () => {
      const err = new ComponentNotMountedError('Foo', 'test-A');
      expect(err.message).toMatch(
        /^Component\("Foo"\) not found in latest snapshot for test test-A\./,
      );
    });
  });

  describe('stream-disconnected error', () => {
    it('throws SnapshotStreamDisconnectedError after the WS closes', async () => {
      bindTestId('test-A');
      await connectAccessor(server.url);
      server.pushSnapshot('test-A', leaf('App'));
      await waitForReady(() => {
        try {
          return Component('App').props.foo === undefined;
        } catch {
          return false;
        }
      });

      server.closeAllClients();
      await new Promise((r) => setTimeout(r, 50));

      let caught: unknown = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        Component('App').props.foo;
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(SnapshotStreamDisconnectedError);
      expect((caught as SnapshotStreamDisconnectedError).kind).toBe(
        'SnapshotStreamDisconnectedError',
      );
    });

    it('locks the disconnected-error message prefix', () => {
      const err = new SnapshotStreamDisconnectedError('test-A', null);
      expect(err.message).toMatch(
        /^Snapshot stream disconnected \(test test-A, last snapshot never\)\./,
      );
    });
  });

  describe('lifecycle', () => {
    it('throws if Component() is called before bindTestId()', () => {
      expect(() => Component('App').props.foo).toThrow(/bindTestId|no testId bound/i);
    });

    it('connectAccessor is idempotent', async () => {
      bindTestId('test-A');
      await connectAccessor(server.url);
      await connectAccessor(server.url);
      server.pushSnapshot('test-A', leaf('App'));
      await waitForReady(() => {
        try {
          return Component('App').props.foo === undefined;
        } catch {
          return false;
        }
      });
    });
  });
});
