import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const h = vi.hoisted(() => ({ allocations: [] as any[], pools: [] as any[], bulkDelete: vi.fn() }));
vi.mock('@/csync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/csync')>()),
  useVirtualizer: ({ count, getItemKey }: any) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: getItemKey(index), start: index * 42 })),
    getTotalSize: () => count * 42,
    measureElement: vi.fn(),
  }),
  useQuery: ({ queryKey }: any) => ({ data: String(queryKey).includes('allocations') ? h.allocations : h.pools, isLoading: false }),
  useMutation: () => ({ mutate: h.bulkDelete, isPending: false }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, values?: any) => values?.value ? `${key}:${values.value}` : key }), Trans: ({ children }: any) => children }));
vi.mock('../../../hooks/useNodes', () => ({ useNodes: () => ({ data: [{ id: 'node-1', name: 'Node 1' }] }) }));
vi.mock('../../../services/api/admin', () => ({ adminApi: { listIpPools: vi.fn(), createIpPool: vi.fn(), deleteIpPool: vi.fn() } }));
vi.mock('../../../services/api/nodes', () => ({ nodesApi: { bulkDeleteAllocations: h.bulkDelete } }));
vi.mock('../../../services/api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('../../../utils/notify', () => ({ notifySuccess: vi.fn(), notifyError: vi.fn(), notifyInfo: vi.fn() }));
vi.mock('../../../components/shared/ConfirmDialog', () => ({ default: ({ open, onConfirm }: any) => open ? <button onClick={onConfirm}>confirm</button> : null }));

import NodeAllocationsPage from '../NodeAllocationsPage';

const allocation = (id: string, serverId: string | null = null) => ({ id, nodeId: 'node-1', serverId, ip: '10.0.0.1', port: Number(id.slice(-1)) + 25000, alias: null, notes: null, createdAt: '', updatedAt: '' });

describe('NodeAllocationsPage virtualized selection', () => {
  afterEach(() => { cleanup(); h.allocations = []; h.pools = []; h.bulkDelete.mockReset(); });

  it('renders virtual allocation rows, excludes assigned rows, and selects available rows', () => {
    h.allocations = [allocation('a1'), allocation('a2', 'server-1'), allocation('a3')];
    render(<MemoryRouter initialEntries={['/admin/nodes/node-1/allocations']}><Routes><Route path="/admin/nodes/:nodeId/allocations" element={<NodeAllocationsPage />} /></Routes></MemoryRouter>);
    expect(screen.getAllByText('10.0.0.1')).toHaveLength(3);
    expect(screen.getAllByRole('checkbox').filter((checkbox) => !checkbox.hasAttribute('disabled'))).toHaveLength(4);
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'allocations.selectAll' })[0]);
    expect(screen.getByText('allocations.selectedCount:2')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'common:actions.delete' }).length).toBeGreaterThan(0);
  });
});
