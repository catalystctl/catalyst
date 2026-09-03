import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@/csync';
import App from './App';
import { queryClient } from './lib/queryClient';
import { initErrorReporter } from './lib/error-reporter';
import { debugLog } from './lib/debug-log';
import { preApplyCachedTheme } from './stores/themeStore';
import './styles/globals.css';

// Replay the last saved palette + custom CSS before React mounts.
// The index.html boot script already did this pre-paint; this covers
// client-side navigations and cases where the inline script was skipped.
preApplyCachedTheme();

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

initErrorReporter();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
 <React.StrictMode>
 <QueryClientProvider client={queryClient}>
 <BrowserRouter>
 <App />
 </BrowserRouter>
 </QueryClientProvider>
 </React.StrictMode>,
);
