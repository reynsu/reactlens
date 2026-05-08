/// <reference lib="dom" />
// Walks a React fiber tree and produces a JSON-safe ComponentNode (CLAUDE.md
// Section 9). Documented decisions:
//
// - DEPTH LIMIT: walks at most MAX_DEPTH (30) levels deep. Prevents stack
//   overflow on pathological trees and bounds serialization cost on huge apps.
// - PROP SERIALIZATION: primitives pass through; functions become
//   '[Function]'; React elements become '<ComponentName />'; nested
//   objects/arrays are walked with cycle detection up to MAX_PROP_DEPTH.
// - HOOK CAPTURE: walks the memoizedState linked list and classifies each
//   hook by the shape of its memoized state. We can't see hook NAMES at
//   runtime — only kinds — so `name` is omitted unless the dev runtime later
//   provides it.
// - HOST FILTER: drops DOM elements (string `type`); keeps only function and
//   class components which carry user-meaningful information.
// - SOURCE MAP: reads `_debugSource` when present (dev-only React build).

type AnyFiber = {
  type?: unknown;
  elementType?: unknown;
  key?: string | number | null;
  memoizedProps?: Record<string, unknown> | null;
  memoizedState?: unknown;
  child?: AnyFiber | null;
  sibling?: AnyFiber | null;
  _debugSource?: { fileName?: string; lineNumber?: number } | null;
  stateNode?: unknown;
};

export type ComponentNode = {
  name: string;
  key?: string | null;
  props: Record<string, unknown>;
  hooks?: HookSnapshot[];
  source?: { file: string; line: number };
  children: ComponentNode[];
};

export type HookSnapshot = {
  kind: 'state' | 'effect' | 'memo' | 'ref' | 'context' | 'reducer' | 'other';
  value?: unknown;
  name?: string;
};

const MAX_DEPTH = 30;
const MAX_PROP_DEPTH = 4;
const MAX_STRING_LEN = 200;
const MAX_ARRAY_ITEMS = 50;

function isReactElement(v: unknown): v is { type: unknown; props?: { children?: unknown } } {
  if (v === null || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return r['$$typeof'] !== undefined && typeof r['type'] !== 'undefined';
}

function reactElementName(el: { type: unknown }): string {
  if (typeof el.type === 'string') return el.type;
  const t = el.type as { displayName?: string; name?: string } | null | undefined;
  return t?.displayName ?? t?.name ?? 'Anonymous';
}

function sanitizeValue(v: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (v === null) return null;
  if (depth > MAX_PROP_DEPTH) return '[…]';
  const type = typeof v;
  if (type === 'undefined') return undefined;
  if (type === 'boolean' || type === 'number') return v;
  if (type === 'bigint') return `${(v as bigint).toString()}n`;
  if (type === 'symbol') return (v as symbol).toString();
  if (type === 'function') {
    const name = (v as { name?: string }).name;
    return name !== undefined && name.length > 0 ? `[Function: ${name}]` : '[Function]';
  }
  if (type === 'string') {
    return (v as string).length > MAX_STRING_LEN ? `${(v as string).slice(0, MAX_STRING_LEN)}…` : v;
  }
  // object
  if (seen.has(v as object)) return '[Circular]';
  seen.add(v as object);
  if (isReactElement(v)) return `<${reactElementName(v as { type: unknown })} />`;
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    for (let i = 0; i < v.length && i < MAX_ARRAY_ITEMS; i += 1) {
      out.push(sanitizeValue(v[i], seen, depth + 1));
    }
    if (v.length > MAX_ARRAY_ITEMS) out.push(`…+${v.length - MAX_ARRAY_ITEMS} more`);
    return out;
  }
  // Plain object: serialize own enumerable keys.
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(v as object)) {
    out[key] = sanitizeValue((v as Record<string, unknown>)[key], seen, depth + 1);
  }
  return out;
}

export function sanitizeProps(props: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (props === null || props === undefined) return {};
  const seen = new WeakSet<object>();
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(props)) {
    if (key === 'children') continue; // children are represented as fiber children
    out[key] = sanitizeValue(props[key], seen, 0);
  }
  return out;
}

function classifyHook(state: { tag?: number; queue?: unknown; baseState?: unknown }): HookSnapshot['kind'] {
  // Without React's internal hook tags exposed, we can only reliably tell
  // useState/useReducer (they have a `queue`) from everything else. Effects,
  // memos, refs all lack a queue and are lumped as 'other' rather than
  // returning a wrong specific kind. The HookSnapshot.kind union still allows
  // 'effect'/'memo'/'ref'/'context'/'reducer' so a future analyzer can refine
  // without a protocol change.
  if (state.queue !== undefined && state.queue !== null) return 'state';
  return 'other';
}

