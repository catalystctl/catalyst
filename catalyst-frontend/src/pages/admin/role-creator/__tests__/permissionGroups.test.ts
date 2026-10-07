import { describe, expect, it } from 'vitest';

import {
  PRESET_FILLS,
  buildPermissionGroups,
  catalogValues,
  groupPermissionValues,
  mergeSelection,
  partitionGroups,
  splitSelection,
} from '../permissionGroups';
import { FALLBACK_PERMISSION_CATEGORIES } from '../permissionCatalogFallback';

/**
 * The scoped set the backend accepts in a RoleServerGrant/RoleNodeGrant —
 * mirrors ALL_SERVER_PERMISSIONS in
 * catalyst-backend/src/lib/permissions-catalog.ts.
 */
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

describe('buildPermissionGroups', () => {
  const groups = buildPermissionGroups(FALLBACK_PERMISSION_CATEGORIES, SCOPED);
  const { resource, global } = partitionGroups(groups);

  it('keeps every catalog permission and drops the wildcard chip', () => {
    const catalog = catalogValues(FALLBACK_PERMISSION_CATEGORIES);
    const rendered = new Set(groupPermissionValues(groups));
    for (const value of catalog) {
      expect(rendered.has(value), `${value} missing from the editor`).toBe(true);
    }
    expect(rendered.has('*')).toBe(false);
  });

  it('never puts a non-scopable permission in a resource group', () => {
    const scoped = new Set(SCOPED);
    for (const group of resource) {
      for (const permission of group.permissions) {
        expect(scoped.has(permission.value), `${permission.value} is not scoped`).toBe(true);
      }
    }
  });

  it('never puts a scopable permission in a panel-wide group', () => {
    const scoped = new Set(SCOPED);
    for (const group of global) {
      for (const permission of group.permissions) {
        expect(scoped.has(permission.value), `${permission.value} is scoped`).toBe(false);
      }
    }
  });

  it('splits the servers category by scope membership', () => {
    const serverOps = resource.find((g) => g.id === 'server-operations');
    const fleet = global.find((g) => g.id === 'fleet');
    const serverOpsValues = serverOps?.permissions.map((p) => p.value) ?? [];
    const fleetValues = fleet?.permissions.map((p) => p.value) ?? [];

    // Scopable server permissions belong to the resource layer...
    expect(serverOpsValues).toContain('server.start');
    expect(serverOpsValues).toContain('server.delete');
    // ...and the two the backend cannot scope are fleet-wide only.
    expect(fleetValues.sort()).toEqual(['server.create', 'server.suspend']);
  });

  it('orders resource groups before panel-wide groups', () => {
    const kinds = groups.map((g) => g.kind);
    expect(kinds.indexOf('global')).toBeGreaterThan(kinds.lastIndexOf('resource'));
  });

  it('renders each permission exactly once', () => {
    const values = groupPermissionValues(groups);
    expect(new Set(values).size).toBe(values.length);
  });

  it('keeps plugin permissions the catalog adds under an unknown category', () => {
    const withPlugin = [
      ...FALLBACK_PERMISSION_CATEGORIES,
      {
        id: 'acme-plugin',
        label: 'Acme',
        description: '',
        permissions: [{ value: 'acme.teleport', label: 'Teleport players' }],
      },
    ];
    const pluginGroups = buildPermissionGroups(withPlugin, SCOPED);
    const other = pluginGroups.find((g) => g.id === 'other');
    expect(other?.permissions.map((p) => p.value)).toEqual(['acme.teleport']);
    // Not a scopable value, so it must be presented as panel-wide.
    expect(other?.kind).toBe('global');
  });

  it('routes a plugin permission the backend can scope into the resource layer', () => {
    const withPlugin = [
      ...FALLBACK_PERMISSION_CATEGORIES,
      {
        id: 'acme-plugin',
        label: 'Acme',
        description: '',
        permissions: [
          { value: 'acme.teleport', label: 'Teleport players' },
          { value: 'acme.hologram', label: 'Edit holograms' },
        ],
      },
    ];
    // The plugin category mixes both layers, so each value must land in the
    // section the backend would actually store it in.
    const pluginGroups = buildPermissionGroups(withPlugin, [...SCOPED, 'acme.hologram']);
    const parts = pluginGroups.filter((g) => g.id === 'other');
    expect(parts.map((g) => g.kind).sort()).toEqual(['global', 'resource']);
    expect(parts.find((g) => g.kind === 'resource')?.permissions.map((p) => p.value)).toEqual([
      'acme.hologram',
    ]);
    expect(parts.find((g) => g.kind === 'global')?.permissions.map((p) => p.value)).toEqual([
      'acme.teleport',
    ]);
  });

  it('applies a local label override', () => {
    const localized = buildPermissionGroups(
      FALLBACK_PERMISSION_CATEGORIES,
      SCOPED,
      (value) => `L:${value}`,
    );
    expect(groupPermissionValues(localized).every((v) => v.length > 0)).toBe(true);
    const labels = localized.flatMap((g) => g.permissions.map((p) => p.label));
    expect(labels).toContain('L:server.start');
  });
});

