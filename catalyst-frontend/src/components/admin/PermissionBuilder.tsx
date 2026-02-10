import { useMemo, useState } from 'react';
import type { PermissionCategory } from '../../types/admin';

// Permission categories for organization
export const PERMISSION_CATEGORIES: PermissionCategory[] = [
  {
    label: 'Server',
    permissions: [
      'server.read',
      'server.create',
      'server.start',
      'server.stop',
      'server.delete',
      'server.suspend',
      'server.transfer',
      'server.schedule',
    ],
  },
  {
    label: 'Node',
    permissions: [
      'node.read',
      'node.create',
      'node.update',
      'node.delete',
      'node.view_stats',
      'node.manage_allocation',
    ],
  },
  {
    label: 'Location',
    permissions: [
      'location.read',
      'location.create',
      'location.update',
      'location.delete',
    ],
  },
  {
    label: 'Template',
    permissions: [
      'template.read',
      'template.create',
      'template.update',
      'template.delete',
    ],
  },
  {
    label: 'User Management',
    permissions: [
      'user.read',
      'user.create',
      'user.update',
      'user.delete',
      'user.ban',
      'user.unban',
      'user.set_roles',
    ],
  },
  {
    label: 'Role Management',
    permissions: [
      'role.read',
      'role.create',
      'role.update',
      'role.delete',
    ],
  },
  {
    label: 'Backup',
    permissions: [
      'backup.read',
      'backup.create',
      'backup.delete',
      'backup.restore',
    ],
  },
  {
    label: 'File Management',
    permissions: ['file.read', 'file.write'],
  },
  {
    label: 'Console',
    permissions: ['console.read', 'console.write'],
  },
  {
    label: 'Database',
    permissions: [
      'database.create',
      'database.read',
      'database.delete',
      'database.rotate',
    ],
  },
  {
    label: 'Alerts',
    permissions: [
      'alert.read',
      'alert.create',
      'alert.update',
      'alert.delete',
    ],
  },
  {
    label: 'System Administration',
    permissions: ['admin.read', 'admin.write', 'apikey.manage'],
  },
];

// Permission presets for quick setup
export const PERMISSION_PRESETS = [
  {
    key: 'administrator',
    label: 'Administrator',
    description: 'Full system access',
    permissions: ['*'],
  },
  {
    key: 'moderator',
    label: 'Moderator',
    description: 'Can manage most resources but not users/roles',
    permissions: [
      'node.read',
      'node.update',
      'node.view_stats',
      'location.read',
      'template.read',
      'user.read',
      'server.read',
      'server.start',
      'server.stop',
      'file.read',
      'file.write',
      'console.read',
      'console.write',
      'alert.read',
      'alert.create',
      'alert.update',
      'alert.delete',
    ],
  },
  {
    key: 'user',
    label: 'User',
    description: 'Basic access to own servers',
    permissions: ['server.read'],
  },
  {
    key: 'support',
    label: 'Support',
    description: 'Read-only access for support staff',
    permissions: [
      'node.read',
      'node.view_stats',
      'location.read',
      'template.read',
      'server.read',
      'file.read',
      'console.read',
      'alert.read',
      'user.read',
    ],
  },
];

interface PermissionBuilderProps {
  selectedPermissions: Set<string>;
  onTogglePermission: (permission: string) => void;
  onApplyPreset?: (preset: typeof PERMISSION_PRESETS[0]) => void;
  disabled?: boolean;
  showPresets?: boolean;
  className?: string;
}

