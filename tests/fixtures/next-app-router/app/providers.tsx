'use client';

import { type ReactNode, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NavBar } from '@/components/NavBar';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

// Module-scope singleton so React StrictMode's double useEffect, route
// transitions, and HMR all share one MSW startup. worker.start() is not
// safely re-entrant; calling it twice while the first promise is pending
// can deadlock against the service-worker registration.
let mswStartPromise: Promise<void> | null = null;

function ensureMswStarted(): Promise<void> {
  if (mswStartPromise !== null) return mswStartPromise;
  if (typeof window === 'undefined') return Promise.resolve();
  const params = new URLSearchParams(window.location.search);
  if (params.get('mocks') === 'off') {
    mswStartPromise = Promise.resolve();
    return mswStartPromise;
  }
  mswStartPromise = (async () => {
    const { worker } = await import('@/lib/msw-browser');
    await worker.start({ onUnhandledRequest: 'bypass', quiet: true });
  })();
  return mswStartPromise;
}

export function Providers({ children }: { children: ReactNode }): JSX.Element {
  // Gate rendering on MSW being ready so the first fetch in any page is
  // never a real network call. The ?mocks=off escape hatch lets specs
  // drive requests directly via Playwright route() when they need to.
  const [mocksReady, setMocksReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void ensureMswStarted().then(() => {
      if (!cancelled) setMocksReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!mocksReady) {
    return <div data-testid="mocks-booting" />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <NavBar />
      {children}
    </QueryClientProvider>
  );
}
