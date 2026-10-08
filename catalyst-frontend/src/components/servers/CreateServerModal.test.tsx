import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const create = vi.fn();
const install = vi.fn();
const navigate = vi.fn();
const invalidateQueries = vi.fn();
const setPermissions = { current: ['admin.write'] };
const templates = [{ id: 'template-1', name: 'Minecraft' }];
const templateDetail = { id: 'template-1', variables: [] };
const nodes = [{ id: 'node-1', name: 'Node', locationId: 'location-1' }];

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, args?: { field?: string; error?: string }) => args?.field ? `${key}: ${args.field}` : args?.error ? `${key}: ${args.error}` : key }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('../../stores/authStore', () => ({ useAuthStore: (select: (state: any) => unknown) => select({ user: { permissions: setPermissions.current } }) }));
vi.mock('../../hooks/useTemplates', () => ({ useTemplates: () => ({ data: templates }), useTemplate: () => ({ data: templateDetail }) }));
vi.mock('../../hooks/useNodes', () => ({ useNodes: () => ({ data: nodes }), useAccessibleNodes: () => ({ data: { nodes, hasWildcard: false } }) }));
vi.mock('../../services/api/nodes', () => ({ nodesApi: { allocations: () => Promise.resolve([{ id: 'allocation-1', ip: '127.0.0.1', port: 25565 }]), ipPools: () => Promise.resolve([]) } }));
vi.mock('../../services/api/admin', () => ({ adminApi: { listUsers: vi.fn() } }));
vi.mock('../../services/api/servers', () => ({ serversApi: { create: (...args: unknown[]) => create(...args), install: (...args: unknown[]) => install(...args) } }));
vi.mock('../../utils/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));
vi.mock('@/csync', () => ({
  useQueryClient: () => ({ invalidateQueries }),
  useQuery: (options: { enabled: boolean; queryFn: () => Promise<unknown> }) => ({
    data: options.enabled ? [{ id: 'customer-1', username: 'customer', email: 'customer@example.test' }] : [],
    isLoading: false,
    error: null,
  }),
  useMutation: (options: { mutationFn: () => Promise<unknown>; onSuccess: (result: unknown) => void; onError: (error: unknown) => void; onSettled: () => void }) => ({
    isPending: false,
    mutate: () => { options.mutationFn().then(options.onSuccess, options.onError).finally(options.onSettled); },
  }),
}));
vi.mock('@/components/ui/combobox', () => ({ default: ({ value, onChange, options, placeholder }: { value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; placeholder?: string }) => <button type="button" role="combobox" aria-label={placeholder} onClick={() => options[0] && onChange(options[0].value)}>{value ? options.find((option) => option.value === value)?.label : 'Select'}</button> }));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogToolbar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));

import CreateServerModal from './CreateServerModal';

describe('server creation installation recovery', () => {
  beforeEach(() => { create.mockReset().mockResolvedValue({ id: 'created-1' }); install.mockReset().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({}); navigate.mockReset(); setPermissions.current = ['admin.write']; });
  afterEach(cleanup);

  it('retries installation on the created server without another create request', async () => {
    render(<CreateServerModal />);
    fireEvent.click(screen.getByRole('button', { name: 'createServer.newServer' }));
    fireEvent.change(screen.getByPlaceholderText('my-awesome-server'), { target: { value: 'my-server' } });
    fireEvent.click(screen.getByRole('combobox', { name: 'createServer.fields.templatePlaceholder' }));
    fireEvent.click(screen.getByRole('combobox', { name: 'createServer.fields.nodePlaceholder' }));
    fireEvent.click(screen.getByRole('button', { name: 'createServer.submit' }));
    await screen.findByText(/createServer.installFailed/);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].ownerId).toBeUndefined();
    expect(install).toHaveBeenCalledWith('created-1');
    fireEvent.click(screen.getByRole('button', { name: 'createServer.retryInstall' }));
    await waitFor(() => expect(install).toHaveBeenCalledTimes(2));
    expect(create).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/servers/created-1/console'));
  });

  it('passes the selected owner to the create request', async () => {
    setPermissions.current = ['admin.write'];
    render(<CreateServerModal />);
    fireEvent.click(screen.getByRole('button', { name: 'createServer.newServer' }));
    fireEvent.change(screen.getByPlaceholderText('my-awesome-server'), { target: { value: 'customer-server' } });
    fireEvent.click(screen.getByRole('combobox', { name: 'createServer.fields.templatePlaceholder' }));
    fireEvent.click(screen.getByRole('combobox', { name: 'createServer.fields.nodePlaceholder' }));
    fireEvent.click(screen.getByRole('combobox', { name: 'createServer.fields.ownerPlaceholder' }));
    fireEvent.click(screen.getByRole('button', { name: 'createServer.submit' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 'customer-1' })));
  });

  it('does not offer allocation creation to users without node allocation permissions', async () => {
    setPermissions.current = ['server.create'];
    render(<CreateServerModal />);
    fireEvent.click(screen.getByRole('button', { name: 'createServer.newServer' }));
    fireEvent.change(screen.getByPlaceholderText('my-awesome-server'), { target: { value: 'my-server' } });
    fireEvent.click(screen.getAllByRole('combobox')[0]);
    fireEvent.click(screen.getAllByRole('combobox')[1]);
    await waitFor(() => expect(screen.getByRole('option', { name: '127.0.0.1:25565' })).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: 'createServer.network.newAllocation' })).not.toBeInTheDocument();
  });

  it('sends the selected node location and refuses to submit without a node', async () => {
    render(<CreateServerModal />);
    fireEvent.click(screen.getByRole('button', { name: 'createServer.newServer' }));
    fireEvent.change(screen.getByPlaceholderText('my-awesome-server'), { target: { value: 'my-server' } });
    fireEvent.click(screen.getByRole('combobox', { name: 'createServer.fields.templatePlaceholder' }));
    const submit = screen.getByRole('button', { name: 'createServer.submit' });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole('combobox', { name: 'createServer.fields.nodePlaceholder' }));
    fireEvent.click(submit);
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ locationId: 'location-1' })));
  });
});
