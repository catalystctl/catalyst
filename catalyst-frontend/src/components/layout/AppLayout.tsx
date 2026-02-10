import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Breadcrumbs from './Breadcrumbs';
import { useWebSocketConnection } from '../../hooks/useWebSocketConnection';
import { useServerStateUpdates } from '../../hooks/useServerStateUpdates';

function AppLayout() {
  useWebSocketConnection();
  useServerStateUpdates();

  return (
    <div className="app-shell relative flex min-h-screen font-sans">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -left-24 top-12 h-64 w-64 rounded-full bg-primary-500/10 blur-3xl dark:bg-primary-400/10" />
        <div className="absolute right-10 top-1/3 h-72 w-72 rounded-full bg-fuchsia-500/10 blur-3xl dark:bg-fuchsia-400/10" />
        <div className="absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-violet-500/10 blur-3xl dark:bg-violet-400/10" />
        <div className="absolute bottom-10 right-20 h-56 w-56 rounded-full bg-amber-400/10 blur-3xl dark:bg-amber-300/10" />
      </div>
      <Sidebar />
      <main className="flex-1 overflow-y-auto px-6 py-6">
        <div className="space-y-4">
          <Breadcrumbs />
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export default AppLayout;
