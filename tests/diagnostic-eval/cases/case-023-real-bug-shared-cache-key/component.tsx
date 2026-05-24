import * as React from 'react';

const CACHE = new Map<string, number>();
const SUBSCRIBERS = new Map<string, Set<() => void>>();

function useCachedCounter(id: string): [number, () => void] {
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
