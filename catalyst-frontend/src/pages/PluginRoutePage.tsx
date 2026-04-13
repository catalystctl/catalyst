import { usePluginRoutes } from '../plugins/hooks';
import { Navigate } from 'react-router-dom';

/**
 * Renders the first plugin page that matches the current route.
 * Used for standalone plugin pages like /tickets that any authenticated user can access.
 */
export default function PluginRoutePage() {
  const routes = usePluginRoutes();
  const first = routes[0];

  if (!first) {
    return <Navigate to="/dashboard" replace />;
  }

  const Component = first.component;
  return <Component />;
}
