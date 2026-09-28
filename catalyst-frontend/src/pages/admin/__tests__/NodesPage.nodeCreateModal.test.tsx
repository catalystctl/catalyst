/**
 * AdminNodesPage — single create-modal instance.
 *
 * Regression: NodeCreateModal was rendered once in the page header AND again
 * inside the empty-state action. Opening the modal from the empty state, then
 * creating the first node, made the node-list refetch replace the empty state,
 * which unmounted that modal instance and destroyed its step-3 deploy script —
 * so the install script "sometimes" never appeared (and the only recovery was
 * regenerating it from the node details page).
 *
 * The fix mounts one modal and makes the empty-state action a shared trigger.
 * This test drives that exact sequence: empty list -> open from the empty-state
 * trigger -> list fills -> the open deploy dialog must survive.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const h = vi.hoisted(() => ({
  adminNodes: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../../hooks/useAdmin', () => ({
  useAdminNodes: () => ({ data: { nodes: h.adminNodes }, isLoading: false }),
}));

vi.mock('../../../hooks/useUpdateCheck', () => ({
  useUpdateCheck: () => ({ data: undefined }),
}));

vi.mock('../../../services/api/locations', () => ({
  locationsApi: { list: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../../../services/api/nodes', () => ({
  nodesApi: { remove: vi.fn().mockResolvedValue({ success: true }) },
}));

vi.mock('../../../components/nodes/LocationsManagerModal', () => ({
  default: () => null,
}));

import { queryClient } from '../../../lib/queryClient';
import { QueryClientProvider } from '../../../csync';
import { useAuthStore } from '../../../stores/authStore';
import AdminNodesPage from '../NodesPage';

function renderPage() {
  return (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <AdminNodesPage />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

const NODE = {
  id: 'node-1',
  name: 'node-1',
  hostname: 'node-1.local',
  publicAddress: '203.0.113.1',
  isOnline: false,
  status: 'stopped',
  maxCpuCores: 1,
  maxMemoryMb: 1024,
  _count: { servers: 0 },
};

describe('AdminNodesPage — single create modal', () => {
  beforeEach(() => {
    h.adminNodes = [];
    queryClient.clear();
    useAuthStore.setState({ user: { id: 'u1', permissions: ['*'] } as never });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
  });

  it('keeps the deploy dialog mounted when the node list fills after creation', async () => {
    const { rerender } = render(renderPage());

    // Empty list: the header trigger and the empty-state trigger are both present.
    const triggers = await screen.findAllByRole('button', { name: 'Register Node' });
    expect(triggers).toHaveLength(2);

    // Open from the empty-state trigger (the last one).
    fireEvent.click(triggers[triggers.length - 1]);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    // The post-create refetch now returns a node: the empty state is replaced.
    h.adminNodes = [NODE];
    rerender(renderPage());

    // The single page-level modal instance must still own the open dialog;
    // before the fix this instance lived in the empty state and unmounted here.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
