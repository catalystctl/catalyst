/**
 * Example Plugin Frontend Entry
 * 
 * This file exports tab configurations that will be registered
 * by the Catalyst frontend plugin system.
 */

import { AdminTab, ServerTab } from './components';

export const tabs = [
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
];

export default tabs;
