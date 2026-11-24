/**
 * ServerPluginManagerTab — audit D5 (one-click install).
 *
 * Same rule as the mods tab: a result card installs the version the expanded
 * picker would have pre-selected (stable first, else newest), so the common
 * "current stable release" path is one click. The detail picker stays for
 * choosing a specific version.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@/csync';

const api = vi.hoisted(() => ({
  search: vi.fn(),
  versions: vi.fn(),
  install: vi.fn(),
  installed: vi.fn(),
  uninstall: vi.fn(),
  checkUpdates: vi.fn(),
  update: vi.fn(),
  gameVersions: vi.fn(),
}));

vi.mock('../../../services/api/pluginManager', () => ({
  pluginManagerApi: api,
}));

vi.mock('../../../services/api/providerKeys', () => ({
  providerKeysApi: { status: vi.fn().mockResolvedValue({ modrinth: true, curseforge: true }) },
  providerKeyConfigured: () => true,
}));

vi.mock('../../../utils/notify', () => ({
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
}));

vi.mock('../../../services/api/systemErrors', () => ({
  reportSystemError: vi.fn(),
}));

import ServerPluginManagerTab from './ServerPluginManagerTab';

const config = { providers: ['modrinth', 'spiget'] };

const plugin = {
  project_id: 'essentialsx',
  slug: 'essentialsx',
  title: 'EssentialsX',
  description: 'The essential plugin suite',
  icon_url: '',
  downloads: 5000,
};

const stableRelease = {
  id: 'v-stable',
  version_number: '2.20.1',
  name: '2.20.1',
  version_type: 'release',
  game_versions: ['1.21.1'],
  date_published: '2026-01-02T00:00:00Z',
};

const newerBeta = {
  id: 'v-beta',
  version_number: '2.21.0-beta',
  name: '2.21.0-beta',
  version_type: 'beta',
  game_versions: ['1.21.1'],
  date_published: '2026-03-01T00:00:00Z',
};

function renderTab() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <ServerPluginManagerTab
          serverId="srv-1"
          serverGameVersion="1.21.1"
          pluginManagerConfig={config}
        />
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.search.mockResolvedValue({ hits: [plugin], total_hits: 1 });
  api.versions.mockResolvedValue({ data: [newerBeta, stableRelease] });
  api.install.mockResolvedValue({ path: '/plugins/EssentialsX.jar' });
  api.installed.mockResolvedValue([]);
  api.checkUpdates.mockResolvedValue({ checked: 0, updatesAvailable: 0 });
  api.gameVersions.mockResolvedValue([]);
});

describe('ServerPluginManagerTab inline install (D5)', () => {
  it('installs the auto-picked stable version in one click from the result card', async () => {
    renderTab();

    // The copy key is not in the catalogs yet (the coordinator extracts it), so
    // the card control is the only element carrying it as its title.
    const install = await screen.findByRole('button', {
      name: 'Install EssentialsX (latest stable version)',
    });
    fireEvent.click(install);

    await waitFor(() => expect(api.install).toHaveBeenCalledTimes(1));
    expect(api.install).toHaveBeenCalledWith('srv-1', {
      provider: 'modrinth',
      projectId: 'essentialsx',
      versionId: 'v-stable',
      projectName: 'EssentialsX',
    });
  });

  it('reports a failure instead of installing a blank version', async () => {
    api.versions.mockResolvedValue({ data: [] });
    renderTab();

    const install = await screen.findByRole('button', {
      name: 'Install EssentialsX (latest stable version)',
    });
    fireEvent.click(install);

    await waitFor(() => expect(api.versions).toHaveBeenCalled());
    // No version to install: the request must not be sent at all.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(api.install).not.toHaveBeenCalled();
  });

  it('keeps the installed-row actions reachable by keyboard', async () => {
    api.installed.mockResolvedValue([
      {
        name: 'EssentialsX.jar',
        size: 200,
        modifiedAt: null,
        provider: 'modrinth',
        projectId: 'essentialsx',
        versionId: 'v-stable',
        projectName: 'EssentialsX',
        hasUpdate: false,
        latestVersionId: null,
        latestVersionName: null,
        updateCheckedAt: null,
      },
    ]);
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: /^Installed/ }));

    const remove = await screen.findByTitle('Remove');
    const actions = remove.parentElement!;
    expect(actions.className).toContain('group-focus-within:opacity-100');
    expect(actions.className).toContain('focus-visible:opacity-100');
  });
});