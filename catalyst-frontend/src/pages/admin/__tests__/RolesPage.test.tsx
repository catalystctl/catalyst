import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/** Roles the mocked list query returns; mutated per test. */
let roles: unknown[] = [];

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('@/csync', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = String(queryKey?.[0] ?? '');
    if (key === 'admin-roles') return { data: roles, isLoading: false };
    if (key === 'role-presets') return { data: [] };
    return { data: undefined };
  },
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/useStreamAwareInterval', () => ({ useStreamAwareInterval: () => undefined }));
vi.mock('@/lib/queryClient', () => ({ queryClient: { invalidateQueries: vi.fn() } }));
vi.mock('@/services/api/roles', () => ({
  rolesApi: { list: vi.fn(), get: vi.fn(), getPresets: vi.fn(), getPermissionCatalog: vi.fn() },
}));
vi.mock('@/lib/serverPermissions', () => ({ useServerPermissionOptions: () => ({ data: [] }) }));
vi.mock('@/services/api/servers', () => ({ serversApi: { list: vi.fn() } }));
vi.mock('@/hooks/useNodes', () => ({ useNodes: () => ({ data: [] }) }));
vi.mock('@/components/shared/LastUpdated', () => ({ default: () => null }));

import RolesPage from '../RolesPage';

afterEach(() => {
  cleanup();
  roles = [];
});

const makeRole = (over: Record<string, unknown> = {}) => ({
  id: 'role-1',
  name: 'Game Operations',
  description: 'Runs the servers',
  permissions: ['server.read', 'server.start'],
  userCount: 0,
  nodeGrantCount: 0,
  serverGrantCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('RolesPage', () => {
  it('offers the create action from the header and the empty state', () => {
    render(<RolesPage />);
    expect(screen.getByText('roles.emptyTitle')).toBeInTheDocument();
    // Header action plus the empty state's action.
    expect(screen.getAllByRole('button', { name: /roles\.createTitle/ })).toHaveLength(2);
  });

  it('renders one row per role and hides the empty state', () => {
    roles = [makeRole(), makeRole({ id: 'role-2', name: 'Support', permissions: ['server.read'] })];
    render(<RolesPage />);

    expect(screen.queryByText('roles.emptyTitle')).toBeNull();
    expect(screen.getByText('Game Operations')).toBeInTheDocument();
    expect(screen.getByText('Support')).toBeInTheDocument();
    // Only the header action remains once rows exist.
    expect(screen.getAllByRole('button', { name: /roles\.createTitle/ })).toHaveLength(1);
  });

  it('flags a wildcard role as full admin', () => {
    roles = [makeRole({ name: 'Administrator', permissions: ['*'] })];
    render(<RolesPage />);
    expect(screen.getByText('roles.cardFullAdmin')).toBeInTheDocument();
  });
});
