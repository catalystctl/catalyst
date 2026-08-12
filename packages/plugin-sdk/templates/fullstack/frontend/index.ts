import { createFrontendPlugin } from '@catalyst/plugin-sdk/frontend';
import { AdminTab, ServerTab } from './components';

export default createFrontendPlugin({
  manifest: {
    name: '{{name}}',
    version: '1.0.0',
    displayName: '{{displayName}}',
    description: '{{description}}',
    author: '{{author}}',
  },
  tabs: [
    {
      id: '{{name}}-admin',
      label: '{{displayName}}',
      component: AdminTab,
      location: 'admin',
      order: 100,
      requiredPermissions: ['admin.read'],
    },
    {
      id: '{{name}}-server',
      label: '{{displayName}}',
      component: ServerTab,
      location: 'server',
      order: 100,
      requiredPermissions: ['server.read'],
    },
  ],
});
