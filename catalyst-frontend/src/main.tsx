import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@/csync';
import App from './App';
import { queryClient } from './lib/queryClient';
import { initErrorReporter } from './lib/error-reporter';
import { debugLog } from './lib/debug-log';
import { preApplyCachedTheme } from './stores/themeStore';
import './styles/globals.css';

// Initialize i18n before React mounts so the first render already uses the
// detected language. `user-locale` follows the signed-in user's saved
// preference once the session is restored; `system-locale` reads the
// instance-wide default an admin configured.
import './i18n';
import './i18n/user-locale';
import { bootstrapSystemLocale } from './i18n/system-locale';

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

function renderApp(): void {
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          {/* Fallback while a translation catalog chunk loads. */}
          <Suspense
            fallback={
              <div className="flex h-screen items-center justify-center bg-background">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            }
          >
            <App />
          </Suspense>
        </BrowserRouter>
      </QueryClientProvider>
    </React.StrictMode>,
  );
}

// Resolve the instance default language first: rendering before it lands
// would show a first-time visitor one frame of the wrong language. The
// helper never rejects — an unreachable backend just renders with the
// device language.
void bootstrapSystemLocale().finally(renderApp);
