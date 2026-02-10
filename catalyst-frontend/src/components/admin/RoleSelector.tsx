import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { rolesApi } from '../../services/api/roles';
import type { Role } from '../../types/admin';

interface RoleSelectorProps {
  selectedRoleIds: string[];
  onSelectionChange: (roleIds: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  maxDisplay?: number;
  className?: string;
}

interface RoleBadgeProps {
  role: Role;
  onRemove: () => void;
  disabled?: boolean;
}

function RoleBadge({ role, onRemove, disabled }: RoleBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
        role.name.toLowerCase() === 'administrator'
          ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
          : role.name.toLowerCase() === 'moderator'
          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
          : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
      }`}
    >
      <span>{role.name}</span>
      {!disabled && (
        <button
          onClick={onRemove}
          className="hover:bg-white/50 rounded-full w-4 h-4 flex items-center justify-center"
        >
          ×
        </button>
      )}
    </span>
  );
}

export default function RoleSelector({
  selectedRoleIds,
  onSelectionChange,
  disabled = false,
  placeholder = 'Select roles...',
  maxDisplay = 5,
  className = '',
}: RoleSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');

  // Fetch available roles
  const { data: roles = [], isLoading } = useQuery({
    queryKey: ['roles'],
    queryFn: rolesApi.list,
  });

  // Filter roles by search and exclude already selected
  const availableRoles = useMemo(() => {
    return roles.filter(
      (role) =>
        !selectedRoleIds.includes(role.id) &&
        (role.name.toLowerCase().includes(search.toLowerCase()) ||
          (role.description?.toLowerCase().includes(search.toLowerCase()) ?? false))
    );
  }, [roles, selectedRoleIds, search]);

  // Get selected role objects
  const selectedRoles = useMemo(() => {
    return roles.filter((role) => selectedRoleIds.includes(role.id));
  }, [roles, selectedRoleIds]);

  // Toggle role selection
  const toggleRole = (roleId: string) => {
    const newSelection = selectedRoleIds.includes(roleId)
      ? selectedRoleIds.filter((id) => id !== roleId)
      : [...selectedRoleIds, roleId];
    onSelectionChange(newSelection);
  };

  // Remove role
  const removeRole = (roleId: string) => {
    onSelectionChange(selectedRoleIds.filter((id) => id !== roleId));
  };

  return (
    <div className={`relative ${className}`}>
      {/* Selected Roles Display */}
      <div
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={`min-h-[40px] p-2 border rounded-md bg-background cursor-pointer ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-primary'
        }`}
      >
        {selectedRoles.length === 0 ? (
          <span className="text-muted-foreground">{placeholder}</span>
        ) : (
          <div className="flex flex-wrap gap-2">
            {selectedRoles.slice(0, maxDisplay).map((role) => (
              <RoleBadge
                key={role.id}
                role={role}
                onRemove={(e) => {
                  e.stopPropagation();
                  removeRole(role.id);
                }}
                disabled={disabled}
              />
            ))}
            {selectedRoles.length > maxDisplay && (
              <span className="text-xs text-muted-foreground">
                +{selectedRoles.length - maxDisplay} more
              </span>
            )}
          </div>
        )}
      </div>

      {/* Dropdown */}
      {isOpen && !disabled && (
        <div className="absolute z-10 w-full mt-1 bg-background border rounded-md shadow-lg max-h-60 overflow-auto">
          {/* Search */}
          <div className="p-2 border-b">
            <input
              type="text"
              placeholder="Search roles..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-3 py-2 text-sm border rounded-md bg-background"
              autoFocus
            />
          </div>

          {/* Role List */}
          {isLoading ? (
            <div className="p-4 text-center text-muted-foreground text-sm">
              Loading roles...
            </div>
          ) : availableRoles.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground text-sm">
              {search ? 'No roles found' : 'All roles are selected'}
            </div>
          ) : (
            <div>
              {availableRoles.map((role) => (
                <button
                  key={role.id}
                  onClick={() => {
                    toggleRole(role.id);
                    if (search) setSearch('');
                  }}
                  className="w-full px-3 py-2 text-left hover:bg-muted flex items-center justify-between"
                >
                  <div>
                    <div className="font-medium">{role.name}</div>
                    {role.description && (
                      <div className="text-xs text-muted-foreground">{role.description}</div>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {role.permissions?.length || 0} perms
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
