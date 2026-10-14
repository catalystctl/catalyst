/**
 * Every signed-in user bootstraps the plugin store.
 *
 * The store used to load only for `admin.read` holders, which made every
 * plugin tab, page and slot component admin-only regardless of the
 * `requiredPermissions` the plugin declared. A plugin's UI is the plugin's
 * decision; the panel's job is to give it the manifests and evaluate them.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { usePluginStore } from '../store';
import { useAuthStore } from '../../stores/authStore';
import type { User } from '../../types/user';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../api', () => ({ fetchPlugins: vi.fn(async () => []) }));
vi.mock('../loader', () => ({
  loadPluginFrontend: vi.fn(),
  unmountPluginFrontend: vi.fn(),
}));
vi.mock('../../services/api/admin-events', () => ({
  createAdminEventsStream: vi.fn(() => () => {}),
  hasAdminReadPermission: (permissions?: string[]) => Boolean(permissions?.includes('admin.read')),
}));

import { PluginProvider } from '../PluginProvider';
import { fetchPlugins } from '../api';

const fetchPluginsMock = vi.mocked(fetchPlugins);

function signInWith(permissions: string[]) {
  useAuthStore.setState({
    isAuthenticated: true,
    user: { permissions } as unknown as User,
  });
}

describe('PluginProvider bootstrap', () => {
  afterEach(() => {
    cleanup();
    fetchPluginsMock.mockClear();
    useAuthStore.setState({ isAuthenticated: false, user: null });
    usePluginStore.setState({ plugins: [], loading: false, error: null });
  });

  it('loads the plugin inventory for a signed-in user without admin.read', async () => {
    signInWith(['server.view']);
    render(
      <PluginProvider>
        <div>panel</div>
      </PluginProvider>,
    );

    await waitFor(() => expect(fetchPluginsMock).toHaveBeenCalledTimes(1));
  });

  it('does not load the inventory for a signed-out visitor', async () => {
    render(
      <PluginProvider>
        <div>panel</div>
      </PluginProvider>,
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchPluginsMock).not.toHaveBeenCalled();
  });
});
