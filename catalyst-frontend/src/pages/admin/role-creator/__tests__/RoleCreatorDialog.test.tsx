import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import type { CatalogCategory } from '../permissionGroups';
import { FALLBACK_PERMISSION_CATEGORIES } from '../permissionCatalogFallback';

/** Scoped set the backend accepts in a grant (ALL_SERVER_PERMISSIONS). */
const SCOPED = [
  'server.read', 'server.start', 'server.stop', 'server.kill',
  'server.install', 'server.reinstall', 'server.rebuild', 'server.update',
  'server.network', 'server.storage', 'server.archive', 'server.migrate',
  'server.transfer', 'server.delete', 'server.schedule', 'server.clone',
  'console.read', 'console.write',
  'file.read', 'file.write',
  'backup.read', 'backup.create', 'backup.restore', 'backup.delete', 'backup.download',
  'database.read', 'database.create', 'database.rotate', 'database.delete',
  'alert.read', 'alert.create', 'alert.update', 'alert.delete',
  'mods.manage', 'plugins.manage',
];

let catalog: CatalogCategory[] = FALLBACK_PERMISSION_CATEGORIES;
let scopedValues: string[] = SCOPED;

vi.mock('react-i18next', () => ({
  // Keys render as-is: assertions then pin the key a string comes from.
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('@/csync', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = String(queryKey?.[0] ?? '');
    if (key === 'role-permissions-catalog') return { data: catalog };
    if (key === 'server-permissions') return { data: scopedValues };
    if (key === 'nodes') {
      return {
        data: [
          { id: 'node-1', name: 'Primary node', hostname: 'GRA-EU-01' },
          { id: 'node-2', name: 'US East', hostname: 'VIN-US-02' },
        ],
      };
    }
    if (key === 'admin-servers-for-scope') {
      return {
        data: [
          { id: 'srv-1', name: 'Survival SMP', primaryPort: 25565, node: { name: 'Primary node' } },
          { id: 'srv-2', name: 'Creative', primaryPort: 25566, node: { name: 'Primary node' } },
        ],
      };
    }
    return { data: undefined };
  },
}));
vi.mock('@/services/api/roles', () => ({
  rolesApi: { getPermissionCatalog: vi.fn() },
}));
vi.mock('@/services/api/servers', () => ({
  serversApi: { list: vi.fn() },
}));
vi.mock('@/components/admin/NodeAssignmentsSelector', () => ({
  // The real selector owns its own API calls; the editor only mirrors it.
  NodeAssignmentsSelector: ({ roleId }: { roleId?: string }) => (
    <div data-testid="node-assignments" data-role-id={roleId ?? ''} />
  ),
}));
vi.mock('@/hooks/useNodes', () => ({
  useNodes: () => ({
    data: [
      { id: 'node-1', name: 'Primary node', hostname: 'GRA-EU-01' },
      { id: 'node-2', name: 'US East', hostname: 'VIN-US-02' },
    ],
  }),
}));
vi.mock('@/lib/serverPermissions', () => ({
  useServerPermissionOptions: () => ({ data: scopedValues }),
}));

import { RoleCreatorDialog } from '../RoleCreatorDialog';

beforeEach(() => {
  catalog = FALLBACK_PERMISSION_CATEGORIES;
  scopedValues = SCOPED;
});

afterEach(cleanup);

function renderDialog(props: Partial<React.ComponentProps<typeof RoleCreatorDialog>> = {}) {
  const onSubmit = vi.fn();
  render(
    <RoleCreatorDialog
      open
      onOpenChange={vi.fn()}
      role={null}
      onSubmit={onSubmit}
      {...props}
    />,
  );
  return { onSubmit };
}

/** Chip button for a permission value, matched by its catalog label. */
function chip(label: string): HTMLElement {
  return screen.getByRole('button', { name: label });
}

