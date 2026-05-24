// Synthetic moat-validation case (Type B: sibling-state leak — the same
// class as case-021 but in <100 lines so the snapshot fits comfortably
// under the truncation ceiling).
//
// Two <Counter> siblings each call useCachedCounter(id). The hook is
// supposed to keep per-id state in a process-wide cache (mimicking
// useQuery / react-query semantics), but its cache key is hard-coded
// to the string 'counter' instead of `counter-${id}`. Result: both
// counters share one slot — whatever the user does to one is reflected
// in the other.
//
// What a black-box (DOM-only) tool sees on test failure:
//   "Counter B: expected '0', got '5'."
// The DOM tells you the value is wrong. It does NOT tell you that
// Counter A and B are sharing state — they could be independent state
// machines that both happened to land at 5, or B could be reading from
// a wrong source. Many hypotheses.
//
// What a component-tree-aware tool sees: both <Counter> nodes have
// the SAME hook value despite being independent fibers. That is the
// fingerprint of a shared cache key.

import * as React from 'react';

// Process-wide cache. Real apps use react-query, swr, jotai, etc. — same
// shape (key → value).
const CACHE = new Map<string, number>();
const SUBSCRIBERS = new Map<string, Set<() => void>>();

function useCachedCounter(id: string): [number, () => void] {
  // BUG: cache key is the literal 'counter' — drops the per-instance id.
  // Should be `counter-${id}`.
  const key = 'counter';
  const [, rerender] = React.useReducer((n: number) => n + 1, 0);

  React.useEffect(() => {
    let subs = SUBSCRIBERS.get(key);
    if (subs === undefined) {
      subs = new Set();
      SUBSCRIBERS.set(key, subs);
    }
    subs.add(rerender);
    return () => {
      subs?.delete(rerender);
    };
  }, [key]);

  const value = CACHE.get(key) ?? 0;
  const increment = React.useCallback(() => {
    CACHE.set(key, (CACHE.get(key) ?? 0) + 1);
    SUBSCRIBERS.get(key)?.forEach((s) => s());
  }, [key]);
  return [value, increment];
}

export function Counter({ id }: { id: string }): JSX.Element {
  const [count, increment] = useCachedCounter(id);
  return (
    <div data-testid={`counter-${id}`}>
      <span data-testid={`count-${id}`}>{count}</span>
      <button data-testid={`increment-${id}`} onClick={increment}>
        +
      </button>
    </div>
  );
}

export function CounterPair(): JSX.Element {
  return (
    <div data-testid="counter-pair">
      <Counter id="a" />
      <Counter id="b" />
    </div>
  );
}
