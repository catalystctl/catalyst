import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const createPermanentSftpToken = vi.fn();
const invalidateQueries = vi.fn();
const connectionInfo = {
  current: {
    enabled: true,
    host: 'sftp.example.com',
    port: 2022,
    username: 'server-1',
    sftpPassword: 'sftp_temporary',
    expiresAt: Date.now() + 15 * 60 * 1000,
    ttlMs: 15 * 60 * 1000,
    ttlOptions: [{ label: '15 minutes', value: 15 * 60 * 1000 }],
    permanentTokensEnabled: true,
    permanentToken: null as null | {
      userId?: string;
      token: string | null;
      createdAt: number;
      lastUsedAt: number | null;
    },
  },
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/csync', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) =>
    queryKey.includes('sftp-tokens')
      ? { data: [], isLoading: false }
      : { data: connectionInfo.current, isLoading: false },
  useMutation: (options: {
    mutationFn: (...args: unknown[]) => Promise<unknown>;
    onSuccess?: (result: any, variables: any) => void;
    onError?: (error: unknown) => void;
    onSettled?: () => void;
  }) => ({
    isPending: false,
    mutate: (...args: unknown[]) => {
      options
        .mutationFn(...args)
        .then((result) => options.onSuccess?.(result, args[0]))
        .catch(options.onError)
        .finally(options.onSettled);
    },
  }),
}));
vi.mock('@/lib/queryClient', () => ({
  queryClient: { invalidateQueries: (...args: unknown[]) => invalidateQueries(...args) },
}));
vi.mock('../../services/api/servers', () => ({
  serversApi: {
    createPermanentSftpToken: (...args: unknown[]) => createPermanentSftpToken(...args),
    rotateSftpToken: vi.fn(),
    revokeSftpToken: vi.fn(),
    revokeAllSftpTokens: vi.fn(),
  },
}));
vi.mock('../../utils/notify', () => ({
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
}));

import SftpConnectionInfo from './SftpConnectionInfo';

describe('SFTP permanent token UI', () => {
  beforeEach(() => {
    createPermanentSftpToken.mockReset().mockResolvedValue({
      token: 'sftp_perm_newtoken',
      createdAt: Date.now(),
      lastUsedAt: null,
    });
    invalidateQueries.mockReset();
    connectionInfo.current.permanentToken = null;
    connectionInfo.current.permanentTokensEnabled = true;
  });
  afterEach(cleanup);

  it('creates a permanent token and shows it in the password field', async () => {
    render(<SftpConnectionInfo serverId="server-1" isOwner />);

    fireEvent.click(screen.getByRole('button', { name: 'files.sftp.tokenTypePermanent' }));
    fireEvent.click(screen.getByRole('button', { name: 'files.sftp.permanentCreate' }));

    expect(createPermanentSftpToken).toHaveBeenCalledWith('server-1');
    await waitFor(() => expect(invalidateQueries).toHaveBeenCalled());
    fireEvent.click(screen.getByTitle('files.sftp.showPassword'));
    expect(await screen.findByText('sftp_perm_newtoken')).toBeInTheDocument();
  });

  it('hides the token-type switch when the admin has not enabled permanent tokens', () => {
    connectionInfo.current.permanentTokensEnabled = false;
    render(<SftpConnectionInfo serverId="server-1" isOwner />);

    expect(screen.queryByRole('button', { name: 'files.sftp.tokenTypePermanent' })).toBeNull();
  });
});
