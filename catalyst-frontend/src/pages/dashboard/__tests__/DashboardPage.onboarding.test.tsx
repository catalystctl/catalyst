import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const permissions = { current: ['server.create'] };
const stats = { current: { servers: 0, serversOnline: 0, nodes: 1, nodesOnline: 1, alertsUnacknowledged: 0 } };

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
  useDashboardActivity: () => ({ data: [], isLoading: false, isError: false }),
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
});
