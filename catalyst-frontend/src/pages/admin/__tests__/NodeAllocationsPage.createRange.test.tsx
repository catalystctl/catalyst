/**
 * Node allocations — add-range modal and row actions (audit D17).
 *
 * The modal used to open blank and offer a fixed 25565-25664 quick fill even
 * when those ports were taken, and deleting a free allocation was one
 * unguarded click. Pins:
 *  - the IP field is prefilled from the node's public address (0.0.0.0 if the
 *    node has none) as soon as the modal opens,
 *  - "next N free ports" skips ports already allocated on that IP,
 *  - a free row's delete asks for confirmation before deleting,
 *  - the row exposes a copy-address action,
 *  - IP-pool create/delete invalidates the node list keys (pool counts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const h = vi.hoisted(() => ({
  allocations: [] as any[],
  pools: [] as any[],
  invalidated: [] as any[],
  createPool: vi.fn(),
  deletePool: vi.fn(),
  deleteAllocation: vi.fn(),
}));

vi.mock('@/csync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/csync')>()),
  useVirtualizer: ({ count, getItemKey }: any) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ index, key: getItemKey(index), start: index * 42 })),
    getTotalSize: () => count * 42,
    measureElement: vi.fn(),
  }),
  useQuery: ({ queryKey }: any) => ({
    data: String(queryKey).includes('ip-pools') ? h.pools : h.allocations,
    isLoading: false,
  }),
  useMutation: (options: any) => ({
    mutate: (vars: any, opts?: any) => {
      // Route the mutation through the caller's hooks so the test can assert
      // side effects (invalidation) instead of mocking each one separately.
      const result = options.mutationFn ? options.mutationFn(vars) : undefined;
      options.onSuccess?.(result);
      opts?.onSuccess?.(result);
      options.onSettled?.();
    },
    isPending: false,
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: any) =>
      values && typeof values === 'object' && 'count' in values
        ? `${key}#${values.count}`
        : key,
    i18n: { language: 'en' },
  }),
  Trans: ({ children }: any) => children,
}));

vi.mock('../../../../src/hooks/useNodes', () => ({
  useNodes: () => ({
    data: [{ id: 'node-1', name: 'Node 1', publicAddress: '10.9.9.9' }],
  }),
}));

vi.mock('../../../../src/services/api/admin', () => ({
  adminApi: {
    listIpPools: vi.fn().mockResolvedValue([]),
    createIpPool: h.createPool,
    deleteIpPool: h.deletePool,
  },
}));

vi.mock('../../../../src/services/api/nodes', () => ({
  nodesApi: { bulkDeleteAllocations: vi.fn() },
}));

vi.mock('../../../../src/services/api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    delete: h.deleteAllocation,
  },
}));

vi.mock('../../../../src/utils/notify', () => ({
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
  notifyInfo: vi.fn(),
}));

// Real ConfirmDialog: the confirmation flow is what this test is about.

import NodeAllocationsPage from '../NodeAllocationsPage';
import { queryClient } from '@/lib/queryClient';

const allocation = (id: string, ip: string, port: number, serverId: string | null = null) => ({
  id,
  nodeId: 'node-1',
  serverId,
  ip,
  port,
  alias: null,
  notes: null,
  createdAt: '',
  updatedAt: '',
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/admin/nodes/node-1/allocations']}>
      <Routes>
        <Route path="/admin/nodes/:nodeId/allocations" element={<NodeAllocationsPage />} />
      </Routes>
    </MemoryRouter>,
  );

const openCreateModal = () => {
  fireEvent.click(screen.getByText('allocations.createAllocations'));
};

describe('NodeAllocationsPage add-range modal and row safety', () => {
  beforeEach(() => {
    h.invalidated = [];
    h.allocations = [];
    h.pools = [];
    h.deleteAllocation.mockReset();
    // Capture invalidations instead of leaving the real cache in play.
    vi.spyOn(queryClient, 'invalidateQueries').mockImplementation((async (filters: any) => {
      h.invalidated.push(filters?.queryKey);
    }) as any);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('prefills the IP from the node public address when the modal opens', () => {
    renderPage();
    openCreateModal();
    const ipInput = screen.getByPlaceholderText('allocations.createPort.ipPlaceholder');
    expect(ipInput).toHaveValue('10.9.9.9');
  });

  it('offers the next free ports instead of a fixed block', () => {
    // 25565 and 25566 are already taken on this IP.
    h.allocations = [
      allocation('a1', '10.9.9.9', 25565),
      allocation('a2', '10.9.9.9', 25566),
    ];
    renderPage();
    openCreateModal();
    fireEvent.click(screen.getByRole('button', { name: 'allocations.createPort.nextFree#1' }));
    expect(screen.getByPlaceholderText('allocations.createPort.portsPlaceholder')).toHaveValue('25567');
  });

  it('skips ports taken on the prefilled IP but keeps ports free on another IP', () => {
    h.allocations = [allocation('a1', '192.168.5.5', 25565)];
    renderPage();
    openCreateModal();
    fireEvent.click(screen.getByRole('button', { name: 'allocations.createPort.nextFree#1' }));
    // 25565 is free for 10.9.9.9 even though another IP holds it.
    expect(screen.getByPlaceholderText('allocations.createPort.portsPlaceholder')).toHaveValue('25565');
  });

  it('confirms before deleting a free allocation', async () => {
    h.allocations = [allocation('a1', '10.9.9.9', 25565)];
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'common:actions.delete' }));
    // The dialog is open and nothing has been deleted yet.
    expect(screen.getByText('allocations.deleteTitle')).toBeInTheDocument();
    expect(h.deleteAllocation).not.toHaveBeenCalled();
    const confirm = screen.getAllByRole('button', { name: 'common:actions.delete' });
    fireEvent.click(confirm[confirm.length - 1]);
    await waitFor(() => expect(h.deleteAllocation).toHaveBeenCalledTimes(1));
    expect(h.deleteAllocation.mock.calls[0][0]).toContain('/api/nodes/node-1/allocations/a1');
  });

  it('never renders a delete action for an assigned allocation', () => {
    h.allocations = [allocation('a1', '10.9.9.9', 25565, 'server-1')];
    renderPage();
    expect(screen.queryByRole('button', { name: 'common:actions.delete' })).not.toBeInTheDocument();
  });

  it('exposes a copy-address action for every row', () => {
    h.allocations = [allocation('a1', '10.9.9.9', 25565)];
    renderPage();
    expect(
      screen.getByRole('button', { name: /allocations\.copyAddress/ }),
    ).toBeInTheDocument();
  });

  it('invalidates the node list keys when an IP pool is deleted', async () => {
    h.pools = [
      {
        id: 'pool-1',
        nodeId: 'node-1',
        nodeName: 'Node 1',
        networkName: 'mc-lan',
        cidr: '10.9.9.0/24',
        gateway: '10.9.9.1',
        rangeStart: '10.9.9.10',
        rangeEnd: '10.9.9.250',
        total: 240,
        availableCount: 240,
        usedCount: 0,
        reservedCount: 0,
      },
    ];
    renderPage();
    fireEvent.click(screen.getByText('allocations.tabs.ips'));
    fireEvent.click(screen.getByRole('button', { name: 'common:actions.delete' }));
    await waitFor(() =>
      expect(h.invalidated.some((key) => JSON.stringify(key) === '["admin-nodes"]')).toBe(true),
    );
    expect(h.invalidated.some((key) => JSON.stringify(key) === '["nodes"]')).toBe(true);
  });
});
