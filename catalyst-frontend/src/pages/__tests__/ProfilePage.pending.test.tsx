/**
 * ProfilePage — pending feedback and accessible labels (audit B, "Missing
 * pending/feedback states" + "Placeholder-as-label inputs").
 *
 * The passkey update/delete and avatar upload/remove mutations never read
 * `isPending`, so a click gave zero feedback; the profile editor used
 * placeholders as labels, which vanish as soon as the field has a value.
 *
 * `@/csync` is mocked with a switch the tests flip: `pending` makes every
 * mutation report `isPending`, which is exactly the state the page used to
 * ignore.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const PASSKEYS = [{ id: 'pk-1', name: 'YubiKey', deviceType: 'USB', createdAt: '2026-01-02T00:00:00.000Z' }];

const profile = {
  id: 'user-1',
  username: 'toil',
  image: 'https://cdn.example.com/avatar.png',
  email: 'toil@example.com',
  emailVerified: true,
  twoFactorEnabled: false,
  hasPassword: true,
  firstName: 'Toil',
  lastName: 'Operator',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const mutationState = vi.hoisted(() => ({ pending: false, variables: 'pk-1' as unknown }));

const deletePasskey = vi.fn((_id: string) => Promise.resolve());
const updatePasskey = vi.fn((_id: string, _name: string) => Promise.resolve());
const removeAvatar = vi.fn(() => Promise.resolve());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
  Trans: ({ children }: { children?: unknown }) => children,
}));
vi.mock('@/csync', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({
    data: queryKey?.[1] === 'passkeys' ? PASSKEYS : [],
    isLoading: false,
    refetch: vi.fn(),
  }),
  useMutation: ({ mutationFn }: { mutationFn: (...args: unknown[]) => unknown }) => ({
    mutate: (...args: unknown[]) => mutationFn(...args),
    isPending: mutationState.pending,
    variables: mutationState.variables,
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('@/lib/queryClient', () => ({ queryClient: { invalidateQueries: vi.fn() } }));
vi.mock('../../hooks/useProfile', () => ({
  useProfile: () => ({ data: profile, isLoading: false }),
  useProfileSsoAccounts: () => ({ data: [{ id: 'sso-1', providerId: 'whmcs' }] }),
  useSessions: () => ({ data: [], isLoading: false }),
  useAuditLog: () => ({ data: { logs: [] } }),
  useProfileApiKeys: () => ({ data: [] }),
}));
vi.mock('../../stores/authStore', () => ({
  useAuthStore: Object.assign(
    (selector: (state: { user: { permissions: string[] } }) => unknown) =>
      selector({ user: { permissions: [] } }),
    { getState: () => ({ refresh: vi.fn() }) },
  ),
}));
vi.mock('../../stores/themeStore', () => ({
  // The Linked Accounts card only renders when a provider is enabled.
  useThemeStore: (selector: (state: { themeSettings: unknown }) => unknown) =>
    selector({ themeSettings: { authProviders: { whmcs: true } } }),
}));
vi.mock('../../services/api/profile', () => ({
  profileApi: {
    listPasskeys: () => Promise.resolve(PASSKEYS),
    deletePasskey: (id: string) => deletePasskey(id),
    updatePasskey: (id: string, name: string) => updatePasskey(id, name),
    removeAvatar: () => removeAvatar(),
    uploadAvatar: vi.fn(),
    updateProfile: vi.fn(),
    changePassword: vi.fn(),
    setPassword: vi.fn(),
    enableTwoFactor: vi.fn(),
    disableTwoFactor: vi.fn(),
    generateBackupCodes: vi.fn(),
    createPasskey: vi.fn(),
    revokeSession: vi.fn(),
    revokeAllSessions: vi.fn(),
    resendVerification: vi.fn(),
    unlinkSso: vi.fn(),
    linkSso: vi.fn(),
  },
}));
vi.mock('../../components/profile/AppearanceSettings', () => ({ default: () => null }));
vi.mock('../../plugins/PluginSlot', () => ({ PluginSlot: () => null }));

import ProfilePage from '../ProfilePage';

beforeEach(() => {
  deletePasskey.mockClear();
  updatePasskey.mockClear();
  removeAvatar.mockClear();
  mutationState.pending = false;
});

afterEach(cleanup);

const renderPage = () =>
  render(
    <MemoryRouter>
      <ProfilePage />
    </MemoryRouter>,
  );

describe('ProfilePage — mutations reach the API', () => {
  it('deletes a passkey', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'common:actions.delete' }));
    await waitFor(() => expect(deletePasskey).toHaveBeenCalledWith('pk-1'));
  });

  it('saves a renamed passkey', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'passkeys.rename' }));
    fireEvent.click(await screen.findByRole('button', { name: 'common:actions.save' }));
    await waitFor(() => expect(updatePasskey).toHaveBeenCalledWith('pk-1', expect.anything()));
  });

  it('removes the avatar', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'account.removeAvatar' }));
    await waitFor(() => expect(removeAvatar).toHaveBeenCalled());
  });
});

describe('ProfilePage — pending states', () => {
  beforeEach(() => {
    mutationState.pending = true;
  });

  it('disables and spins the passkey delete button', async () => {
    renderPage();
    const del = await screen.findByRole('button', { name: 'common:actions.delete' });
    expect(del).toBeDisabled();
    expect(del.querySelector('.animate-spin')).not.toBeNull();
  });

  it('disables and spins the passkey rename save', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'passkeys.rename' }));
    const save = await screen.findByRole('button', { name: 'common:actions.save' });
    expect(save).toBeDisabled();
    expect(save.querySelector('.animate-spin')).not.toBeNull();
  });

  it('disables and spins Remove avatar', async () => {
    renderPage();
    const remove = await screen.findByRole('button', { name: 'account.removeAvatar' });
    expect(remove).toBeDisabled();
    expect(remove.querySelector('.animate-spin')).not.toBeNull();
  });
});

describe('ProfilePage — button styling and labels', () => {
  it('renders Remove avatar as a row-height ghost danger button', async () => {
    renderPage();
    const remove = await screen.findByRole('button', { name: 'account.removeAvatar' });
    expect(remove.className).toContain('text-danger');
    expect(remove.className).toContain('h-7');
  });

  it('renders SSO Unlink as a danger ghost button with an icon, not bare red text', async () => {
    renderPage();
    const unlink = await screen.findByRole('button', { name: 'linkedAccounts.unlinkProvider' });
    expect(unlink.className).toContain('text-danger');
    expect(unlink.className).toContain('h-7');
    expect(unlink.querySelector('svg')).not.toBeNull();
  });

  it('labels the profile editor fields instead of using placeholders', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'common:actions.edit' }));

    const username = await screen.findByLabelText('account.username');
    expect(username).not.toHaveAttribute('placeholder');
    expect(screen.getByLabelText('account.firstName')).toBeInTheDocument();
    expect(screen.getByLabelText('account.lastName')).toBeInTheDocument();
  });
});
