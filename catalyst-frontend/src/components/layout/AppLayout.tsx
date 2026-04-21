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

function AppLayout() {
  useServerStateUpdates();
  useSseAdminEvents();
  useProfileSync();
  const { sidebarCollapsed } = useThemeStore();
  const { panelName } = usePanelBranding();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  useCmdK(() => setIsSearchOpen(true));

  return (
    <div className="app-shell relative flex min-h-screen font-sans">
      {/* Ambient glow - subtle background depth */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -left-24 top-12 h-64 w-64 rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute right-10 top-1/3 h-72 w-72 rounded-full bg-primary/3 blur-3xl" />
      </div>

      {/* Mobile overlay */}
      {isMobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={() => setIsMobileSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile header */}
      <div className="fixed top-0 left-0 right-0 z-30 flex items-center justify-between border-b border-zinc-200 bg-white/80 px-4 py-3 backdrop-blur-md dark:border-zinc-800 dark:bg-surface-0/80 lg:hidden">
        <button
          type="button"
          onClick={() => setIsMobileSidebarOpen(true)}
          className="rounded-lg p-2 text-zinc-600 transition-colors hover:bg-surface-2 dark:text-zinc-400 dark:hover:bg-surface-2"
          aria-label="Toggle menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="font-display text-lg font-semibold text-zinc-900 dark:text-zinc-100">{panelName}</span>
        <button
          type="button"
          onClick={() => setIsSearchOpen(true)}
          className="rounded-lg p-2 text-zinc-600 transition-colors hover:bg-surface-2 dark:text-zinc-400 dark:hover:bg-surface-2"
          aria-label="Search"
        >
          <Search className="h-5 w-5" />
        </button>
      </div>

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 transform transition-all duration-300 ease-in-out lg:static lg:transform-none',
          isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        <button
          type="button"
          onClick={() => setIsMobileSidebarOpen(false)}
          className="absolute right-2 top-4 z-50 rounded-lg p-2 text-zinc-600 hover:bg-surface-2 lg:hidden dark:text-zinc-400 dark:hover:bg-surface-2"
          aria-label="Close menu"
        >
          <X className="h-5 w-5" />
        </button>
        <Sidebar />
      </aside>

      {/* Main content */}
      <main
        className={cn(
          'flex-1 overflow-y-auto px-4 py-4 pt-16 transition-all duration-300 lg:px-6 lg:py-6 lg:pt-6',
          sidebarCollapsed ? 'lg:pl-4' : 'lg:pl-6',
        )}
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Breadcrumbs />
            <button
              type="button"
              onClick={() => setIsSearchOpen(true)}
              className="hidden items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-400 shadow-sm transition-all duration-200 hover:border-zinc-300 hover:text-zinc-600 dark:border-zinc-800 dark:bg-surface-1 dark:text-zinc-500 dark:hover:border-zinc-700 dark:hover:text-zinc-300 lg:flex"
              aria-label="Open search (⌘K)"
            >
              <Search className="h-3.5 w-3.5" />
              <span>Search</span>
              <kbd className="hidden rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 sm:inline-block dark:border-zinc-700 dark:bg-surface-2 dark:text-zinc-500">⌘K</kbd>
            </button>
          </div>
          <Outlet />
        </div>
      </main>

      <SearchPalette isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
    </div>
  );
}

export default AppLayout;
