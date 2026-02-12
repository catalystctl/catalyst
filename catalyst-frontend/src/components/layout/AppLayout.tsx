import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Breadcrumbs from './Breadcrumbs';
import { useWebSocketConnection } from '../../hooks/useWebSocketConnection';
import { useServerStateUpdates } from '../../hooks/useServerStateUpdates';
import { useThemeStore } from '../../stores/themeStore';
import { Menu, X } from 'lucide-react';

function AppLayout() {
  useWebSocketConnection();
  useServerStateUpdates();
  const { sidebarCollapsed, toggleSidebar } = useThemeStore();

  // On mobile: sidebarCollapsed=false means sidebar is open (showing)
  // On desktop: sidebarCollapsed=false means sidebar is expanded (normal width)

  // For mobile, we want the sidebar to slide in when NOT collapsed
  const isMobileSidebarOpen = !sidebarCollapsed;

  return (
    <div className="app-shell relative flex min-h-screen font-sans">
      {/* Background decorations */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -left-24 top-12 h-64 w-64 rounded-full bg-primary-500/10 blur-3xl dark:bg-primary-400/10" />
        <div className="absolute right-10 top-1/3 h-72 w-72 rounded-full bg-fuchsia-500/10 blur-3xl dark:bg-fuchsia-400/10" />
        <div className="absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-violet-500/10 blur-3xl dark:bg-violet-400/10" />
        <div className="absolute bottom-10 right-20 h-56 w-56 rounded-full bg-amber-400/10 blur-3xl dark:bg-amber-300/10" />
      </div>

      {/* Mobile overlay */}
      {isMobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={toggleSidebar}
          aria-hidden="true"
        />
      )}

      {/* Mobile header with hamburger */}
      <div className="fixed top-0 left-0 right-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden dark:border-slate-800 dark:bg-slate-900">
        <button
          type="button"
          onClick={toggleSidebar}
          className="rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          aria-label="Toggle menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="text-lg font-semibold text-slate-900 dark:text-white">Catalyst</span>
        <div className="w-9" /> {/* Spacer for centering */}
      </div>

      {/* Sidebar - responsive */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-300 ease-in-out
          lg:static lg:transform-none
          ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Mobile close button */}
        <button
          type="button"
          onClick={toggleSidebar}
          className="absolute right-2 top-4 z-50 rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden dark:text-slate-300 dark:hover:bg-slate-800"
          aria-label="Close menu"
        >
          <X className="h-5 w-5" />
        </button>
        <Sidebar />
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto px-4 py-4 pt-16 lg:px-6 lg:py-6 lg:pt-6">
        <div className="space-y-4">
          <Breadcrumbs />
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export default AppLayout;
