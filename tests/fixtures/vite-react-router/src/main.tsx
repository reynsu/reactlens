import React, { Profiler, type ProfilerOnRenderCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { App } from './App';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { CaseFivePage } from './pages/eval/CaseFivePage';
import { CaseNinePage } from './pages/eval/CaseNinePage';
import './styles.css';

async function enableMocks(): Promise<void> {
  // Skip MSW when tests need Playwright route interception. Tests opt out by
  // navigating with ?mocks=off; MSW's service worker would otherwise win the
  // race against page.route() because it intercepts before the network layer.
  if (new URLSearchParams(window.location.search).get('mocks') === 'off') return;
  const { worker } = await import('./mocks/browser');
  await worker.start({ onUnhandledRequest: 'bypass' });
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <LoginPage /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'checkout', element: <CheckoutPage /> },
      // Eval scaffolds — render isolated case components so the bridge can
      // capture real snapshots for tests/diagnostic-eval/cases/*.
      { path: 'eval/case-005', element: <CaseFivePage /> },
      { path: 'eval/case-009', element: <CaseNinePage /> },
    ],
  },
]);

// Lightweight benchmark hook: each React commit's actualDuration is pushed
// to window.__rlProfile__ so a Playwright spec can read it back and compare
// per-render cost with vs. without the probe injected. No-op in normal use
// (window globals do not affect any render path).
declare global {
  interface Window {
    __rlProfile__?: Array<{
      phase: 'mount' | 'update' | 'nested-update';
      actualDuration: number;
      baseDuration: number;
      commitTime: number;
    }>;
  }
}
const onRender: ProfilerOnRenderCallback = (_id, phase, actualDuration, baseDuration, _start, commitTime) => {
  if (window.__rlProfile__ === undefined) window.__rlProfile__ = [];
  window.__rlProfile__.push({ phase, actualDuration, baseDuration, commitTime });
};

void enableMocks().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Profiler id="fixture-root" onRender={onRender}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </Profiler>
    </React.StrictMode>,
  );
});