describe('RoleCreatorDialog', () => {
  it('renders the real catalog rather than example data', () => {
    renderDialog();
    // A permission from each layer, straight out of the backend catalog.
    expect(chip('roles.permissionLabels.serverStart')).toBeInTheDocument();
    expect(chip('roles.permissionLabels.nodeRead')).toBeInTheDocument();
    expect(chip('roles.permissionLabels.migrationManage')).toBeInTheDocument();
    // The wildcard is a switch, never a chip.
    expect(screen.queryByRole('button', { name: 'Super Admin (all permissions)' })).toBeNull();
  });

  it('keeps resource and panel-wide permissions in separate sections', () => {
    renderDialog();
    const resource = screen.getByTestId('permission-section-resource');
    const global = screen.getByTestId('permission-section-global');

    expect(
      within(resource).getByRole('button', { name: 'roles.permissionLabels.serverStart' }),
    ).toBeInTheDocument();
    // node.read is panel-wide, so it must not appear under resource permissions.
    expect(
      within(resource).queryByRole('button', { name: 'roles.permissionLabels.nodeRead' }),
    ).toBeNull();
    expect(
      within(global).getByRole('button', { name: 'roles.permissionLabels.nodeRead' }),
    ).toBeInTheDocument();
  });

  it('submits panel-wide permissions with no boundary as global grants', () => {
    const { onSubmit } = renderDialog();
    fireEvent.change(screen.getByPlaceholderText('roles.namePlaceholder'), {
      target: { value: 'Game Operations' },
    });
    fireEvent.click(chip('roles.permissionLabels.serverStart'));
    fireEvent.click(chip('roles.permissionLabels.nodeRead'));
    fireEvent.click(screen.getByRole('button', { name: 'roles.createTitle' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      name: 'Game Operations',
      permissions: ['node.read', 'server.start'],
      scope: { mode: 'none', permissions: [] },
    });
  });

  it('moves resource permissions into the scope payload once a boundary is set', () => {
    const { onSubmit } = renderDialog();
    fireEvent.change(screen.getByPlaceholderText('roles.namePlaceholder'), {
      target: { value: 'Node operators' },
    });
    fireEvent.click(screen.getByRole('button', { name: /roles.creator.boundary.nodesTitle/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Primary node/ }));
    fireEvent.click(chip('roles.permissionLabels.serverStart'));
    fireEvent.click(chip('roles.permissionLabels.nodeRead'));
    fireEvent.click(screen.getByRole('button', { name: 'roles.createTitle' }));

    const payload = onSubmit.mock.calls[0][0];
    expect(payload.permissions).toEqual(['node.read']);
    expect(payload.scope).toMatchObject({
      mode: 'nodes',
      nodeIds: ['node-1'],
      permissions: ['server.start'],
    });
  });

  it('stores "entire panel" as the all-nodes wildcard', () => {
    const { onSubmit } = renderDialog();
    fireEvent.change(screen.getByPlaceholderText('roles.namePlaceholder'), {
      target: { value: 'Fleet' },
    });
    fireEvent.click(screen.getByRole('button', { name: /roles.creator.boundary.allTitle/ }));
    fireEvent.click(chip('roles.permissionLabels.serverRead'));
    fireEvent.click(screen.getByRole('button', { name: 'roles.createTitle' }));

    expect(onSubmit.mock.calls[0][0].scope).toMatchObject({
      mode: 'nodes',
      nodeIds: ['*'],
      permissions: ['server.read'],
    });
  });

  it('scopes to specific servers', () => {
    const { onSubmit } = renderDialog();
    fireEvent.change(screen.getByPlaceholderText('roles.namePlaceholder'), {
      target: { value: 'Server owners' },
    });
    fireEvent.click(screen.getByRole('button', { name: /roles.creator.boundary.serversTitle/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Survival SMP/ }));
    fireEvent.click(chip('roles.permissionLabels.fileRead'));
    fireEvent.click(screen.getByRole('button', { name: 'roles.createTitle' }));

    expect(onSubmit.mock.calls[0][0].scope).toMatchObject({
      mode: 'servers',
      serverIds: ['srv-1'],
      permissions: ['file.read'],
    });
  });

  it('blocks submit until a boundary has at least one target', () => {
    renderDialog();
    fireEvent.change(screen.getByPlaceholderText('roles.namePlaceholder'), {
      target: { value: 'Incomplete' },
    });
    fireEvent.click(chip('roles.permissionLabels.serverRead'));
    fireEvent.click(screen.getByRole('button', { name: /roles.creator.boundary.nodesTitle/ }));

    expect(screen.getByRole('button', { name: 'roles.createTitle' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Primary node/ }));
    expect(screen.getByRole('button', { name: 'roles.createTitle' })).toBeEnabled();
  });

  it('blocks a boundary with no scoped permission', () => {
    renderDialog();
    fireEvent.change(screen.getByPlaceholderText('roles.namePlaceholder'), {
      target: { value: 'Scopeless' },
    });
    fireEvent.click(screen.getByRole('button', { name: /roles.creator.boundary.allTitle/ }));
    // Only a panel-wide permission is selected, so the grant would be empty.
    fireEvent.click(chip('roles.permissionLabels.nodeRead'));
    expect(screen.getByRole('button', { name: 'roles.createTitle' })).toBeDisabled();

    fireEvent.click(chip('roles.permissionLabels.serverRead'));
    expect(screen.getByRole('button', { name: 'roles.createTitle' })).toBeEnabled();
  });

  it('grants the wildcard and clears the boundary when the super-admin switch is on', () => {
    const { onSubmit } = renderDialog();
    fireEvent.change(screen.getByPlaceholderText('roles.namePlaceholder'), {
      target: { value: 'Admin' },
    });
    fireEvent.click(screen.getByRole('button', { name: /roles.creator.boundary.allTitle/ }));
    fireEvent.click(chip('roles.permissionLabels.serverRead'));
    fireEvent.click(screen.getByRole('button', { name: /roles.wildcard/ }));
    fireEvent.click(screen.getByRole('button', { name: 'roles.createTitle' }));

    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      permissions: ['*'],
      scope: { mode: 'none', permissions: [] },
    });
  });

  it('prefills an existing role from its stored scope', () => {
    renderDialog({
      role: {
        id: 'role-1',
        name: 'Node operators',
        description: 'Runs the game servers',
        permissions: ['node.read'],
        scope: { mode: 'nodes', nodeIds: ['node-1'], permissions: ['server.start'] },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    });

    expect(screen.getByDisplayValue('Node operators')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Runs the game servers')).toBeInTheDocument();
    // The stored scoped permission is selected again, in the resource layer.
    expect(chip('roles.permissionLabels.serverStart')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('roles.permissionLabels.nodeRead')).toHaveAttribute('aria-pressed', 'true');
    // The node grant is restored, not re-derived.
    expect(screen.getByRole('checkbox', { name: /Primary node/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('reads "entire panel" back out of the all-nodes wildcard', () => {
    renderDialog({
      role: {
        id: 'role-2',
        name: 'Fleet',
        permissions: [],
        scope: { mode: 'nodes', nodeIds: ['*'], permissions: ['server.read'] },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    });
    expect(
      screen.getByRole('button', { name: /roles.creator.boundary.allTitle/ }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('applies a backend preset to the selection', () => {
    renderDialog({
      presets: [
        { key: 'support', label: 'Support', permissions: ['server.read', 'file.read'] },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'roles.presets.support' }));
    expect(chip('roles.permissionLabels.serverRead')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('roles.permissionLabels.fileRead')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('roles.permissionLabels.serverStop')).toHaveAttribute('aria-pressed', 'false');
  });

  it('filters the permission list by label', () => {
    renderDialog();
    fireEvent.change(screen.getByPlaceholderText('roles.creator.searchPermissions'), {
      target: { value: 'roles.permissionLabels.serverStart' },
    });
    expect(chip('roles.permissionLabels.serverStart')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'roles.permissionLabels.nodeRead' })).toBeNull();
  });

  it('offers node-access management for a saved role, and explains the deferral when creating', () => {
    renderDialog({
      role: {
        id: 'role-9',
        name: 'Saved role',
        permissions: ['server.read'],
        scope: { mode: 'none', permissions: [] },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    });
    expect(screen.getByTestId('node-assignments')).toHaveAttribute('data-role-id', 'role-9');
  });

  it('defers node-access assignment until the role exists', () => {
    renderDialog({ role: null });
    expect(screen.queryByTestId('node-assignments')).toBeNull();
    expect(screen.getByText('roles.creator.nodeAccessCreateHint')).toBeInTheDocument();
  });

  it('demotes a super-admin role instead of silently re-asserting the wildcard', () => {
    const { onSubmit } = renderDialog({
      role: {
        id: 'role-admin',
        name: 'Admins',
        permissions: ['*'],
        scope: { mode: 'none', permissions: [] },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    });
    // The wildcard switch starts on and has no chip of its own.
    expect(screen.getByRole('button', { name: /roles.wildcard/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Turning the switch off reveals the permission groups.
    fireEvent.click(screen.getByRole('button', { name: /roles.wildcard/ }));
    expect(screen.getByRole('button', { name: /roles.wildcard/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    fireEvent.click(chip('roles.permissionLabels.serverRead'));
    fireEvent.click(screen.getByRole('button', { name: 'roles.saveChanges' }));

    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      permissions: ['server.read'],
      scope: { mode: 'none', permissions: [] },
    });
  });

  it('keeps the wildcard when only the switch itself is turned off', () => {
    const { onSubmit } = renderDialog({
      role: {
        id: 'role-admin-2',
        name: 'Admins',
        permissions: ['*', 'server.read'],
        scope: { mode: 'none', permissions: [] },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /roles.wildcard/ }));
    // The concrete permission survives; only the wildcard is dropped.
    expect(chip('roles.permissionLabels.serverRead')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'roles.saveChanges' }));
    expect(onSubmit.mock.calls[0][0].permissions).toEqual(['server.read']);
  });

  it('routes the wildcard preset to the super-admin switch', () => {
    renderDialog({
      presets: [{ key: 'administrator', label: 'Administrator', permissions: ['*'] }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'roles.presets.administrator' }));
    expect(screen.getByRole('button', { name: /roles.wildcard/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('does not discard in-progress edits when the same role object is replaced', () => {
    const role = {
      id: 'role-3',
      name: 'Original',
      permissions: ['server.read'],
      scope: { mode: 'none' as const, permissions: [] },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const onSubmit = vi.fn();
    const view = render(
      <RoleCreatorDialog open onOpenChange={vi.fn()} role={role} onSubmit={onSubmit} />,
    );
    fireEvent.change(screen.getByDisplayValue('Original'), {
      target: { value: 'Renamed by hand' },
    });
    // A list refetch hands the dialog a fresh object for the same role.
    view.rerender(
      <RoleCreatorDialog
        open
        onOpenChange={vi.fn()}
        role={{ ...role, name: 'Original' }}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByDisplayValue('Renamed by hand')).toBeInTheDocument();
  });

  it('merges the stored scope in when the detail arrives after the list row', () => {
    // The roles list payload omits `scope`; RolesPage passes the row first and
    // the fetched detail second. Edits made in between must survive.
    const listRow = {
      id: 'role-4',
      name: 'Node operators',
      permissions: ['node.read'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };    const onSubmit = vi.fn();
    const view = render(
      <RoleCreatorDialog open onOpenChange={vi.fn()} role={listRow} onSubmit={onSubmit} />,
    );

    // The row has no scope yet: boundary defaults to "panel administration"
    // and the user has already renamed the role.
    expect(
      screen.getByRole('button', { name: /roles.creator.boundary.panelTitle/ }),
    ).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(screen.getByDisplayValue('Node operators'), {
      target: { value: 'Renamed while loading' },
    });

    view.rerender(
      <RoleCreatorDialog
        open
        onOpenChange={vi.fn()}
        role={{
          ...listRow,
          scope: { mode: 'nodes', nodeIds: ['node-1'], permissions: ['server.start'] },
        }}
        onSubmit={onSubmit}
      />,
    );

    // The stored boundary and scoped grant are restored…
    expect(
      screen.getByRole('button', { name: /roles.creator.boundary.nodesTitle/ }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('checkbox', { name: /Primary node/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(chip('roles.permissionLabels.serverStart')).toHaveAttribute('aria-pressed', 'true');
    // …and the in-flight edit was not discarded.
    expect(screen.getByDisplayValue('Renamed while loading')).toBeInTheDocument();
  });

  it('applies the late-arriving scope exactly once', () => {
    const detail = {
      id: 'role-5',
      name: 'Fleet',
      permissions: [],
      scope: { mode: 'nodes' as const, nodeIds: ['*'], permissions: ['server.read'] },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const onSubmit = vi.fn();
    const view = render(
      <RoleCreatorDialog
        open
        onOpenChange={vi.fn()}
        role={{
          id: detail.id,
          name: detail.name,
          permissions: [],
          createdAt: detail.createdAt,
          updatedAt: detail.updatedAt,
        }}
        onSubmit={onSubmit}
      />,
    );
    view.rerender(
      <RoleCreatorDialog open onOpenChange={vi.fn()} role={detail} onSubmit={onSubmit} />,
    );
    expect(
      screen.getByRole('button', { name: /roles.creator.boundary.allTitle/ }),
    ).toHaveAttribute('aria-pressed', 'true');

    // A further rerender with the same detail (refetch) must not reset state —
    // deselecting a chip stays deselected.
    fireEvent.click(chip('roles.permissionLabels.serverRead'));
    view.rerender(
      <RoleCreatorDialog open onOpenChange={vi.fn()} role={{ ...detail }} onSubmit={onSubmit} />,
    );
    expect(
      screen.getByRole('button', { name: /roles.creator.boundary.allTitle/ }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(chip('roles.permissionLabels.serverRead')).toHaveAttribute('aria-pressed', 'false');
  });

  it('surfaces plugin permissions the shipped catalog does not know', () => {
    catalog = [
      ...FALLBACK_PERMISSION_CATEGORIES,
      {
        id: 'acme',
        label: 'Acme',
        description: '',
        permissions: [{ value: 'acme.teleport', label: 'Teleport players' }],
      },
    ];
    renderDialog();
    expect(chip('Teleport players')).toBeInTheDocument();
  });
});
