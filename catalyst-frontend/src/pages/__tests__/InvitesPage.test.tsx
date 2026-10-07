import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/** Mutable query result for the invite preview. */
const queryState = {
  current: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    error: null,
  },
};
/** Mutable auth store state. */
const authState = {
  current: {
    isAuthenticated: false,
    user: null as { email: string } | null,
    setSession: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
  },
};
/** useMutation options in registration order: [accept, register]. */
const mutationOptions: any[] = [];
const navigateMock = vi.fn();
const invalidateQueries = vi.fn();
const removeQueries = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('react-router-dom', () => ({
  Link: ({ children, to, ...rest }: { children?: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>{children}</a>
  ),
  useNavigate: () => navigateMock,
  useLocation: () => ({ pathname: '/invites/tok123', search: '' }),
  useParams: () => ({ token: 'tok123' }),
}));
vi.mock('@/csync', () => ({
  useQuery: () => queryState.current,
  useMutation: (options: unknown) => {
    mutationOptions.push(options);
    return { mutate: vi.fn(), isPending: false };
  },
  useQueryClient: () => ({ invalidateQueries, removeQueries }),
}));
vi.mock('../../stores/authStore', () => ({
  useAuthStore: (select: (state: unknown) => unknown) => select(authState.current),
}));
vi.mock('../../services/api/servers', () => ({
  serversApi: {
    previewInvite: vi.fn(),
    acceptInvite: vi.fn(),
    registerInvite: vi.fn(),
  },
}));
vi.mock('../../utils/notify', () => ({
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));
vi.mock('../../services/api/systemErrors', () => ({
  reportSystemError: vi.fn(),
}));
vi.mock('../../i18n/api-errors', () => ({
  getApiErrorCode: (e: unknown) => {
    const err = e as { code?: string; response?: { data?: { code?: string } } };
    return err?.response?.data?.code ?? (typeof err?.code === 'string' ? err.code : undefined);
  },
  getLocalizedErrorMessage: () => 'localized-error',
}));

import InvitesPage from '../InvitesPage';

const PREVIEW = {
  email: 'invitee@example.com',
  hasAccount: false,
  serverName: 'Survival Server',
  permissions: ['server.read', 'console.read'],
  expiresAt: new Date().toISOString(),
};

beforeEach(() => {
  queryState.current = { data: { ...PREVIEW }, isLoading: false, isError: false, error: null };
  authState.current = {
    isAuthenticated: false,
    user: null,
    setSession: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
  };
  mutationOptions.length = 0;
  navigateMock.mockReset();
  invalidateQueries.mockReset();
  removeQueries.mockReset();
});

afterEach(() => cleanup());

describe('InvitesPage routing', () => {
  it('routes a mismatched session to the wrong-account card, not a dead-end accept button', () => {
    authState.current = {
      ...authState.current,
      isAuthenticated: true,
      user: { email: 'admin@example.com' },
    };
    render(<InvitesPage />);
    expect(screen.getByText('invite.wrongAccountDescription')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'invite.signOut' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'invite.accept' })).not.toBeInTheDocument();
  });

  it('matches the session email case-insensitively and offers accept', () => {
    authState.current = {
      ...authState.current,
      isAuthenticated: true,
      user: { email: 'INVITEE@Example.com' },
    };
    render(<InvitesPage />);
    expect(screen.getByRole('button', { name: 'invite.accept' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'invite.signOut' })).not.toBeInTheDocument();
  });

  it('offers sign-in instead of registration when the invited email already has an account', () => {
    queryState.current = { ...queryState.current, data: { ...PREVIEW, hasAccount: true } };
    render(<InvitesPage />);
    expect(screen.getByRole('button', { name: 'invite.signInToAccept' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'invite.createAccount' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('fields.username')).not.toBeInTheDocument();
  });

  it('offers account creation when the invited email is unregistered', () => {
    render(<InvitesPage />);
    expect(screen.getByRole('button', { name: 'invite.createAccount' })).toBeInTheDocument();
    expect(screen.getByLabelText('fields.username')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'invite.signInToAccept' })).not.toBeInTheDocument();
  });

  it('reroutes to the wrong-account card when accept fails with INVITE_NOT_VALID_FOR_ACCOUNT', async () => {
    authState.current = {
      ...authState.current,
      isAuthenticated: true,
      user: { email: 'invitee@example.com' },
    };
    render(<InvitesPage />);
    expect(screen.getByRole('button', { name: 'invite.accept' })).toBeInTheDocument();

    const [acceptMutation] = mutationOptions;
    acceptMutation.onError({ code: 'INVITE_NOT_VALID_FOR_ACCOUNT' });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'invite.signOut' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'invite.accept' })).not.toBeInTheDocument();
    expect(invalidateQueries).toHaveBeenCalled();
  });

  it('drops the consumed invite preview and navigates to servers on accept success', async () => {
    authState.current = {
      ...authState.current,
      isAuthenticated: true,
      user: { email: 'invitee@example.com' },
    };
    render(<InvitesPage />);
    const [acceptMutation] = mutationOptions;
    acceptMutation.onSuccess();
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/servers'));
    expect(removeQueries).toHaveBeenCalled();
  });

  it('reroutes to sign-in when register fails with INVITE_EMAIL_HAS_ACCOUNT', async () => {
    render(<InvitesPage />);
    expect(screen.getByRole('button', { name: 'invite.createAccount' })).toBeInTheDocument();

    const [, registerMutation] = mutationOptions;
    registerMutation.onError({ code: 'INVITE_EMAIL_HAS_ACCOUNT' });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'invite.signInToAccept' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'invite.createAccount' })).not.toBeInTheDocument();
  });

  it('signs the invitee straight in when registration returns a session token', async () => {
    render(<InvitesPage />);
    const [, registerMutation] = mutationOptions;
    registerMutation.onSuccess({
      data: {
        userId: 'u-1',
        email: 'invitee@example.com',
        username: 'invitee',
        permissions: ['server.read'],
        token: 'session-token',
      },
    });
    expect(authState.current.setSession).toHaveBeenCalledWith({
      user: {
        id: 'u-1',
        email: 'invitee@example.com',
        username: 'invitee',
        role: 'user',
        permissions: ['server.read'],
      },
    });
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/servers'));
    // No verification card on the session path.
    expect(screen.queryByText('invite.verifyEmailDescription')).not.toBeInTheDocument();
  });

  it('shows the verification notice instead of a fake session when no token is returned', async () => {
    render(<InvitesPage />);
    const [, registerMutation] = mutationOptions;
    registerMutation.onSuccess({
      data: {
        userId: 'u-1',
        email: 'invitee@example.com',
        username: 'invitee',
        permissions: [],
        token: null,
        emailVerificationRequired: true,
        mailConfigured: false,
      },
    });
    expect(authState.current.setSession).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalledWith('/servers');
    await waitFor(() => {
      expect(screen.getByText('invite.verifyEmailAdminDescription')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'invite.signIn' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'invite.createAccount' })).not.toBeInTheDocument();
  });

  it('points at the inbox when mail is configured for verification', async () => {
    render(<InvitesPage />);
    const [, registerMutation] = mutationOptions;
    registerMutation.onSuccess({
      data: {
        userId: 'u-1',
        email: 'invitee@example.com',
        username: 'invitee',
        permissions: [],
        token: null,
        emailVerificationRequired: true,
        mailConfigured: true,
      },
    });
    await waitFor(() => {
      expect(screen.getByText('invite.verifyEmailDescription')).toBeInTheDocument();
    });
  });

  it('signs out and stays so the page can reroute to the register branch', async () => {
    authState.current = {
      ...authState.current,
      isAuthenticated: true,
      user: { email: 'admin@example.com' },
    };
    const { rerender } = render(<InvitesPage />);
    fireEvent.click(screen.getByRole('button', { name: 'invite.signOut' }));

    await waitFor(() => {
      expect(authState.current.logout).toHaveBeenCalledWith({ stay: true });
    });

    // The store clearing isAuthenticated re-renders into the signed-out flow.
    authState.current = { ...authState.current, isAuthenticated: false, user: null };
    rerender(<InvitesPage />);
    expect(screen.getByRole('button', { name: 'invite.createAccount' })).toBeInTheDocument();
  });
});
