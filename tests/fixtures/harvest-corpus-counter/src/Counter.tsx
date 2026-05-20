import { useState } from 'react';

export function Counter(): JSX.Element {
  const [count, setCount] = useState(0);
  return (
    <div>
      <span data-testid="count">{count}</span>
      <button data-testid="increment" onClick={() => setCount(count + 1)}>
        +
      </button>
    </div>
  );
}
