/**
 * Auto FastDL — frontend entry.
 * Registers an admin tab for managing pairings and viewing sync status.
 */

import { createFrontendPlugin } from '@/plugins/plugin-definition';
import { FastdlAdminTab } from './components';

export default createFrontendPlugin({
  manifest: {
    name: 'fastdl-sync',
    version: '1.0.0',
    displayName: 'Auto FastDL',
    description: 'Automatic FastDL content sync for HL1/Source game servers',
    author: 'Catalyst Team',
  },
  tabs: [
    {
      id: 'fastdl-admin',
      label: 'Auto FastDL',
      icon: 'Download',
      component: FastdlAdminTab,
      location: 'admin',
      order: 85,
      requiredPermissions: ['admin.read'],
    },
  ],
});
