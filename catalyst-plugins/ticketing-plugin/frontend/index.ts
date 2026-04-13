/**
 * Ticketing Plugin Frontend Entry
 *
 * Exports tab configurations for the Catalyst frontend plugin system.
 */

import {
  TicketingAdminTab,
  TicketingServerTab,
} from './components';

export const tabs = [
  {
    id: 'ticketing-admin',
    label: 'Tickets',
    icon: 'Ticket',
    component: TicketingAdminTab,
    location: 'admin',
    order: 50,
    requiredPermissions: ['admin.read'],
  },
  {
    id: 'ticketing-server',
    label: 'Tickets',
    icon: 'Ticket',
    component: TicketingServerTab,
    location: 'server',
    order: 50,
    requiredPermissions: ['server.read'],
  },
];

export default tabs;
