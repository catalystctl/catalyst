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
import '@fontsource-variable/oxanium';
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

// Render immediately with the device language. The instance default is a
// secondary preference and must not hold the app hostage to a slow/unavailable
// backend on startup. `applyLocale` updates i18next (and therefore the UI)
// once the setting is available.
renderApp();
// Let auth/session restoration and the first paint get ahead of this optional
// request. This also keeps a saved user locale from being needlessly replaced
// while the session is being hydrated.
const scheduleLocaleBootstrap = (): void => {
  const requestIdleCallback = (window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  }).requestIdleCallback;
  if (requestIdleCallback) {
    requestIdleCallback(() => void bootstrapSystemLocale(), { timeout: 2000 });
  } else {
    window.setTimeout(() => void bootstrapSystemLocale(), 0);
  }
};
scheduleLocaleBootstrap();
