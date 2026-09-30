import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const remove = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, args?: { name?: string }) => (args?.name ? `${key}: ${args.name}` : key) }),
  Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
}));
vi.mock('../../services/api/servers', () => ({ serversApi: { delete: (...args: unknown[]) => remove(...args) } }));
vi.mock('../../utils/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));
vi.mock('@/lib/queryClient', () => ({
  queryClient: {
    cancelQueries: vi.fn(),
    getQueriesData: vi.fn(() => []),
    setQueriesData: vi.fn(),
    removeQueries: vi.fn(),
    setQueryData: vi.fn(),
    invalidateQueries: vi.fn(),
  },
}));
vi.mock('@/csync', () => ({
  useMutation: (options: { mutationFn: () => Promise<unknown> }) => ({
    isPending: false,
    mutate: () => { void options.mutationFn(); },
  }),
}));

import DeleteServerDialog from './DeleteServerDialog';

describe('DeleteServerDialog typed confirmation', () => {
  afterEach(cleanup);

  it('keeps the destructive action disabled until the server name matches exactly', () => {
    remove.mockReset().mockResolvedValue({});
    render(<DeleteServerDialog serverId="server-1" serverName="demo-forge-01" open />);
    const confirm = screen.getByRole('button', { name: 'common:actions.delete' });
    const input = screen.getByLabelText('deleteServer.typeNameToConfirm: demo-forge-01');
    expect(confirm).toBeDisabled();
    fireEvent.change(input, { target: { value: 'demo-forge' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(input, { target: { value: 'demo-forge-01' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(remove).toHaveBeenCalledWith('server-1');
  });
});
