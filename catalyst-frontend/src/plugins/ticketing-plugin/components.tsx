// src/plugins/ticketing-plugin/components.tsx
// Re-export facade — this is what the plugin loader imports.

export { AdminDashboard as AdminTab } from './components/admin/AdminDashboard';

/**
 * ServerTab: Filtered ticket view for a specific server.
 * Shows only tickets linked to the given server.
 */
export { ServerTab } from './components/admin/ServerTab';

/**
 * UserPage: Simplified "My Tickets" view.
 * Filters to tickets where the current user is assignee or reporter.
 */
export { UserPage } from './components/admin/UserPage';
