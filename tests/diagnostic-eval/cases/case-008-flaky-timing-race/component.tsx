import { useLayoutEffect, useRef, useState } from 'react';

export function SubscribeButton(): JSX.Element {
  const [subscribed, setSubscribed] = useState(false);
  const handlerRef = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    handlerRef.current = (): void => setSubscribed(true);
  }, []);

  return (
    <button data-testid="subscribe" onClick={() => handlerRef.current()}>
      {subscribed ? 'Subscribed' : 'Subscribe'}
    </button>
  );
}
