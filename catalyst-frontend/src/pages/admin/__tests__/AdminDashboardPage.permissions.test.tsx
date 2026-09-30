import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../hooks/useAdmin', () => ({
  useAdminStats: () => ({ data: { users: 1, nodes: 0, servers: 0 } }),
  useAdminHealth: () => ({ data: { database: 'connected' }, isLoading: false }),
  useAdminNodes: () => ({ data: { nodes: [] } }),
}));
vi.mock('../../../hooks/useClusterMetrics', () => ({ useClusterMetrics: () => ({ data: undefined, isLoading: false }) }));
vi.mock('../../../components/admin/ClusterResourcesChart', () => ({ ClusterResourcesChart: () => null }));

import { useAuthStore } from '../../../stores/authStore';
import AdminDashboardPage from '../AdminDashboardPage';

afterEach(cleanup);

describe('admin dashboard settings navigation', () => {
  it('hides Settings for admin.read but permits admin.write', () => {
    useAuthStore.setState({ user: { id: 'reader', permissions: ['admin.read'] } as never });
    const view = render(<MemoryRouter><AdminDashboardPage /></MemoryRouter>);
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
    view.unmount();
    useAuthStore.setState({ user: { id: 'writer', permissions: ['admin.write'] } as never });
    render(<MemoryRouter><AdminDashboardPage /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/admin/system');
  });
});
