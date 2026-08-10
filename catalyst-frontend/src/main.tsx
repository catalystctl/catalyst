import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import App from './App';
import { queryClient } from './lib/queryClient';
import { reportSystemError } from './services/api/systemErrors';
import { debugLog } from './lib/debug-log';
import './styles/globals.css';

// Self-hosted fonts (no external requests)
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/outfit';
import '@fontsource-variable/jetbrains-mono';

// Register service worker for static-asset caching (production only).
// Dev registration causes stale hashed bundles and confuses HMR.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => debugLog('[SW] Registered:', reg.scope))
      .catch((err) => console.warn('[SW] Registration failed:', err));
  });
} else if ('serviceWorker' in navigator) {
  // Unregister any leftover SW from a previous production session while developing
  navigator.serviceWorker.getRegistrations?.().then((regs) => {
    regs.forEach((reg) => reg.unregister());
  }).catch(() => {});
}

window.addEventListener('error', (event) => {
 reportSystemError({
 level: 'error',
 component: 'GlobalWindowError',
 message: event.message || 'Unknown error',
 stack: event.error?.stack,
 metadata: { filename: event.filename, lineno: event.lineno, colno: event.colno },
 });
});

window.addEventListener('unhandledrejection', (event) => {
 const reason = event.reason;
 reportSystemError({
 level: 'error',
 component: 'UnhandledRejection',
 message: reason instanceof Error ? reason.message : String(reason),
 stack: reason instanceof Error ? reason.stack : undefined,
 metadata: { type: 'unhandledrejection' },
 });
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
 <React.StrictMode>
 <QueryClientProvider client={queryClient}>
 <BrowserRouter>
 <App />
 </BrowserRouter>
 <ReactQueryDevtools initialIsOpen={false} />
 </QueryClientProvider>
 </React.StrictMode>,
);
