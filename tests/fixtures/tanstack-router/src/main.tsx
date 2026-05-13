import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createRouter,
  createRoute,
  createRootRoute,
  RouterProvider,
} from '@tanstack/react-router';
import { App } from './App';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { CheckoutPage } from './pages/CheckoutPage';
import './styles.css';

async function enableMocks(): Promise<void> {
  // Mirror the Vite/react-router fixture: skip MSW when the spec needs
  // request-by-request control via page.route(). MSW would otherwise win
  // the race at the service-worker layer.
  if (new URLSearchParams(window.location.search).get('mocks') === 'off') return;
  const { worker } = await import('./mocks/browser');
  await worker.start({ onUnhandledRequest: 'bypass' });
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

// Code-based routes (no file-based codegen). Simpler for a fixture; the
// AST analyzer doesn't yet target TanStack-specific conventions, so file
// routes wouldn't unlock anything for the moat today.
const rootRoute = createRootRoute({ component: App });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: LoginPage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dashboard',
  component: DashboardPage,
});

const checkoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/checkout',
  component: CheckoutPage,
});

const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, loginRoute, dashboardRoute, checkoutRoute]),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

void enableMocks().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </React.StrictMode>,
  );
});
