import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => {
  const store: {
    status: any;
    settings: any;
    nodes: any[];
    calls: { saveSettings: any[]; setNodeAutoUpdate: any[]; check: number };
  } = {
    status: undefined,
    settings: undefined,
    nodes: [],
    calls: { saveSettings: [], setNodeAutoUpdate: [], check: 0 },
  };
  return { store };
});

vi.mock('../../../services/api/admin', () => ({
  adminApi: {
    updateStatus: async () => mocks.store.status,
    updateSettings: async () => mocks.store.settings,
    saveUpdateSettings: async (payload: unknown) => {
      mocks.store.calls.saveSettings.push(payload);
      return { ...mocks.store.settings, ...(payload as object) };
    },
    checkForUpdate: async () => {
      mocks.store.calls.check += 1;
      return mocks.store.status;
    },
    triggerUpdate: async () => ({ success: true, message: 'ok' }),
    setNodeAutoUpdate: async (nodeIds: string[], enabled: boolean) => {
      mocks.store.calls.setNodeAutoUpdate.push({ nodeIds, enabled });
      return { success: true, data: { updated: nodeIds.length, enabled } };
    },
  },
}));

vi.mock('../../../services/api/nodes', () => ({
  nodesApi: { list: async () => mocks.store.nodes },
}));

// The real csync hooks need a provider; drive them off the hoisted store and
// record mutate() calls so the test can assert the request payload.
vi.mock('@/csync', () => ({
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
    const key = String(queryKey[0]);
    if (key === 'admin-update-status') return { data: mocks.store.status, isLoading: false };
    if (key === 'admin-update-settings') return { data: mocks.store.settings, isLoading: false };
    if (key === 'nodes') return { data: mocks.store.nodes, isLoading: false };
    return { data: undefined, isLoading: false };
  },
  useMutation: ({ mutationFn }: { mutationFn: (vars: any) => unknown }) => {
    const id = mutationFn.name;
    return {
      mutate: (vars?: any) => {
        void mutationFn(vars);
        return undefined;
      },
      mutateAsync: mutationFn,
      isPending: false,
      isError: false,
      error: null,
      _id: id,
    };
  },
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
  }),
}));

vi.mock('../../UpdateProgressModal', () => ({
  default: () => <div data-testid="progress-modal" />,
  consumePostUpdateReloadToast: vi.fn(() => false),
}));

vi.mock('../../../utils/notify', () => ({
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
}));

import UpdateSettings from '../UpdateSettings';

const NODE_OFF = {
  id: 'node-1',
  name: 'eu-1',
  isOnline: true,
  agentVersion: '1.0.0',
  autoUpdateEnabled: false,
};

const NODE_ON = {
  id: 'node-2',
  name: 'na-1',
  isOnline: true,
  agentVersion: '2.0.0',
  autoUpdateEnabled: true,
};

beforeEach(() => {
  mocks.store.status = {
    currentVersion: '1.0.0',
    latestVersion: '2.0.0',
    updateAvailable: true,
    lastCheckedAt: '2026-09-25T10:00:00.000Z',
    releaseUrl: null,
    isDocker: true,
    autoUpdateEnabled: false,
    autoUpdateAutoTrigger: false,
    autoUpdateIntervalMs: 3_600_000,
    autoUpdatePolling: false,
  };
  mocks.store.settings = {
    enabled: false,
    autoTrigger: false,
    intervalMs: 3_600_000,
    configured: true,
  };
  mocks.store.nodes = [NODE_OFF, NODE_ON];
  mocks.store.calls = { saveSettings: [], setNodeAutoUpdate: [], check: 0 };
});

describe('UpdateSettings node auto-update selection', () => {
  it('lists every node with its current automatic/manual state', async () => {
    render(<UpdateSettings />);

    expect(await screen.findByText('eu-1')).toBeInTheDocument();
    expect(screen.getByText('na-1')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /eu-1/ })).toHaveAttribute(
      'data-state',
      'unchecked',
    );
    expect(screen.getByRole('checkbox', { name: /na-1/ })).toHaveAttribute(
      'data-state',
      'checked',
    );
    // Only the outdated node is flagged (the row is one of three labels: the
    // top badge, the status value, and this node's badge).
    expect(screen.getAllByText('Update available')).toHaveLength(3);
  });

  it('shows a manual-only node as "Automatic" once selected but sends nothing until Apply', async () => {
    render(<UpdateSettings />);

    const checkbox = await screen.findByRole('checkbox', { name: /eu-1/ });
    fireEvent.click(checkbox);

    expect(checkbox).toHaveAttribute('data-state', 'checked');
    expect(mocks.store.calls.setNodeAutoUpdate).toHaveLength(0);
    expect(screen.getByText(/1 unsaved change/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Apply/ }));

    await waitFor(() => {
      expect(mocks.store.calls.setNodeAutoUpdate).toEqual([
        { nodeIds: ['node-1'], enabled: true },
      ]);
    });
  });

  it('does not send a request when a node is toggled back to its saved value', async () => {
    render(<UpdateSettings />);

    const checkbox = await screen.findByRole('checkbox', { name: /eu-1/ });
    fireEvent.click(checkbox);
    fireEvent.click(checkbox);

    expect(screen.queryByText(/unsaved change/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Apply/ })).not.toBeInTheDocument();
  });

  it('disables the automatic-update privacy-safe default: nothing selected on first load', async () => {
    mocks.store.nodes = [{ ...NODE_OFF, autoUpdateEnabled: false }];
    render(<UpdateSettings />);

    const checkbox = await screen.findByRole('checkbox', { name: /eu-1/ });
    expect(checkbox).toHaveAttribute('data-state', 'unchecked');
    expect(screen.getByText('0 nodes automatic')).toBeInTheDocument();
  });
});

describe('UpdateSettings panel automation', () => {
  it('saves the master switch through the settings endpoint', async () => {
    render(<UpdateSettings />);

    const toggle = await screen.findByRole('switch', { name: /Panel update automation/i });
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(mocks.store.calls.saveSettings).toEqual([{ enabled: true }]);
    });
  });

  it('runs a release check on demand', async () => {
    render(<UpdateSettings />);

    fireEvent.click(await screen.findByRole('button', { name: /Check now/ }));

    await waitFor(() => {
      expect(mocks.store.calls.check).toBe(1);
    });
  });
});
