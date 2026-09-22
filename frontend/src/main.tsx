/**
 * main.tsx
 * ---------------------------------------------------------------------------
 * The app entry point. It wires the three providers every page depends on:
 *
 *   QueryClientProvider  - server state (TanStack Query)
 *   AuthProvider         - who is signed in (the app's only React Context)
 *   BrowserRouter        - client-side routing
 *   App                  - our route tree
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      /*
       * Refetch when the tab regains focus.
       *
       * The customer site and the admin dashboard are separate apps in
       * separate tabs, so nothing tells this one that staff just confirmed a
       * booking or published a car - React Query's cache invalidation only
       * reaches queries inside the same app. Without this, the only way to see
       * a change made next door was a manual page refresh.
       *
       * `staleTime` is what stops it hammering the API: a query fetched less
       * than 30 seconds ago is still fresh, so tabbing back and forth costs
       * nothing. Turning the refetch off entirely was solving that problem
       * twice, at the cost of showing stale data indefinitely.
       */
      refetchOnWindowFocus: true,
      staleTime: 30000,
      retry: 1,
    },
  },
});

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element #root not found in index.html');

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {/* AuthProvider sits INSIDE BrowserRouter: it renders components that
            use router hooks, and outside the router those would throw. */}
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
