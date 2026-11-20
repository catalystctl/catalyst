import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Server } from '../../types/server';

const update = vi.fn();
const resizeStorage = vi.fn();
const updateBackupSettings = vi.fn();
const invalidateQueries = vi.fn();
const nodeCpuSet = { current: null as string | null };
const serverFixture: { current: Partial<Server> } = { current: {} };

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/csync', () => ({
  useMutation: (options: {
    mutationFn: () => Promise<unknown>;
    onSuccess: (result: unknown) => void;
    onError: (error: unknown) => void;
    onSettled: () => void;
  }) => ({
    isPending: false,
    mutate: () => {
      options.mutationFn().then(options.onSuccess, options.onError).finally(options.onSettled);
    },
  }),
}));
vi.mock('@/lib/queryClient', () => ({
  queryClient: { invalidateQueries: (...args: unknown[]) => invalidateQueries(...args) },
}));
vi.mock('../../hooks/useServer', () => ({ useServer: () => ({ data: serverFixture.current }) }));
vi.mock('../../hooks/useSseResizeComplete', () => ({ useSseResizeComplete: () => undefined }));
vi.mock('../../hooks/useNodes', () => ({
  useNodes: () => ({ data: [{ id: 'node-1', name: 'Node', hostCpuSet: nodeCpuSet.current }] }),
}));
vi.mock('../../services/api/servers', () => ({
  serversApi: {
    update: (...args: unknown[]) => update(...args),
    resizeStorage: (...args: unknown[]) => resizeStorage(...args),
    updateBackupSettings: (...args: unknown[]) => updateBackupSettings(...args),
  },
}));
vi.mock('../../services/api/nodes', () => ({
  nodesApi: {
    availableIps: () => Promise.resolve([]),
    allocations: () => Promise.resolve([]),
  },
}));
vi.mock('../../utils/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));

import UpdateServerModal from './UpdateServerModal';

/** The single payload the mocked update call received. */
const sentPayload = () => update.mock.calls[0][1] as Record<string, unknown>;

describe('update server CPU pinning', () => {
  beforeEach(() => {
    update.mockReset().mockResolvedValue({});
    resizeStorage.mockReset().mockResolvedValue({});
    updateBackupSettings.mockReset().mockResolvedValue({});
    invalidateQueries.mockReset();
    nodeCpuSet.current = null;
    serverFixture.current = {
      id: 'server-1',
      name: 'My server',
      status: 'stopped',
      nodeId: 'node-1',
      networkMode: 'host',
      allocatedMemoryMb: 1024,
      allocatedCpuCores: 1,
      allocatedDiskMb: 10240,
      databaseAllocation: 0,
      backupAllocationMb: 0,
      backupRetentionCount: 0,
      primaryIp: null,
      cpuAffinity: null,
    };
  });
  afterEach(cleanup);

  /** Render the editor and wait for the form to be seeded from the server row. */
  const renderSeeded = async () => {
    render(<UpdateServerModal serverId="server-1" open />);
    await screen.findByDisplayValue('My server');
  };

  it('sends the canonical mask when the pin changed', async () => {
    await renderSeeded();
    fireEvent.change(screen.getByLabelText('cpuAffinity.title'), { target: { value: '2,0-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'updateServer.save' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(sentPayload()).toEqual({ cpuAffinity: '0-2' });
  });

  it('omits cpuAffinity when the pin canonicalises to what is stored', async () => {
    serverFixture.current.cpuAffinity = '0-2';
    await renderSeeded();
    fireEvent.change(screen.getByDisplayValue('0-2'), { target: { value: ' 2 , 0 - 1 ' } });
    fireEvent.change(screen.getByDisplayValue('1024'), { target: { value: '2048' } });
    fireEvent.click(screen.getByRole('button', { name: 'updateServer.save' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(sentPayload()).toEqual({ allocatedMemoryMb: 2048 });
    expect(sentPayload()).not.toHaveProperty('cpuAffinity');
  });

  it('clears the pin with null when the field is emptied', async () => {
    serverFixture.current.cpuAffinity = '0-2';
    await renderSeeded();
    fireEvent.change(screen.getByDisplayValue('0-2'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'updateServer.save' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(sentPayload()).toEqual({ cpuAffinity: null });
  });

  it('blocks the save and explains the rule when the pin has fewer CPUs than the allocation', async () => {
    serverFixture.current.allocatedCpuCores = 4;
    await renderSeeded();
    fireEvent.change(screen.getByLabelText('cpuAffinity.title'), { target: { value: '0-1' } });
    expect(screen.getByText('cpuAffinity.belowAllocation')).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'updateServer.save' });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(update).not.toHaveBeenCalled();
  });

  it('blocks the save on an unparseable mask', async () => {
    await renderSeeded();
    fireEvent.change(screen.getByLabelText('cpuAffinity.title'), { target: { value: '3-1' } });
    expect(screen.getByText('cpuAffinity.invalid')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'updateServer.save' })).toBeDisabled();
  });

  it('hints that a change applies on the next start while the server runs', async () => {
    serverFixture.current.status = 'running';
    await renderSeeded();
    expect(screen.getByText('cpuAffinity.appliesOnNextStart')).toBeInTheDocument();
  });

  it('offers the node CPU set as a picker when the agent reported one', async () => {
    nodeCpuSet.current = '0-3';
    serverFixture.current.cpuAffinity = '0-1';
    await renderSeeded();
    // The reported set renders one chip per CPU, and the stored pin is checked.
    expect(screen.getByRole('button', { name: '0' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '2' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    fireEvent.click(screen.getByRole('button', { name: 'updateServer.save' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(sentPayload()).toEqual({ cpuAffinity: '0-2' });
  });
});
