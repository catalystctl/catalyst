/**
 * Plugin-exposed user permissions (role editor catalog).
 *
 * `manifest.permissions` is the plugin's own capability list and must never
 * leak into role assignments; `manifest.userPermissions` is the role-facing
 * list. These tests pin that separation, the enabled-only rule, and the
 * manifest validation that keeps a plugin from exposing the wildcard.
 */

import { describe, it, expect } from 'vitest';
import { PluginManifestSchema } from '../validator.js';
import { buildPluginPermissionCategory } from '../custom-permissions.js';

const baseManifest = {
  name: 'test-plugin',
  version: '1.0.0',
  displayName: 'Test Plugin',
  description: 'A test',
  author: 'Someone',
  catalystVersion: '>=1.0.0',
  permissions: ['server.read'],
};

function loader(plugins: any[]) {
  return { getRegistry: () => ({ getAll: () => plugins }) };
}

function plugin(manifest: Record<string, any>, status = 'enabled') {
  return { status, manifest: { ...baseManifest, ...manifest } };
}

describe('buildPluginPermissionCategory', () => {
  it('lists declared user permissions of enabled plugins', () => {
    const category = buildPluginPermissionCategory(
      loader([
        plugin({
          name: 'tickets',
          displayName: 'Tickets',
          userPermissions: [
            { id: 'tickets.view', label: 'View the ticket queue' },
            { id: 'tickets.reply', label: 'Reply to tickets', description: 'Also emails.' },
          ],
        }),
      ]),
    );

    expect(category).not.toBeNull();
    expect(category!.id).toBe('plugins');
    expect(category!.permissions).toEqual([
      { value: 'tickets.reply', label: 'Reply to tickets' },
      { value: 'tickets.view', label: 'View the ticket queue' },
    ]);
  });

  it('ignores the plugin capability list (separate namespace)', () => {
    const category = buildPluginPermissionCategory(
      loader([
        plugin({
          userPermissions: [{ id: 'sample.view', label: 'View' }],
          permissions: ['server.read', 'my-plugin.sample'],
        }),
      ]),
    );

    expect(category!.permissions.map((p) => p.value)).toEqual(['sample.view']);
  });

  it('skips built-in tokens a plugin also exposes', () => {
    const category = buildPluginPermissionCategory(
      loader([
        plugin({
          userPermissions: [
            { id: 'server.read', label: 'Redundant built-in' },
            { id: 'sample.view', label: 'View' },
          ],
        }),
      ]),
    );

    expect(category!.permissions.map((p) => p.value)).toEqual(['sample.view']);
  });

  it('skips disabled plugins and plugins without user permissions', () => {
    expect(
      buildPluginPermissionCategory(
        loader([plugin({ userPermissions: [{ id: 'a.view', label: 'A' }] }, 'disabled')]),
      ),
    ).toBeNull();
    expect(buildPluginPermissionCategory(loader([plugin({})]))).toBeNull();
  });

  it('deduplicates ids across plugins, first label wins', () => {
    const category = buildPluginPermissionCategory(
      loader([
        plugin({ name: 'one', userPermissions: [{ id: 'shared.view', label: 'From one' }] }),
        plugin({ name: 'two', userPermissions: [{ id: 'shared.view', label: 'From two' }] }),
      ]),
    );

    expect(category!.permissions).toEqual([{ value: 'shared.view', label: 'From one' }]);
  });

  it('falls back to the plugin name when a label is missing', () => {
    const category = buildPluginPermissionCategory(
      loader([
        plugin({
          name: 'tickets',
          displayName: 'Tickets',
          userPermissions: [{ id: 'tickets.view', label: '' }],
        }),
      ]),
    );

    expect(category!.permissions[0].label).toBe('Tickets (tickets)');
  });

  it('returns null without a loader', () => {
    expect(buildPluginPermissionCategory(null)).toBeNull();
    expect(buildPluginPermissionCategory(undefined)).toBeNull();
  });
});

describe('PluginManifestSchema userPermissions', () => {
  it('accepts entries with and without a description', () => {
    const result = PluginManifestSchema.parse({
      ...baseManifest,
      userPermissions: [
        { id: 'sample.view', label: 'View the widget' },
        { id: 'sample.manage', label: 'Manage', description: 'Change the widget.' },
      ],
    });

    expect(result.userPermissions).toHaveLength(2);
  });

  it('rejects the wildcard permission', () => {
    expect(() =>
      PluginManifestSchema.parse({
        ...baseManifest,
        userPermissions: [{ id: '*', label: 'Everything' }],
      }),
    ).toThrow();
  });

  it('rejects duplicate ids and malformed ids', () => {
    expect(() =>
      PluginManifestSchema.parse({
        ...baseManifest,
        userPermissions: [
          { id: 'sample.view', label: 'One' },
          { id: 'sample.view', label: 'Two' },
        ],
      }),
    ).toThrow(/Duplicate/);

    expect(() =>
      PluginManifestSchema.parse({
        ...baseManifest,
        userPermissions: [{ id: 'not a token', label: 'Bad' }],
      }),
    ).toThrow();
  });

  it('rejects an oversized label', () => {
    expect(() =>
      PluginManifestSchema.parse({
        ...baseManifest,
        userPermissions: [{ id: 'sample.view', label: 'x'.repeat(65) }],
      }),
    ).toThrow();
  });
});
