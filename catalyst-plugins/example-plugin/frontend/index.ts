/**
 * Example Plugin Frontend Entry
 *
 * Uses the in-monorepo SDK factory so the host loader recognizes tabs.
 */

import { createFrontendPlugin } from '@/plugins/plugin-definition';
import { AdminTab, ServerTab } from './components';

export default createFrontendPlugin({
  manifest: {
    name: 'example-plugin',
    version: '1.15.13',
    displayName: 'Example Plugin',
    description: 'Comprehensive showcase of Catalyst plugin capabilities',
    author: 'Catalyst Team',
  },
  tabs: [
    {
      id: 'example-admin',
      label: 'Example Plugin',
      icon: 'Puzzle',
      component: AdminTab,
      location: 'admin',
      order: 100,
      requiredPermissions: ['admin.read'],
    },
    {
      id: 'example-server',
      label: 'Plugin Demo',
      icon: 'Zap',
      component: ServerTab,
      location: 'server',
      order: 100,
      requiredPermissions: ['server.read'],
    },
  ],
});
