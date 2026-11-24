/**
 * CreateApiKeyDialog — scoped-by-default permissions (audit D16).
 *
 * The audit's longest path was "create a scoped key": toggle "all permissions"
 * off, then expand every category by hand. The dialog now opens scoped, offers
 * a permission search, and reuses the role presets.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// Radix's Switch measures itself; jsdom has no ResizeObserver.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

type Preset = { key: string; label: string; description: string; permissions: string[] };

const presets: Preset[] = [
  { key: 'moderator', label: 'Moderator', description: 'Runs servers', permissions: ['server.start', 'server.stop'] },
];

const catalog = [
  {
    id: 'servers',
    label: 'Servers',
    description: '',
    permissions: [
      { value: 'server.read', label: 'View servers' },
      { value: 'server.start', label: 'Start servers' },
      { value: 'server.stop', label: 'Stop servers' },
    ],
  },
  {
    id: 'admin',
    label: 'Administration',
    description: '',
    permissions: [{ value: 'user.read', label: 'View users' }],
  },
];

type CreatePayload = { allPermissions: boolean; permissions: string[] };
const createMutateAsync = vi.fn((_payload: CreatePayload) => Promise.resolve({ key: 'sk_live_new' }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('@/csync', () => ({
  useQuery: () => ({ data: presets }),
  useMutation: () => ({ mutateAsync: createMutateAsync, isPending: false }),
}));
vi.mock('@/lib/queryClient', () => ({ queryClient: { invalidateQueries: vi.fn() } }));
vi.mock('../../../hooks/useApiKeys', () => ({
  useCreateApiKey: () => ({ mutateAsync: createMutateAsync, isPending: false }),
  usePermissionsCatalog: () => ({ data: catalog, isLoading: false }),
  useMyPermissions: () => ({ data: ['*'] }),
}));
vi.mock('../../../services/api/roles', () => ({
  rolesApi: { getPresets: vi.fn() },
}));

import { CreateApiKeyDialog } from '../CreateApiKeyDialog';

beforeEach(() => {
  createMutateAsync.mockClear();
});

afterEach(cleanup);

const open = () => render(<CreateApiKeyDialog open onOpenChange={() => {}} />);

describe('CreateApiKeyDialog — scoped by default', () => {
  it('opens with the "all permissions" toggle off and the category list visible', () => {
    open();
    const allToggle = screen.getByRole('switch', { name: 'apiKeys.form.allMine' });
    expect(allToggle).toHaveAttribute('aria-checked', 'false');
    // Scoped mode is the default, so the category tree is already on screen.
    expect(screen.getByText('Servers')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'apiKeys.form.searchPermissions' })).toBeInTheDocument();
  });

  it('blocks submit until at least one permission is picked', () => {
    open();
    const submit = screen.getByRole('button', { name: 'apiKeys.createDialog.submit' });
    expect(submit).toBeDisabled();
    expect(screen.getByText('apiKeys.form.selectAtLeastOne')).toBeInTheDocument();
  });

  it('filters categories and force-opens the matches while searching', () => {
    open();
    fireEvent.change(screen.getByRole('searchbox', { name: 'apiKeys.form.searchPermissions' }), {
      target: { value: 'users' },
    });

    // Only the Administration category survives, and its permission is visible
    // even though no category was expanded by hand.
    expect(screen.queryByText('Servers')).not.toBeInTheDocument();
    expect(screen.getByText('View users')).toBeInTheDocument();
    expect(screen.queryByText('Start servers')).not.toBeInTheDocument();
  });

  it('reports an empty result instead of an empty box', () => {
    open();
    fireEvent.change(screen.getByRole('searchbox', { name: 'apiKeys.form.searchPermissions' }), {
      target: { value: 'zzzz-no-match' },
    });
    expect(screen.getByText('apiKeys.form.noPermissionsMatch')).toBeInTheDocument();
  });

  it('applies a role preset and submits the selected permissions', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Moderator' }));

    // Preset keeps only grantable values; '*' is dropped.
    const submit = screen.getByRole('button', { name: 'apiKeys.createDialog.submit' });
    expect(submit).toBeEnabled();

    fireEvent.change(screen.getByPlaceholderText('apiKeys.form.namePlaceholder'), {
      target: { value: 'CI key' },
    });
    fireEvent.click(submit);

    await waitFor(() => expect(createMutateAsync).toHaveBeenCalledTimes(1));
    const payload = createMutateAsync.mock.calls[0][0];
    expect(payload.allPermissions).toBe(false);
    expect(payload.permissions).toEqual(['server.start', 'server.stop']);
  });
});