describe('splitSelection', () => {
  const resourceValues = new Set(['server.read', 'server.start', 'file.read']);

  it('sends resource permissions to the scoped grant when a boundary is set', () => {
    const selected = new Set(['server.read', 'user.read']);
    expect(splitSelection(selected, resourceValues, 'nodes')).toEqual({
      global: ['user.read'],
      scoped: ['server.read'],
    });
  });

  it('keeps resource permissions global when there is no boundary', () => {
    const selected = new Set(['server.read', 'user.read']);
    expect(splitSelection(selected, resourceValues, 'none')).toEqual({
      global: ['server.read', 'user.read'],
      scoped: [],
    });
  });

  it('handles the servers boundary the same way as nodes', () => {
    const selected = new Set(['file.read', 'admin.read']);
    expect(splitSelection(selected, resourceValues, 'servers')).toEqual({
      global: ['admin.read'],
      scoped: ['file.read'],
    });
  });
});

describe('mergeSelection', () => {
  it('unions global and scoped grants without duplicating a shared value', () => {
    const merged = mergeSelection(['server.read', 'user.read'], ['server.read', 'file.read']);
    expect([...merged].sort()).toEqual(['file.read', 'server.read', 'user.read']);
  });

  it('is empty for a role with no permissions', () => {
    expect(mergeSelection([], []).size).toBe(0);
  });
});

describe('preset fills', () => {
  it('only offers permissions the catalog actually has', () => {
    const available = catalogValues(FALLBACK_PERMISSION_CATEGORIES);
    for (const preset of PRESET_FILLS) {
      for (const value of preset.permissions) {
        expect(available.has(value), `${preset.id} offers unknown ${value}`).toBe(true);
      }
    }
  });

  it('only offers scopable permissions, so a boundary never rejects a preset', () => {
    const scoped = new Set(SCOPED);
    for (const preset of PRESET_FILLS) {
      for (const value of preset.permissions) {
        expect(scoped.has(value), `${preset.id} offers unscopable ${value}`).toBe(true);
      }
    }
  });
});

describe('fallback catalog', () => {
  it('matches the permission categories the backend serves', () => {
    // Guards the offline fallback against drift from PERMISSION_CATEGORIES.
    const ids = FALLBACK_PERMISSION_CATEGORIES.map((c) => c.id);
    expect(ids).toEqual([
      'admin', 'servers', 'nodes', 'locations', 'templates', 'users', 'roles',
      'backups', 'files', 'console', 'databases', 'alerts', 'apikeys',
      'server-content', 'operations',
    ]);
  });

  it('lists the canonical scoped permissions', () => {
    const available = catalogValues(FALLBACK_PERMISSION_CATEGORIES);
    for (const value of SCOPED) {
      expect(available.has(value), `catalog is missing ${value}`).toBe(true);
    }
  });
});