function formatPermission(permission: string): string {
  if (permission === '*') return '* (All Permissions)';
  return permission
    .split('.')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export default function PermissionBuilder({
  selectedPermissions,
  onTogglePermission,
  onApplyPreset,
  disabled = false,
  showPresets = true,
  className = '',
}: PermissionBuilderProps) {
  const [search, setSearch] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(PERMISSION_CATEGORIES.map((c) => c.label))
  );

  // Toggle category expansion
  const toggleCategory = (category: string) => {
    const newSet = new Set(expandedCategories);
    if (newSet.has(category)) {
      newSet.delete(category);
    } else {
      newSet.add(category);
    }
    setExpandedCategories(newSet);
  };

  // Select all permissions in a category
  const selectCategory = (category: PermissionCategory) => {
    for (const perm of category.permissions) {
      if (!selectedPermissions.has(perm)) {
        onTogglePermission(perm);
      }
    }
  };

  // Deselect all permissions in a category
  const deselectCategory = (category: PermissionCategory) => {
    for (const perm of category.permissions) {
      if (selectedPermissions.has(perm)) {
        onTogglePermission(perm);
      }
    }
  };

  // Filter categories by search
  const filteredCategories = useMemo(() => {
    const searchLower = search.toLowerCase();
    return PERMISSION_CATEGORIES.map((category) => ({
      ...category,
      permissions: category.permissions.filter((p) =>
        p.toLowerCase().includes(searchLower) || category.label.toLowerCase().includes(searchLower)
      ),
    })).filter((category) => category.permissions.length > 0);
  }, [search]);

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Presets */}
      {showPresets && onApplyPreset && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Quick Start</label>
          <div className="flex flex-wrap gap-2">
            {PERMISSION_PRESETS.map((preset) => (
              <button
                key={preset.key}
                onClick={() => onApplyPreset(preset)}
                disabled={disabled}
                className="px-3 py-1.5 text-sm border rounded-md hover:bg-muted disabled:opacity-50"
              >
                <span className="font-medium">{preset.label}</span>
                <span className="text-muted-foreground ml-1">({preset.permissions.length})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Search */}
      <div>
        <input
          type="text"
          placeholder="Search permissions..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          disabled={disabled}
          className="w-full px-3 py-2 text-sm border rounded-md bg-background"
        />
      </div>

      {/* Selected count */}
      <div className="text-sm text-muted-foreground">
        {selectedPermissions.size} permission{selectedPermissions.size !== 1 ? 's' : ''} selected
      </div>

      {/* Permission categories */}
      <div className="space-y-3 max-h-96 overflow-y-auto">
        {filteredCategories.map((category) => {
          const isExpanded = expandedCategories.has(category.label);
          const categorySelectedCount = category.permissions.filter((p) =>
            selectedPermissions.has(p)
          ).length;
          const allSelected = categorySelectedCount === category.permissions.length;

          return (
            <div key={category.label} className="border rounded-lg overflow-hidden">
              <button
                onClick={() => toggleCategory(category.label)}
                disabled={disabled}
                className="w-full flex items-center justify-between p-3 hover:bg-muted/50 disabled:opacity-50"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`transform transition-transform ${
                      isExpanded ? 'rotate-90' : ''
                    }`}
                  >
                    ▶
                  </span>
                  <span className="font-medium">{category.label}</span>
                  <span className="text-sm text-muted-foreground">
                    {categorySelectedCount}/{category.permissions.length}
                  </span>
                </div>
                <div className="flex gap-2">
                  {!allSelected && categorySelectedCount > 0 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        selectCategory(category);
                      }}
                      disabled={disabled}
                      className="text-xs px-2 py-1 rounded hover:bg-muted disabled:opacity-50"
                    >
                      Select All
                    </button>
                  )}
                  {categorySelectedCount > 0 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deselectCategory(category);
                      }}
                      disabled={disabled}
                      className="text-xs px-2 py-1 rounded hover:bg-muted disabled:opacity-50"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </button>

              {isExpanded && (
                <div className="p-3 pt-0 border-t grid grid-cols-2 gap-2">
                  {category.permissions.map((permission) => (
                    <label
                      key={permission}
                      className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                        selectedPermissions.has(permission)
                          ? 'bg-primary/10 border border-primary/20'
                          : 'hover:bg-muted'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedPermissions.has(permission)}
                        onChange={() => onTogglePermission(permission)}
                        disabled={disabled}
                        className="rounded"
                      />
                      <span className="text-sm">{formatPermission(permission)}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Wildcard permission */}
        <label
          className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
            selectedPermissions.has('*')
              ? 'bg-yellow-500/10 border-yellow-500/20'
              : 'hover:bg-muted'
          }`}
        >
          <input
            type="checkbox"
            checked={selectedPermissions.has('*')}
            onChange={() => onTogglePermission('*')}
            disabled={disabled}
            className="rounded"
          />
          <div>
            <div className="font-medium text-yellow-600 dark:text-yellow-400">
              Wildcard Permission (*)
            </div>
            <div className="text-xs text-muted-foreground">
              Grants all permissions. Use with caution.
            </div>
          </div>
        </label>
      </div>
    </div>
  );
}

export { PERMISSION_PRESETS };
