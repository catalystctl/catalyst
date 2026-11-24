import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const permissions = { current: ['server.create'] };
const stats = { current: { servers: 0, serversOnline: 0, nodes: 1, nodesOnline: 1, alertsUnacknowledged: 0 } };
const activity = { current: [] as unknown[] };

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-router-dom', () => ({
  // Mirror Link's DOM contract closely enough for role/href queries.
  Link: ({ children, to, ...rest }: { children?: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>{children}</a>
  ),
}));
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (select: (state: { user: { id: string; username: string; permissions: string[] } }) => unknown) =>
    select({ user: { id: 'user-1', username: 'admin', permissions: permissions.current } }),
}));
vi.mock('../../../hooks/useDashboard', () => ({
  useDashboardStats: () => ({ data: stats.current, isLoading: false, isError: false }),
  useDashboardActivity: () => ({ data: activity.current, isLoading: false, isError: false }),
  useResourceStats: () => ({ data: undefined, isError: false }),
}));
vi.mock('../../../hooks/useServers', () => ({ useServers: () => ({ data: [] }) }));
vi.mock('../../../plugins/PluginSlot', () => ({ PluginSlot: () => null }));

import DashboardPage from '../DashboardPage';

describe('DashboardPage first-run onboarding', () => {
  afterEach(cleanup);

  it('offers the create-server path to a user who can create servers', () => {
    permissions.current = ['server.create'];
    stats.current = { servers: 0, serversOnline: 0, nodes: 1, nodesOnline: 1, alertsUnacknowledged: 0 };
    render(<DashboardPage />);
    expect(screen.getByText('onboarding.title')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'onboarding.createServer' })).toHaveAttribute('href', '/servers?action=create');
    // Node setup is not offered without node.create.
    expect(screen.queryByRole('link', { name: 'onboarding.addNode' })).not.toBeInTheDocument();
  });

  it('offers node setup to an infrastructure admin and hides the checklist once servers exist', () => {
    permissions.current = ['node.create', 'template.create'];
    stats.current = { servers: 0, serversOnline: 0, nodes: 0, nodesOnline: 0, alertsUnacknowledged: 0 };
    const { unmount } = render(<DashboardPage />);
    expect(screen.getByRole('link', { name: 'onboarding.addNode' })).toHaveAttribute('href', '/admin/nodes');
    expect(screen.getByRole('link', { name: 'onboarding.browseServers' })).toBeInTheDocument();
    unmount();

    stats.current = { servers: 3, serversOnline: 2, nodes: 1, nodesOnline: 1, alertsUnacknowledged: 0 };
    render(<DashboardPage />);
    expect(screen.queryByText('onboarding.title')).not.toBeInTheDocument();
  });

  it('shows quick actions once the fleet exists and a user can act', () => {
    permissions.current = ['server.create', 'admin.read'];
    stats.current = { servers: 2, serversOnline: 2, nodes: 1, nodesOnline: 1, alertsUnacknowledged: 0 };
    render(<DashboardPage />);
    expect(screen.getByRole('link', { name: 'quickActions.newServer' })).toHaveAttribute('href', '/servers?action=create');
    expect(screen.getByRole('link', { name: 'quickActions.viewAlerts' })).toHaveAttribute('href', '/admin/alerts');
  });

  it('links the unacknowledged-alert pill to the alert queue for admins', () => {
    permissions.current = ['admin.read'];
    stats.current = { servers: 4, serversOnline: 3, nodes: 1, nodesOnline: 1, alertsUnacknowledged: 2 };
    render(<DashboardPage />);
    expect(screen.getByRole('link', { name: /pendingAlerts/ })).toHaveAttribute('href', '/admin/alerts');
  });
});

describe('DashboardPage recent activity', () => {
  afterEach(cleanup);

  it('renders a stored audit blob as a human summary, never as JSON', () => {
    permissions.current = ['admin.read'];
    stats.current = { servers: 1, serversOnline: 1, nodes: 1, nodesOnline: 1, alertsUnacknowledged: 0 };
    activity.current = [
      {
        id: 'log-1',
        title: 'Theme Settings Update',
        detail:
          '{"ip":"127.0.0.1","_meta":{"action":"theme_settings.update","resource":"server","resourceId":"srv_abcdef123456"},"_actor":{"username":"toil"}}',
        time: '2m ago',
        timestamp: new Date().toISOString(),
        type: 'server',
      },
    ];
    render(<DashboardPage />);

    // The action label and the actor/resource replace the blob.
    expect(screen.getByText('admin-access:audit.actions.themeSettingsUpdate')).toBeInTheDocument();
    expect(screen.getByText(/activity\.byActor/)).toBeInTheDocument();
    expect(screen.queryByText(/"_meta"/)).not.toBeInTheDocument();
    expect(screen.queryByText(/127\.0\.0\.1/)).not.toBeInTheDocument();
    // Admins land on the audit trail from the row.
    expect(screen.getByRole('link', { name: /themeSettingsUpdate/ })).toHaveAttribute('href', '/admin/audit-logs');
  });

  it('keeps a plain-text detail and does not link non-admins anywhere', () => {
    permissions.current = ['server.read'];
    stats.current = { servers: 1, serversOnline: 1, nodes: 1, nodesOnline: 1, alertsUnacknowledged: 0 };
    activity.current = [
      { id: 'log-2', title: 'Server started', detail: 'Survival · toil', time: '5m ago', type: 'server' },
    ];
    render(<DashboardPage />);

    expect(screen.getByText('Survival · toil')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Server started/ })).not.toBeInTheDocument();
    activity.current = [];
  });
});