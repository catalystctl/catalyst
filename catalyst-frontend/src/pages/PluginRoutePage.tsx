import { usePluginRoutes } from '../plugins/hooks';
import { useParams, Navigate } from 'react-router-dom';

/**
 * Renders the plugin page that matches the current dynamic route.
 * Used for standalone plugin pages like /ticketing-plugin, /any-plugin, etc.
 * that any authenticated user can access.
 *
 * The URL path segment is matched against plugin route paths.
 * The route param `:pluginRouteName` comes from App.tsx's catch-all route.
 */
export default function PluginRoutePage() {
  const { pluginRouteName } = useParams<{ pluginRouteName: string }>();
  const routes = usePluginRoutes();

  // Match the current path against plugin route paths
  const currentPath = `/${pluginRouteName}`;
  const matched = routes.find((r) => r.path === currentPath);

  if (!matched) {
    return <Navigate to="/dashboard" replace />;
  }

  const Component = matched.component;
  return <Component />;
}
