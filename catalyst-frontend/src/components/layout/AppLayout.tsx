import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Breadcrumbs from './Breadcrumbs';
import { useServerStateUpdates } from '../../hooks/useServerStateUpdates';
import { useSseAdminEvents } from '../../hooks/useSseAdminEvents';
import { useProfileSync } from '../../hooks/useProfileSync';
import { usePanelBranding } from '../../hooks/usePanelBranding';
import { useCmdK } from '../../hooks/useKeyboardShortcut';
import { Menu, X, Search } from 'lucide-react';
import SearchPalette from '../search/SearchPalette';
import { cn } from '@/lib/utils';
import UpdateNotification from '../shared/UpdateNotification';

function AppLayout() {
  useServerStateUpdates();
  useSseAdminEvents();
  useProfileSync();
  const { panelName } = usePanelBranding();
  const { pathname } = useLocation();
  const isServerWorkspace = /^\/servers\/[^/]+/.test(pathname);

  const shortcut = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘K' : 'Ctrl+K';
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  useCmdK(() => setIsSearchOpen(true));

  useEffect(() => setIsMobileSidebarOpen(false), [pathname]);
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setIsMobileSidebarOpen(false); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, []);

  return (
    <div className="app-shell flex h-[100dvh] font-sans">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:m-2 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-foreground">Skip to content</a>
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
      <div className="fixed top-0 left-0 right-0 z-30 flex h-12 items-center justify-between border-b border-border/70 bg-card px-3 shadow-panel lg:hidden">
        <button
          type="button"
          onClick={() => setIsMobileSidebarOpen(true)}
          className="pressable flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground"
          aria-label="Open menu"
          aria-expanded={isMobileSidebarOpen}
          aria-controls="mobile-sidebar"
        >
          <Menu className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold tracking-tight text-foreground">
          {panelName}
        </span>
        <button
          type="button"
          onClick={() => setIsSearchOpen(true)}
          className="pressable flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground"
          aria-label="Search"
        >
          <Search className="h-4 w-4" />
        </button>
      </div>

      {/* Sidebar */}
      <div
        id="mobile-sidebar"
        className={cn(
          'fixed inset-y-0 left-0 z-50 transform transition-transform duration-200 ease-standard lg:static lg:transform-none',
          isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        <button
          type="button"
          onClick={() => setIsMobileSidebarOpen(false)}
          className="pressable absolute right-2 top-3 z-50 flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground lg:hidden"
          aria-label="Close menu"
        >
          <X className="h-4 w-4" />
        </button>
        <Sidebar />
      </div>

      <main
        id="main-content"
        className={cn(
          'relative flex min-h-0 flex-1 flex-col overflow-hidden px-4 pt-[4.5rem] lg:px-6',
          isServerWorkspace ? 'py-3 lg:pt-3' : 'py-4 lg:py-6 lg:pt-6',
        )}
      >
        <div
          className={cn(
            'mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col',
            isServerWorkspace ? 'gap-2' : 'gap-4',
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <Breadcrumbs />
            <button
              type="button"
              onClick={() => setIsSearchOpen(true)}
              className="pressable hidden min-w-[200px] items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-panel hover:border-primary/25 hover:text-foreground lg:flex"
              aria-label={`Open search (${shortcut})`}
            >
              <Search className="h-3.5 w-3.5" />
              <span className="flex-1 text-left">Search…</span>
              <kbd className="hidden rounded-md border border-border bg-surface-2/80 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-block">
                {shortcut}
              </kbd>
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <Outlet />
          </div>
        </div>
      </main>


      <SearchPalette isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
    </div>
  );
}

export default AppLayout;
