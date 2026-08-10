import { createFrontendPlugin } from '@/plugins/plugin-definition';
import { AdminDashboard, ServerTab, UserPage } from './components';

export default createFrontendPlugin({
  manifest: {
    name: 'ticketing-plugin',
    version: '3.0.0',
    displayName: 'Ticketing',
    description:
      'Support ticketing with SLA tracking, comments, tags, templates, bulk actions, and real-time updates',
    author: 'Catalyst Team',
  },
  tabs: [
    {
      id: 'ticketing-admin',
      label: 'Tickets',
      icon: 'Ticket',
      component: AdminDashboard,
      location: 'admin',
      order: 40,
      requiredPermissions: ['admin.read'],
    },
    {
      id: 'ticketing-server',
      label: 'Tickets',
      icon: 'Ticket',
      component: ServerTab,
      location: 'server',
      order: 40,
      requiredPermissions: ['server.read'],
    },
  ],
  routes: [
    {
      path: '/ticketing-plugin',
      component: UserPage,
    },
  ],
});
