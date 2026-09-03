/**
 * main.tsx
 * ---------------------------------------------------------------------------
 * The app entry point. It wires the three providers every page depends on:
 *
 *   QueryClientProvider  - server state (TanStack Query)
 *   BrowserRouter        - client-side routing
 *   App                  - our route tree
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Do not hammer the API when the user tabs back and forth.
      refetchOnWindowFocus: false,
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
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
