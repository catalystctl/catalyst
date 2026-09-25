import { useEffect } from 'react';
import { usePluginRoutes } from '../plugins/hooks';
import { usePluginContext } from '../plugins/usePluginContext';
import { useParams, Navigate } from 'react-router-dom';
import PluginErrorBoundary from '../plugins/PluginErrorBoundary';
import { useAuthStore } from '../stores/authStore';
import { hasAnyPermission } from '../components/auth/ProtectedRoute';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import NotFoundPage from './NotFoundPage';

/**
 * Renders the plugin page that matches the current dynamic route.
 * Used for standalone plugin pages like /ticketing-plugin, /any-plugin, etc.
 * that any authenticated user can access.
 *
 * The URL path segment is matched against plugin route paths.
 * The route param `:pluginRouteName` comes from App.tsx's catch-all route.
 *
 * Waits for plugins to finish loading before rendering the not-found page on a
 * miss, and enforces each route's requiredPermissions when present.
 */
export default function PluginRoutePage() {
  const { pluginRouteName } = useParams<{ pluginRouteName: string }>();
  const { reloadPlugins, initialized, loading } = usePluginContext();
  const routes = usePluginRoutes();
  const userPermissions = useAuthStore((s) => s.user?.permissions);

  useEffect(() => {
    if (!initialized && !loading) {
      reloadPlugins();
    }
  }, [initialized, loading, reloadPlugins]);

  // Wait until plugins have been loaded at least once before deciding 404
  if (!initialized || loading) {
    return (
      <div className="deck-panel flex items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  const currentPath = `/${pluginRouteName}`;
  const matched = routes.find((r) => r.path === currentPath);

  if (!matched) {
    return <NotFoundPage />;
  }

  if (
    matched.requiredPermissions &&
    matched.requiredPermissions.length > 0 &&
    !hasAnyPermission(userPermissions, matched.requiredPermissions)
  ) {
    return <Navigate to="/dashboard" replace />;
  }

  const Component = matched.component;
  return (
    <PluginErrorBoundary pluginName={matched.path}>
      <div className="flex min-h-0 flex-1 flex-col">
        <Component />
      </div>
    </PluginErrorBoundary>
  );
}
