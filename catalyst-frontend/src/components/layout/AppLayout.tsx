import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Breadcrumbs from './Breadcrumbs';
import { useServerStateUpdates } from '../../hooks/useServerStateUpdates';
import { useSseAdminEvents } from '../../hooks/useSseAdminEvents';
import { useProfileSync } from '../../hooks/useProfileSync';
import { useThemeStore } from '../../stores/themeStore';
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
  const sidebarCollapsed = useThemeStore((s) => s.sidebarCollapsed);
  const { panelName } = usePanelBranding();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  useCmdK(() => setIsSearchOpen(true));

  return (
    <div className="app-shell flex h-[100dvh] font-sans">
      <UpdateNotification />
      {/* Mobile overlay */}
      {isMobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-surface-0/60 backdrop-blur-sm lg:hidden"
          onClick={() => setIsMobileSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile header */}
      <div className="fixed top-0 left-0 right-0 z-30 flex h-14 items-center justify-between border-b border-border/80 bg-card/85 px-4 shadow-panel backdrop-blur-xl lg:hidden">
        <button
          type="button"
          onClick={() => setIsMobileSidebarOpen(true)}
          className="pressable flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="font-display text-base font-semibold tracking-tight text-foreground">
          {panelName}
        </span>
        <button
          type="button"
          onClick={() => setIsSearchOpen(true)}
          className="pressable flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground"
          aria-label="Search"
        >
          <Search className="h-5 w-5" />
        </button>
      </div>

      {/* Sidebar */}
      <aside
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
      </aside>

      {/* Main content */}
      <main
        className={cn(
          'relative flex flex-1 flex-col overflow-y-auto px-4 py-4 pt-[4.5rem] transition-all duration-200 ease-standard lg:px-7 lg:py-6 lg:pt-6',
          sidebarCollapsed ? 'lg:pl-5' : 'lg:pl-7',
        )}
      >
        <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col gap-5">
          <div className="flex items-center justify-between gap-3">
            <Breadcrumbs />
            <button
              type="button"
              onClick={() => setIsSearchOpen(true)}
              className="pressable hidden items-center gap-2 rounded-lg border border-border/80 bg-card/80 px-3 py-1.5 text-xs text-muted-foreground shadow-panel backdrop-blur-sm hover:border-primary/25 hover:text-foreground lg:flex"
              aria-label="Open search (⌘K)"
            >
              <Search className="h-3.5 w-3.5" />
              <span>Search</span>
              <kbd className="hidden rounded-md border border-border bg-surface-2/80 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-block">
                ⌘K
              </kbd>
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col animate-fade-up">
            <Outlet />
          </div>
        </div>
      </main>

      <SearchPalette isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
    </div>
  );
}

export default AppLayout;
