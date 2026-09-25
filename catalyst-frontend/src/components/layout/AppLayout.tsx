import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Sidebar from './Sidebar';
import Breadcrumbs from './Breadcrumbs';
import FleetHeartbeat from './FleetHeartbeat';
import { useServerStateUpdates } from '../../hooks/useServerStateUpdates';
import { useSseAdminEvents } from '../../hooks/useSseAdminEvents';
import { useProfileSync } from '../../hooks/useProfileSync';
import { usePanelBranding } from '../../hooks/usePanelBranding';
import { useCmdK } from '../../hooks/useKeyboardShortcut';
import { Menu, X, Search } from 'lucide-react';
import SearchPalette from '../search/SearchPalette';
import { cn } from '@/lib/utils';
import UpdateNotification from '../shared/UpdateNotification';
import UploadProgressIndicator from '../files/UploadProgressIndicator';
import DownloadProgressIndicator from '../files/DownloadProgressIndicator';
import { showsDemoChrome } from '../../demo/isDemo';

function AppLayout() {
  useServerStateUpdates();
  useSseAdminEvents();
  useProfileSync();
  const { t } = useTranslation('layout');
  const { panelName } = usePanelBranding();
  const { pathname } = useLocation();
  const isServerWorkspace = /^\/servers\/[^/]+/.test(pathname);

  const shortcut = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘K' : 'Ctrl+K';
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  useCmdK(() => setIsSearchOpen(true));

  useEffect(() => setIsMobileSidebarOpen(false), [pathname]);
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setIsMobileSidebarOpen(false); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, []);

  // The cabinet rail's search button lives in a different subtree to the
  // palette, so it signals through a window event.
  useEffect(() => {
    const open = () => setIsSearchOpen(true);
    window.addEventListener('catalyst:open-search', open);
    return () => window.removeEventListener('catalyst:open-search', open);
  }, []);

  return (
    // Demo builds render a fixed h-8 banner above everything: shift the shell
    // below it and shrink to fit so nothing overlaps and no page scroll appears.
    <div className={cn('app-shell flex font-sans', showsDemoChrome ? 'mt-8 h-[calc(100dvh-2rem)]' : 'h-[100dvh]')}>
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:m-2 focus:rounded-sm focus:bg-card focus:px-3 focus:py-2 focus:text-foreground">{t('shell.skipToContent')}</a>
      <UpdateNotification />
      {/* Mobile overlay */}
      {isMobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-surface-0/60 backdrop-blur-sm lg:hidden"
          onClick={() => setIsMobileSidebarOpen(false)}
          role="presentation"
        />
      )}

      {/* Mobile header */}
      <div className={cn('fixed left-0 right-0 z-30 flex h-12 items-center justify-between border-b border-border/70 bg-card px-3 lg:hidden', showsDemoChrome ? 'top-8' : 'top-0')}>
        <button
          type="button"
          onClick={() => setIsMobileSidebarOpen(true)}
          className="flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-surface-2 hover:text-foreground"
          aria-label={t('shell.openMenu')}
          aria-expanded={isMobileSidebarOpen}
          aria-controls="mobile-sidebar"
        >
          <Menu className="h-4 w-4" />
        </button>
        <span className="flex items-center gap-2">
          <span className="deck-hatch h-[3px] w-5" aria-hidden />
          <span className="font-display text-mini font-semibold uppercase tracking-[0.18em] text-foreground">
            {panelName}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setIsSearchOpen(true)}
          className="flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-surface-2 hover:text-foreground"
          aria-label={t('common:actions.search')}
        >
          <Search className="h-4 w-4" />
        </button>
      </div>

      {/* Cabinet rail (desktop) / drawer (mobile) */}
      <div
        id="mobile-sidebar"
        className={cn(
          'fixed left-0 z-50 transform transition-transform duration-200 ease-standard lg:static lg:transform-none',
          showsDemoChrome ? 'top-8 bottom-0 z-[70]' : 'inset-y-0',
          isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        <button
          type="button"
          onClick={() => setIsMobileSidebarOpen(false)}
          className="absolute right-2 top-3 z-50 flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-surface-2 hover:text-foreground lg:hidden"
          aria-label={t('shell.closeMenu')}
        >
          <X className="h-4 w-4" />
        </button>
        <Sidebar />
      </div>

      <main
        id="main-content"
        className={cn(
          'relative flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4 pt-[4.5rem] lg:px-6',
          isServerWorkspace ? 'pb-3 lg:pb-3 lg:pt-3' : 'lg:pb-6 lg:pt-4',
        )}
      >
        <div
          className={cn(
            'mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col',
            isServerWorkspace ? 'gap-2' : 'gap-3',
          )}
        >
          {/* Marquee — the cabinet gesture: wayfinding, fleet health, search */}
          <header className="flex items-center justify-between gap-3 border-b border-border/60 pb-2">
            <div className="flex min-w-0 items-center gap-3">
              <span className="deck-hatch hidden h-4 w-1 lg:block" aria-hidden />
              <Breadcrumbs />
            </div>
            <div className="flex items-center gap-2">
              <FleetHeartbeat />
              <button
                type="button"
                onClick={() => setIsSearchOpen(true)}
                className="hidden h-8 min-w-48 items-center gap-2 rounded-sm border border-border/70 bg-card px-3 text-mini text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground lg:flex"
                aria-label={t('shell.openSearch', { shortcut })}
              >
                <Search className="h-3.5 w-3.5" />
                <span className="flex-1 text-left">{t('shell.searchButton')}</span>
                <kbd className="hidden rounded-sm border border-border/70 bg-surface-2/80 px-1.5 py-0.5 font-mono text-micro text-muted-foreground sm:inline-block">
                  {shortcut}
                </kbd>
              </button>
            </div>
          </header>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <Outlet />
          </div>
        </div>
      </main>

      <SearchPalette isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
      <div className="pointer-events-none fixed bottom-4 right-4 z-40 flex flex-col gap-2 lg:bottom-6 lg:right-6">
        <UploadProgressIndicator />
        <DownloadProgressIndicator />
      </div>
    </div>
  );
}

export default AppLayout;
