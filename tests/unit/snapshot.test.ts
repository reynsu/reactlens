// Tests serializeFiber against synthetic fiber trees. We construct fibers
// by hand because the real React internals would require setting up the
// renderer; these synthetic trees exercise every classification branch.
import { describe, expect, it } from 'vitest';
import { sanitizeProps, serializeFiber } from '../../src/component-bridge/snapshot';

type FakeFiber = {
  type?: unknown;
  elementType?: unknown;
  key?: string | number | null;
  memoizedProps?: Record<string, unknown> | null;
  memoizedState?: unknown;
  child?: FakeFiber | null;
  sibling?: FakeFiber | null;
  _debugSource?: { fileName?: string; lineNumber?: number } | null;
};

function fn(name: string): FakeFiber {
  const f = function (): null {
    return null;
  };
  Object.defineProperty(f, 'name', { value: name });
  return { type: f, memoizedProps: {}, child: null, sibling: null };
}

function host(tag: string): FakeFiber {
  return { type: tag, memoizedProps: {}, child: null, sibling: null };
}

function withChildren(parent: FakeFiber, ...children: FakeFiber[]): FakeFiber {
  if (children.length === 0) {
    parent.child = null;
    return parent;
  }
  parent.child = children[0] ?? null;
  for (let i = 0; i < children.length - 1; i += 1) {
    const cur = children[i];
    const nxt = children[i + 1];
    if (cur !== undefined) cur.sibling = nxt ?? null;
  }
  return parent;
}

describe('serializeFiber', () => {
  it('returns Root with empty children for an empty fiber', () => {
    const tree = serializeFiber({ type: null });
    expect(tree.name).toBe('Root');
    expect(tree.children).toEqual([]);
  });

  it('flattens host fibers; emits user components only', () => {
    const app = fn('App');
    const div = host('div');
    const button = fn('Button');
    withChildren(div, button);
    withChildren(app, div);
    const root: FakeFiber = { type: null };
    withChildren(root, app);

    const tree = serializeFiber(root);
    expect(tree.name).toBe('App');
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0]?.name).toBe('Button');
  });

  it('flattens passthrough fibers (Fragment, StrictMode) so children bubble up', () => {
    const fragment: FakeFiber = { type: Symbol('react.fragment') };
    const child = fn('Child');
    withChildren(fragment, child);

    const tree = serializeFiber(fragment);
    expect(tree.name).toBe('Child');
  });

  it('captures source location when _debugSource is present', () => {
    const f = fn('Loc');
    f._debugSource = { fileName: '/tmp/Loc.tsx', lineNumber: 42 };
    const tree = serializeFiber(f);
    expect(tree.source).toEqual({ file: '/tmp/Loc.tsx', line: 42 });
  });

  it('captures hooks via memoizedState linked list', () => {
    const f = fn('WithHooks');
    f.memoizedState = {
      memoizedState: 'hello',
      queue: { dispatch: () => null },
      next: {
        memoizedState: 42,
        queue: { dispatch: () => null },
        next: null,
      },
    };
    const tree = serializeFiber(f);
    expect(tree.hooks).toHaveLength(2);
    expect(tree.hooks?.[0]?.kind).toBe('state');
  });

  it('respects depth limit (no stack overflow on deep trees)', () => {
    const root: FakeFiber = { type: null };
    let cursor: FakeFiber = root;
    for (let i = 0; i < 200; i += 1) {
      const next = fn(`L${i}`);
      cursor.child = next;
      cursor = next;
    }
    expect(() => serializeFiber(root)).not.toThrow();
  });
});

describe('sanitizeProps', () => {
  it('passes through primitives', () => {
    expect(sanitizeProps({ a: 1, b: 'x', c: true, d: null })).toEqual({ a: 1, b: 'x', c: true, d: null });
  });

  it('replaces functions with [Function: name]', () => {
    function namedHandler(): void {}
    const out = sanitizeProps({ onClick: namedHandler });
    expect(out['onClick']).toBe('[Function: namedHandler]');
  });

  it('drops `children`', () => {
    const out = sanitizeProps({ a: 1, children: 'ignored' });
    expect(out).toEqual({ a: 1 });
  });

  it('handles cycles without crashing', () => {
    const obj: { self?: unknown } = {};
    obj.self = obj;
    const out = sanitizeProps({ ref: obj });
    expect(out['ref']).toEqual({ self: '[Circular]' });
  });

  it('serializes React elements as <Name />', () => {
    const el = { $$typeof: Symbol('react.element'), type: { displayName: 'Sub' }, props: {} };
    const out = sanitizeProps({ icon: el });
    expect(out['icon']).toBe('<Sub />');
  });

  it('truncates long strings', () => {
    const long = 'x'.repeat(500);
    const out = sanitizeProps({ s: long });
    expect((out['s'] as string).length).toBeLessThan(long.length);
  });
});
