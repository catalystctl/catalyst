import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const h = vi.hoisted(() => ({ nodes: [] as any[], locations: [] as any[] }));
vi.mock('@/csync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/csync')>()),
  useVirtualizer: ({ count, getItemKey }: any) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: getItemKey(index), start: index * 50 })),
    getTotalSize: () => count * 50,
    measureElement: vi.fn(),
  }),
  useQuery: ({ queryFn }: any) => ({ data: queryFn ? h.locations : { nodes: h.nodes }, isLoading: false, isError: false, refetch: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, values?: any) => values?.count ? `${key}:${values.count}` : key }), Trans: ({ children }: any) => children }));
vi.mock('../../../hooks/useAdmin', () => ({ useAdminNodes: () => ({ data: { nodes: h.nodes }, isLoading: false, isError: false, refetch: vi.fn() }) }));
vi.mock('../../../hooks/useUpdateCheck', () => ({ useUpdateCheck: () => ({ data: undefined }) }));
vi.mock('../../../services/api/locations', () => ({ locationsApi: { list: vi.fn() } }));
vi.mock('../../../services/api/nodes', () => ({ nodesApi: { remove: vi.fn() } }));
vi.mock('../../../components/nodes/LocationsManagerModal', () => ({ default: () => null }));
vi.mock('../../../components/nodes/NodeCreateModal', () => ({ NodeCreateButton: () => null, default: () => null }));
vi.mock('../../../components/shared/ConfirmDialog', () => ({ default: () => null }));
vi.mock('../../../utils/notify', () => ({ notifySuccess: vi.fn(), notifyError: vi.fn() }));
vi.mock('../../../stores/authStore', () => ({ useAuthStore: (select: any) => select({ user: { id: 'admin', permissions: ['*'] } }) }));

import AdminNodesPage from '../NodesPage';

const node = (id: string, locationId: string | null) => ({
  id, name: id, hostname: `${id}.example`, locationId, isOnline: true, maxCpuCores: 4, maxMemoryMb: 2048,
  _count: { servers: 1 },
});

describe('Admin NodesPage virtualized grouped list', () => {
  beforeEach(() => { h.nodes = [node('node-a', 'loc-a'), node('node-b', 'loc-a'), node('node-c', null)]; h.locations = [{ id: 'loc-a', name: 'Primary', description: '' }]; });
  afterEach(() => cleanup());

  it('keeps location headers in the virtualized list and selects a whole group', () => {
    render(<MemoryRouter><AdminNodesPage /></MemoryRouter>);
    expect(screen.getAllByText('Primary').length).toBeGreaterThan(1);
    expect(screen.getAllByText('nodes.unassigned').length).toBeGreaterThan(1);
    const sectionCheckbox = screen.getAllByRole('checkbox').find((checkbox) => checkbox.parentElement?.textContent?.includes('nodes.selectAllInSection'));
    expect(sectionCheckbox).toBeDefined();
    fireEvent.click(sectionCheckbox!);
    expect(screen.getByRole('button', { name: /common:actions.delete/i })).toBeInTheDocument();
    expect(screen.getByText(/nodes.selectedCount/)).toBeInTheDocument();
  });
});
