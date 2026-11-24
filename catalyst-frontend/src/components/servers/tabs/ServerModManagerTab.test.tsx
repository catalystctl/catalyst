/**
 * ServerModManagerTab — audit D5 (one-click install) and D13 (updates badge).
 *
 * The browse list used to require: expand the card → wait for the version
 * list → open the version select → pick → click Install (6 actions for the
 * stable release that was already chosen for you). Every result card now
 * carries an Install button that installs exactly the version the expanded
 * picker would have pre-selected, and the header badge is fed by the shared
 * `['mod-updates-summary', serverId]` query instead of the installed list.
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
  categories: vi.fn(),
}));

vi.mock('../../../services/api/modManager', () => ({
  modManagerApi: api,
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

// The job/panel child has its own suite; keep this one focused.
vi.mock('./ModpackInstallPanel', () => ({
  default: () => <div data-testid="modpack-panel" />,
}));

import ServerModManagerTab from './ServerModManagerTab';

const config = {
  providers: [{ id: 'modrinth', targets: ['mods'] }],
  targets: ['mods'],
};

const project = {
  project_id: 'jei',
  title: 'Just Enough Items',
  description: 'View items and recipes',
  icon_url: '',
  downloads: 1234,
};

const stableRelease = {
  id: 'ver-stable',
  version_number: '1.0.0',
  name: '1.0.0',
  version_type: 'release',
  date_published: '2026-01-02T00:00:00Z',
};

const newerBeta = {
  id: 'ver-beta',
  version_number: '1.1.0-beta',
  name: '1.1.0-beta',
  version_type: 'beta',
  date_published: '2026-03-01T00:00:00Z',
};

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
}

function renderTab(client = makeClient()) {
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <ServerModManagerTab
          serverId="srv-1"
          serverGameVersion="1.21.1"
          modManagerConfig={config}
        />
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.search.mockResolvedValue({ hits: [project], total_hits: 1 });
  api.versions.mockResolvedValue({ data: [newerBeta, stableRelease] });
  api.install.mockResolvedValue({ path: '/mods/jei.jar' });
  api.installed.mockResolvedValue([]);
  api.checkUpdates.mockResolvedValue({ checked: 0, updatesAvailable: 0 });
  api.gameVersions.mockResolvedValue([]);
  api.categories.mockResolvedValue([]);
});

describe('ServerModManagerTab inline install (D5)', () => {
  it('installs the auto-picked stable version in one click from the result card', async () => {
    renderTab();

    // The copy key is not in the catalogs yet (the coordinator extracts it), so
    // its aria-label renders as the literal key — the card control is the only
    // element carrying it.
    const install = await screen.findByRole('button', {
      name: 'Install Just Enough Items (latest stable version)',
    });
    fireEvent.click(install);

    await waitFor(() => expect(api.install).toHaveBeenCalledTimes(1));
    // The newest version is a beta; the picker would pre-select the stable one,
    // so the quick install must too.
    expect(api.install).toHaveBeenCalledWith('srv-1', {
      provider: 'modrinth',
      game: undefined,
      projectId: 'jei',
      versionId: 'ver-stable',
      target: 'mods',
      projectName: 'Just Enough Items',
    });
  });

  it('does not expand the detail picker when the card Install is used', async () => {
    renderTab();

    const install = await screen.findByRole('button', {
      name: 'Install Just Enough Items (latest stable version)',
    });
    fireEvent.click(install);

    await waitFor(() => expect(api.install).toHaveBeenCalled());
    // Clicking Install must not also toggle the card open: the detail version
    // picker renders a "Select version" option only while expanded.
    expect(screen.queryByText('Select version')).not.toBeInTheDocument();
  });
});

describe('ServerModManagerTab updates badge (D13)', () => {
  it('badges the header from the shared summary query and seeds the tab-bar key', async () => {
    api.installed.mockResolvedValue([
      {
        name: 'jei.jar',
        size: 100,
        modifiedAt: null,
        provider: 'modrinth',
        projectId: 'jei',
        versionId: 'ver-stable',
        projectName: 'Just Enough Items',
        hasUpdate: false,
        latestVersionId: null,
        latestVersionName: null,
        updateCheckedAt: null,
      },
    ]);
    api.checkUpdates.mockResolvedValue({ checked: 1, updatesAvailable: 2 });

    const { client } = renderTab();

    expect(await screen.findByText('2 updates')).toBeInTheDocument();
    // The page tab bar reads this literal key with `enabled: false`.
    await waitFor(() =>
      expect(client.getQueryData(['mod-updates-summary', 'srv-1'])).toEqual({ updates: 2 }),
    );
  });

  it('spends no provider request on an empty mods folder', async () => {
    renderTab();
    await screen.findByText('Just Enough Items');
    await waitFor(() => expect(api.installed).toHaveBeenCalled());
    expect(api.checkUpdates).not.toHaveBeenCalled();
  });
});

describe('ServerModManagerTab keyboard visibility', () => {
  it('keeps the installed-row actions reachable by keyboard', async () => {
    api.installed.mockResolvedValue([
      {
        name: 'jei.jar',
        size: 100,
        modifiedAt: null,
        provider: 'modrinth',
        projectId: 'jei',
        versionId: 'ver-stable',
        projectName: 'Just Enough Items',
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

describe('ServerModManagerTab pagination labels', () => {
  it('names the icon-only page buttons', async () => {
    api.search.mockResolvedValue({
      hits: Array.from({ length: 12 }, (_, i) => ({ ...project, project_id: `p${i}` })),
      total_hits: 40,
    });
    renderTab();

    // Two "Previous" controls exist once paging shows (the icon pair and the
    // labelled bottom bar); the icon-only ones are titled.
    const previous = await waitFor(() => {
      const nodes = screen.getAllByTitle('Previous');
      expect(nodes.length).toBeGreaterThan(0);
      return nodes;
    });
    expect(previous[0]).toHaveAttribute('aria-label', 'Previous');
    expect(screen.getAllByTitle('Next')[0]).toHaveAttribute('aria-label', 'Next');
  });
});