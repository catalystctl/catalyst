import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Breadcrumbs from './Breadcrumbs';
import { useWebSocketConnection } from '../../hooks/useWebSocketConnection';
import { useServerStateUpdates } from '../../hooks/useServerStateUpdates';
import { useThemeStore } from '../../stores/themeStore';
import { useCmdK } from '../../hooks/useKeyboardShortcut';
import { Menu, X, Search } from 'lucide-react';
import SearchPalette from '../search/SearchPalette';
import { cn } from '@/lib/utils';

function AppLayout() {
  useWebSocketConnection();
  useServerStateUpdates();
  const { sidebarCollapsed } = useThemeStore();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  useCmdK(() => setIsSearchOpen(true));

  return (
    <div className="app-shell relative flex min-h-screen font-sans">
      {isMobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setIsMobileSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile header */}
      <div className="fixed top-0 left-0 right-0 z-30 flex h-12 items-center justify-between border-b border-border bg-surface-0/90 backdrop-blur-md px-3 lg:hidden">
        <button
          type="button"
          onClick={() => setIsMobileSidebarOpen(true)}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
          aria-label="Toggle menu"
        >
          <Menu className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold text-foreground">Catalyst</span>
        <button
          type="button"
          onClick={() => setIsSearchOpen(true)}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
          aria-label="Search"
        >
          <Search className="h-4 w-4" />
        </button>
      </div>

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 transform transition-all duration-200 ease-out lg:static lg:transform-none',
          isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        <button
          type="button"
          onClick={() => setIsMobileSidebarOpen(false)}
          className="absolute right-2 top-3 z-50 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground lg:hidden"
          aria-label="Close menu"
        >
          <X className="h-4 w-4" />
        </button>
        <Sidebar />
      </aside>

      {/* Main content */}
      <main
        className={cn(
          'flex-1 overflow-y-auto px-4 py-4 pt-14 transition-all duration-200 lg:px-5 lg:py-5 lg:pt-5',
          sidebarCollapsed ? 'lg:pl-3' : 'lg:pl-5',
        )}
      >
        <div className="space-y-3">
          <Breadcrumbs />
          <Outlet />
        </div>
      </main>

      <SearchPalette isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
    </div>
  );
}

export default AppLayout;