function collectHooks(memoizedState: unknown): HookSnapshot[] | undefined {
  if (memoizedState === null || typeof memoizedState !== 'object') return undefined;
  const hooks: HookSnapshot[] = [];
  const seen = new WeakSet<object>();
  let cursor: unknown = memoizedState;
  // Hard cap is also a stop-gap against any pathological cycle React might
  // introduce in a future version; the linked list itself is acyclic today.
  for (let guard = 0; cursor !== null && cursor !== undefined && guard < 200; guard += 1) {
    if (typeof cursor !== 'object') break;
    const node = cursor as { memoizedState?: unknown; baseState?: unknown; queue?: unknown; next?: unknown };
    hooks.push({ kind: classifyHook(node), value: sanitizeValue(node.memoizedState, seen, 0) });
    cursor = node.next;
  }
  return hooks.length > 0 ? hooks : undefined;
}

// Returns:
//   - 'host' for DOM elements (string type, eg 'div', 'span')
//   - the display name for user/library function/class/forwardRef/memo
//   - 'passthrough' for transparent React internals (StrictMode, Fragment,
//     ContextProvider, etc.) — we flatten these so the tree remains useful
//   - 'host' for HostRoot (the very top), so depth-0 caller can synthesize
type Classification =
  | { kind: 'component'; name: string }
  | { kind: 'host' }
  | { kind: 'passthrough' };

function classifyFiber(fiber: AnyFiber): Classification {
  const t = fiber.type ?? fiber.elementType;
  if (t === undefined || t === null) {
    // HostRoot fiber has type=null. Render as host at the top, passthrough
    // beneath (so we don't emit duplicate root nodes when host elements
    // wrap our app).
    return { kind: 'passthrough' };
  }
  if (typeof t === 'string') return { kind: 'host' };
  if (typeof t === 'function') {
    const fn = t as { displayName?: string; name?: string };
    const name = fn.displayName ?? fn.name ?? 'Anonymous';
    return { kind: 'component', name };
  }
  if (typeof t === 'symbol') {
    // Fragment, StrictMode, Suspense, etc. Flatten — children bubble up.
    return { kind: 'passthrough' };
  }
  const obj = t as {
    displayName?: string;
    render?: { displayName?: string; name?: string };
    type?: unknown;
    _context?: { displayName?: string };
    $$typeof?: symbol;
  };
  if (obj._context !== undefined) {
    // Context.Provider / Context.Consumer — useful to surface in the tree
    // because React Query, theme providers, etc. live here.
    return { kind: 'component', name: `Context(${obj._context.displayName ?? '?'})` };
  }
  if (obj.render !== undefined) {
    return { kind: 'component', name: obj.render.displayName ?? obj.render.name ?? 'ForwardRef' };
  }
  if (obj.type !== undefined && typeof obj.type !== 'string') {
    const inner = obj.type as { displayName?: string; name?: string };
    return { kind: 'component', name: inner.displayName ?? inner.name ?? 'Memo' };
  }
  if (obj.displayName !== undefined) {
    return { kind: 'component', name: obj.displayName };
  }
  return { kind: 'passthrough' };
}

function source(fiber: AnyFiber): { file: string; line: number } | undefined {
  const dbg = fiber._debugSource;
  if (dbg === null || dbg === undefined) return undefined;
  if (typeof dbg.fileName !== 'string' || typeof dbg.lineNumber !== 'number') return undefined;
  return { file: dbg.fileName, line: dbg.lineNumber };
}

export function serializeFiber(root: AnyFiber): ComponentNode {
  // Returns a list (not a single node) so passthrough/host fibers can flatten
  // their children up to the parent. Components return a one-element list
  // containing themselves; passthrough/host fibers return their children
  // walked recursively.
  function walk(fiber: AnyFiber, depth: number): ComponentNode[] {
    if (depth > MAX_DEPTH) return [];

    const childList: ComponentNode[] = [];
    let child = fiber.child ?? null;
    while (child !== null) {
      childList.push(...walk(child, depth + 1));
      child = child.sibling ?? null;
    }

    const cls = classifyFiber(fiber);
    if (cls.kind !== 'component') {
      // host or passthrough — flatten children up to caller.
      return childList;
    }

    const node: ComponentNode = {
      name: cls.name,
      key: fiber.key === undefined || fiber.key === null ? null : String(fiber.key),
      props: sanitizeProps(fiber.memoizedProps),
      children: childList,
    };
    const hooks = collectHooks(fiber.memoizedState);
    if (hooks !== undefined) node.hooks = hooks;
    const src = source(fiber);
    if (src !== undefined) node.source = src;
    return [node];
  }

  const top = walk(root, 0);
  if (top.length === 1 && top[0] !== undefined) return top[0];
  return { name: 'Root', props: {}, children: top };
}
