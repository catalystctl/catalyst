import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const h = vi.hoisted(() => ({
  nodes: [] as Array<Record<string, unknown>>,
  isError: false,
  refetch: vi.fn(),
  remove: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../../hooks/useAdmin', () => ({
  useAdminNodes: () => ({ data: h.isError ? undefined : { nodes: h.nodes }, isLoading: false, isError: h.isError, refetch: h.refetch }),
}));
vi.mock('../../../hooks/useUpdateCheck', () => ({ useUpdateCheck: () => ({ data: undefined }) }));
vi.mock('../../../services/api/locations', () => ({ locationsApi: { list: vi.fn().mockResolvedValue([]) } }));
vi.mock('../../../services/api/nodes', () => ({ nodesApi: { remove: h.remove } }));
vi.mock('../../../components/nodes/LocationsManagerModal', () => ({ default: () => null }));
vi.mock('../../../components/nodes/NodeCreateModal', () => ({
  default: () => <button>Register Node</button>,
  NodeCreateButton: () => <button>Register Node</button>,
}));
vi.mock('../../../components/shared/ConfirmDialog', () => ({
  default: ({ open, onConfirm }: { open: boolean; onConfirm: () => void }) =>
    open ? <div role="dialog"><button onClick={onConfirm}>Confirm removal</button></div> : null,
}));
vi.mock('../../../utils/notify', () => ({ notifySuccess: h.success, notifyError: h.error }));

import { queryClient } from '../../../lib/queryClient';
import { QueryClientProvider } from '../../../csync';
import { useAuthStore } from '../../../stores/authStore';
import AdminNodesPage from '../NodesPage';

const node = (id: string) => ({
  id, name: id, hostname: `${id}.example`, isOnline: false, maxCpuCores: 1,
  maxMemoryMb: 1024, _count: { servers: 0 },
});

function page() {
  return render(<MemoryRouter><QueryClientProvider client={queryClient}><AdminNodesPage /></QueryClientProvider></MemoryRouter>);
}

describe('Admin nodes list access and failures', () => {
  beforeEach(() => {
    h.nodes = [];
    h.isError = false;
    h.remove.mockReset();
    h.refetch.mockReset();
    h.success.mockReset();
    h.error.mockReset();
    queryClient.clear();
  });
  afterEach(() => { cleanup(); queryClient.clear(); vi.unstubAllGlobals(); });

  it('gates create/delete independently of admin.write while retaining location management', () => {
    h.nodes = [node('node-1')];
    useAuthStore.setState({ user: { id: 'admin', permissions: ['admin.write'] } as never });
    const view = page();
    expect(screen.queryByRole('button', { name: 'Register Node' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Locations' })).toBeInTheDocument();
    expect(within(screen.getByRole('row')).queryByRole('checkbox')).not.toBeInTheDocument();

    act(() => useAuthStore.setState({ user: { id: 'creator', permissions: ['node.create'] } as never }));
    view.rerender(<MemoryRouter><QueryClientProvider client={queryClient}><AdminNodesPage /></QueryClientProvider></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Register Node' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Locations' })).not.toBeInTheDocument();
  });

  it('shows retry instead of an empty state after a failed node fetch', () => {
    h.isError = true;
    useAuthStore.setState({ user: { id: 'admin', permissions: ['*'] } as never });
    page();
    expect(screen.queryByText('No nodes')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.refetch).toHaveBeenCalledOnce();
  });

  it('does not offer delete on nodes outside a node.delete holder’s assignments', async () => {
    h.nodes = [node('node-1'), node('node-2')];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [node('node-2')] }) }));
    useAuthStore.setState({ user: { id: 'deleter', permissions: ['node.delete'] } as never });
    page();
    const rows = screen.getAllByRole('row');
    await waitFor(() => expect(within(rows[1]).getByRole('checkbox')).toBeInTheDocument());
    expect(within(rows[0]).queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('reports successful and failed deletions separately and retains failed selection', async () => {
    h.nodes = [node('node-1'), node('node-2')];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: h.nodes }) }));
    h.remove.mockImplementation((id: string) => id === 'node-2' ? Promise.reject(new Error('blocked')) : Promise.resolve());
    useAuthStore.setState({ user: { id: 'deleter', permissions: ['node.delete'] } as never });
    page();
    const rows = screen.getAllByRole('row');
    await waitFor(() => expect(within(rows[0]).getByRole('checkbox')).toBeInTheDocument());
    rows.forEach((row) => fireEvent.click(within(row).getByRole('checkbox')));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm removal' }));
    await waitFor(() => expect(h.remove).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(h.success).toHaveBeenCalledOnce());
    expect(h.error).toHaveBeenCalledOnce();
    expect(within(rows[0]).getByRole('checkbox')).not.toBeChecked();
    expect(within(rows[1]).getByRole('checkbox')).toBeChecked();
  });
});
