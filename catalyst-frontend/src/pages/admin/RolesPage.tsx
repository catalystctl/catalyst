import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { motion, type Variants } from 'framer-motion';
import {
  Shield,
  Search,
  Plus,
  Settings,
  Trash2,
  Eye,
  Lock,
  KeyRound,
  Zap,
} from 'lucide-react';
import EmptyState from '../../components/shared/EmptyState';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { rolesApi } from '../../services/api/roles';
import { notifyError, notifySuccess } from '../../utils/notify';
import { NodeAssignmentsSelector } from '../../components/admin/NodeAssignmentsSelector';
import type { NodeAssignmentWithExpiration } from '../../components/admin/NodeAssignmentsSelector';
import { ConfirmDialog } from '../../components/shared/ConfirmDialog';
import { ModalPortal } from '@/components/ui/modal-portal';

// Permission categories for organization
const PERMISSION_CATEGORIES = [
  {
    label: 'Server',
    permissions: [
      'server.read', 'server.create', 'server.start', 'server.stop',
      'server.delete', 'server.suspend', 'server.transfer', 'server.schedule',
    ],
  },
  {
    label: 'Node',
    permissions: [
      'node.read', 'node.create', 'node.update', 'node.delete',
      'node.view_stats', 'node.manage_allocation', 'node.assign',
    ],
  },
  {
    label: 'Location',
    permissions: ['location.read', 'location.create', 'location.update', 'location.delete'],
  },
  {
    label: 'Template',
    permissions: ['template.read', 'template.create', 'template.update', 'template.delete'],
  },
  {
    label: 'User Management',
    permissions: ['user.read', 'user.create', 'user.update', 'user.delete', 'user.ban', 'user.unban', 'user.set_roles'],
  },
  {
    label: 'Role Management',
    permissions: ['role.read', 'role.create', 'role.update', 'role.delete'],
  },
  {
    label: 'Backup',
    permissions: ['backup.read', 'backup.create', 'backup.delete', 'backup.restore'],
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
    permissions: ['database.create', 'database.read', 'database.delete', 'database.rotate'],
  },
  {
    label: 'Alerts',
    permissions: ['alert.read', 'alert.create', 'alert.update', 'alert.delete'],
  },
  {
    label: 'System Administration',
    permissions: ['admin.read', 'admin.write', 'apikey.manage'],
  },
];

// Permission presets
const PERMISSION_PRESETS = [
  { key: 'administrator', label: 'Administrator', description: 'Full system access', permissions: ['*'] },
  {
    key: 'moderator', label: 'Moderator', description: 'Can manage most resources but not users/roles',
    permissions: [
      'node.read', 'node.update', 'node.view_stats', 'node.assign',
      'location.read', 'template.read', 'user.read', 'server.read',
      'server.start', 'server.stop', 'file.read', 'file.write',
      'console.read', 'console.write', 'alert.read', 'alert.create',
      'alert.update', 'alert.delete',
    ],
  },
  { key: 'user', label: 'User', description: 'Basic access to own servers', permissions: ['server.read'] },
  {
    key: 'support', label: 'Support', description: 'Read-only access for support staff',
    permissions: [
      'node.read', 'node.view_stats', 'location.read', 'template.read',
      'server.read', 'file.read', 'console.read', 'alert.read', 'user.read',
    ],
  },
];

// ── Animation Variants ──
const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05, delayChildren: 0.05 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } },
};

// ── Helpers ──
function getPermissionCategories(permissions: string[]) {
  if (permissions.includes('*')) return [{ category: 'All Permissions', count: 1 }];
  const categoryMap = new Map<string, number>();
  for (const perm of permissions) {
    const prefix = perm.split('.')[0];
    const categoryLabel = PERMISSION_CATEGORIES.find((cat) =>
      cat.permissions.some((p) => p.startsWith(prefix))
    )?.label || prefix.charAt(0).toUpperCase() + prefix.slice(1);
    categoryMap.set(categoryLabel, (categoryMap.get(categoryLabel) || 0) + 1);
  }
  return Array.from(categoryMap.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}

const PERMISSION_LABELS: Record<string, string> = {
  'server.read': 'View servers', 'server.create': 'Create servers', 'server.start': 'Start servers',
  'server.stop': 'Stop servers', 'server.delete': 'Delete servers', 'server.suspend': 'Suspend servers',
  'server.transfer': 'Transfer servers', 'server.schedule': 'Manage schedules',
  'node.read': 'View nodes', 'node.create': 'Create nodes', 'node.update': 'Edit nodes',
  'node.delete': 'Delete nodes', 'node.view_stats': 'View stats',
  'node.manage_allocation': 'Manage allocations', 'node.assign': 'Assign nodes',
  'location.read': 'View locations', 'location.create': 'Create locations',
  'location.update': 'Edit locations', 'location.delete': 'Delete locations',
  'template.read': 'View templates', 'template.create': 'Create templates',
  'template.update': 'Edit templates', 'template.delete': 'Delete templates',
  'user.read': 'View users', 'user.create': 'Create users', 'user.update': 'Edit users',
  'user.delete': 'Delete users', 'user.ban': 'Ban users', 'user.unban': 'Unban users',
  'user.set_roles': 'Assign roles',
  'role.read': 'View roles', 'role.create': 'Create roles', 'role.update': 'Edit roles',
  'role.delete': 'Delete roles',
  'backup.read': 'View backups', 'backup.create': 'Create backups', 'backup.delete': 'Delete backups',
  'backup.restore': 'Restore backups',
  'file.read': 'Read files', 'file.write': 'Write files',
  'console.read': 'View console', 'console.write': 'Send commands',
  'database.create': 'Create databases', 'database.read': 'View databases',
  'database.delete': 'Delete databases', 'database.rotate': 'Rotate passwords',
  'alert.read': 'View alerts', 'alert.create': 'Create alerts',
  'alert.update': 'Edit alerts', 'alert.delete': 'Delete alerts',
  'admin.read': 'View admin panel', 'admin.write': 'Modify admin settings',
  'apikey.manage': 'Manage API keys',
};

function formatPermission(perm: string): string {
  if (perm === '*') return '* (All Permissions)';
  return PERMISSION_LABELS[perm] || perm.split('.').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function getCategoryIcon(label: string) {
  switch (label) {
    case 'Server': return '🖥️';
    case 'Node': return '⚡';
    case 'Location': return '📍';
    case 'Template': return '📄';
    case 'User Management': return '👥';
    case 'Role Management': return '🛡️';
    case 'Backup': return '💾';
    case 'File Management': return '📁';
    case 'Console': return '💻';
    case 'Database': return '🗄️';
    case 'Alerts': return '🔔';
    case 'System Administration': return '⚙️';
    default: return '📌';
  }
}

// ── Modal Shell ──
function ModalShell({
  open, onClose, title, subtitle, children, footer, wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <ModalPortal>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 px-4 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className={`flex h-full w-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl md:m-4 md:h-auto md:max-h-[90vh] ${wide ? 'max-w-4xl' : 'max-w-2xl'}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground ">{title}</h2>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <button
            className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground dark:text-foreground"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 text-sm text-foreground dark:text-foreground">
          {children}
        </div>
        {footer && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-4 text-xs">
            {footer}
          </div>
        )}
      </motion.div>
    </div>
    </ModalPortal>
  );
}

// ── Role Card ──
function RoleCard({
  role,
  isActive,
  onView,
  onEdit,
  onDelete,
  canDelete,
  isDeleting,
  index,
}: {
  role: any;
  isActive: boolean;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  canDelete: boolean;
  isDeleting: boolean;
  index: number;
}) {
  const isWildcard = role.permissions?.includes('*');
  const permCats = getPermissionCategories(role.permissions || []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 24, delay: index * 0.03 }}
      className={`group relative overflow-hidden rounded-xl border p-5 transition-all duration-200 hover:shadow-md ${
        isActive
          ? 'border-primary/40 bg-primary/5 dark:bg-primary/10'
          : 'border-border bg-card hover:border-primary/20'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${isWildcard ? 'bg-warning-muted text-warning' : 'bg-primary/10 text-primary'}`}>
              {isWildcard ? (
                <KeyRound className="h-4 w-4" />
              ) : (
                <Shield className="h-4 w-4" />
              )}
            </div>
            <div className="min-w-0">
              <div className="truncate font-semibold text-foreground dark:text-foreground">
                {role.name}
              </div>
              {role.description && (
                <div className="truncate text-xs text-muted-foreground">{role.description}</div>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
          <button
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-primary/5 hover:text-primary"
            onClick={onView}
            title="View details"
          >
            <Eye className="h-3.5 w-3.5" />
          </button>
          <button
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-primary/5 hover:text-primary"
            onClick={onEdit}
            title="Edit"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
          {canDelete ? (
            <button
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/5 hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
              onClick={onDelete}
              disabled={isDeleting}
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      {/* Permission preview */}
      <div className="mt-4 space-y-2">
        {isWildcard ? (
          <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning-muted px-3 py-2">
            <Zap className="h-3.5 w-3.5 shrink-0 text-warning" />
            <span className="text-xs font-medium text-warning">
              Full Administrator Access
            </span>
          </div>
        ) : (
          <div className="flex max-h-24 flex-col gap-1 overflow-y-auto">
            {permCats.slice(0, 5).map((cat) => (
              <div key={cat.category} className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">
                  <span className="mr-1">{getCategoryIcon(cat.category)}</span>
                  {cat.category}
                </span>
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                  {cat.count}
                </Badge>
              </div>
            ))}
            {permCats.length > 5 && (
              <span className="text-[10px] text-muted-foreground">
                +{permCats.length - 5} more categories
              </span>
            )}
          </div>
        )}
      </div>

      {/* Footer meta */}
      <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
        <Badge variant="outline" className="text-[10px]">
          {role.permissions?.length || 0} perm{role.permissions?.length === 1 ? '' : 's'}
        </Badge>
        {role.userCount > 0 ? (
          <Badge variant="secondary" className="text-[10px]">
            {role.userCount} user{role.userCount === 1 ? '' : 's'}
          </Badge>
        ) : null}
      </div>
    </motion.div>
  );
}

// ── Permission Checkbox Category (shared between create/edit modal) ──
function PermissionSelector({
  selectedPermissions,
  onToggle,
  permissionSearch,
  onPermissionSearchChange,
}: {
  selectedPermissions: Set<string>;
  onToggle: (perm: string) => void;
  permissionSearch: string;
  onPermissionSearchChange: (v: string) => void;
}) {
  const filteredCategories = useMemo(() => {
    const s = permissionSearch.toLowerCase();
    return PERMISSION_CATEGORIES.map((category) => ({
      ...category,
      permissions: category.permissions.filter(
        (p) => p.toLowerCase().includes(s) || category.label.toLowerCase().includes(s),
      ),
    })).filter((category) => category.permissions.length > 0);
  }, [permissionSearch]);

  return (
    <div className="rounded-lg border border-border bg-muted/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Permissions ({selectedPermissions.size})
        </div>
        <Input
          value={permissionSearch}
          onChange={(e) => onPermissionSearchChange(e.target.value)}
          placeholder="Search permissions…"
          className="w-48"
        />
      </div>

      <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
        {filteredCategories.map((category) => {
          const allSelected = category.permissions.every((p) => selectedPermissions.has(p));
          const someSelected = category.permissions.some((p) => selectedPermissions.has(p));

          return (
            <div key={category.label} className="rounded-lg border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(input) => {
                      if (input) input.indeterminate = someSelected && !allSelected;
                    }}
                    onChange={() => {
                      const newSet = new Set(selectedPermissions);
                      if (allSelected) {
                        category.permissions.forEach((p) => newSet.delete(p));
                      } else {
                        category.permissions.forEach((p) => newSet.add(p));
                      }
                      onToggle('__batch__');
                      // We pass a sentinel; the real toggle happens below via parent
                      // Actually let's just handle this inline
                    }}
                    className="h-4 w-4 rounded border-border bg-card text-primary focus:ring-2 focus:ring-ring"
                  />
                  <span className="text-sm font-semibold text-foreground dark:text-foreground">
                    {getCategoryIcon(category.label)} {category.label}
                  </span>
                </label>
                <span className="text-xs text-muted-foreground">
                  {category.permissions.filter((p) => selectedPermissions.has(p))}/{category.permissions.length}
                </span>
              </div>

              <div className="flex flex-col">
                {category.permissions.map((permission) => (
                  <label
                    key={permission}
                    className={`flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0 transition-colors cursor-pointer ${
                      selectedPermissions.has(permission)
                        ? 'bg-primary/5 dark:bg-primary/10'
                        : 'hover:bg-muted'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedPermissions.has(permission)}
                      onChange={() => onToggle(permission)}
                      className="h-4 w-4 rounded border-border bg-card text-primary focus:ring-2 focus:ring-ring"
                    />
                    <span className="text-sm text-foreground dark:text-foreground">
                      {formatPermission(permission)}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Wildcard */}
      <label
        className={`flex items-center gap-3 rounded-lg border px-3 py-2 mt-3 transition-all cursor-pointer ${
          selectedPermissions.has('*')
            ? 'border-warning/30 bg-warning-muted'
            : 'border-border bg-card hover:border-border'
        }`}
      >
        <input
          type="checkbox"
          checked={selectedPermissions.has('*')}
          onChange={() => onToggle('*')}
          className="h-4 w-4 rounded border-border bg-card text-warning focus:ring-warning/30"
        />
        <div>
          <div className="text-xs font-medium text-warning">Wildcard (*)</div>
          <div className="text-[10px] text-muted-foreground">Grants all permissions</div>
        </div>
      </label>
    </div>
  );
}

// ── Main Page ──
function RolesPage() {
  const [search, setSearch] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<any>(null);
  const [viewingRole, setViewingRole] = useState<any>(null);
  const [deletingRole, setDeletingRole] = useState<any>(null);
  const editingRequestRef = useRef(0);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedPermissions, setSelectedPermissions] = useState<Set<string>>(new Set());
  const [permissionSearch, setPermissionSearch] = useState('');
  const [selectedNodeIds, setSelectedNodeIds] = useState<NodeAssignmentWithExpiration[]>([]);

  // Fetch roles
  const { data: roles = [], isLoading } = useQuery({
    queryKey: qk.adminRoles(),
    queryFn: rolesApi.list,
    refetchInterval: 10000,
  });

  // Fetch presets
  const { data: presets = [] } = useQuery({
    queryKey: ['role-presets'],
    queryFn: rolesApi.getPresets,
    refetchInterval: 30000,
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; description?: string; permissions: string[] }) => rolesApi.create(data),
    onSuccess: () => {
      notifySuccess('Role created');
      queryClient.invalidateQueries({ queryKey: qk.adminRoles() });
      resetForm();
      setIsCreateOpen(false);
    },
    onError: (error: any) => notifyError(error?.response?.data?.error || 'Failed to create role'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ roleId, data }: { roleId: string; data: Partial<{ name: string; description?: string; permissions: string[] }> }) =>
      rolesApi.update(roleId, data),
    onSuccess: () => {
      notifySuccess('Role updated');
      queryClient.invalidateQueries({ queryKey: qk.adminRoles() });
      resetForm();
      setEditingRole(null);
    },
    onError: (error: any) => notifyError(error?.response?.data?.error || 'Failed to update role'),
  });

  const deleteMutation = useMutation({
    mutationFn: (roleId: string) => rolesApi.delete(roleId),
    onSuccess: () => {
      notifySuccess('Role deleted');
      queryClient.invalidateQueries({ queryKey: qk.adminRoles() });
      setViewingRole(null);
    },
    onError: (error: any) => notifyError(error?.response?.data?.error || 'Failed to delete role'),
  });

  const togglePermission = (permission: string) => {
    const newSet = new Set(selectedPermissions);
    if (newSet.has(permission)) newSet.delete(permission);
    else newSet.add(permission);
    setSelectedPermissions(newSet);
  };

  const applyPreset = (preset: typeof PERMISSION_PRESETS[0]) => {
    setName(preset.label);
    setDescription(preset.description);
    setSelectedPermissions(new Set(preset.permissions));
  };

  const resetForm = () => {
    setName('');
    setDescription('');
    setSelectedPermissions(new Set());
    setPermissionSearch('');
    setSelectedNodeIds([]);
  };

  const startEdit = async (role: any) => {
    const requestId = editingRequestRef.current + 1;
    editingRequestRef.current = requestId;
    setEditingRole(role);
    setName(role.name);
    setDescription(role.description || '');
    setSelectedPermissions(new Set(role.permissions || []));
    setIsCreateOpen(false);
    setViewingRole(null);

    try {
      const response = await fetch(`/api/roles/${role.id}/nodes`, {
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      const nodes = data.data || [];
      if (editingRequestRef.current === requestId) {
        setSelectedNodeIds(nodes.map((n: any) => ({ nodeId: n.id, nodeName: n.name })));
      }
    } catch {
      setSelectedNodeIds([]);
    }
  };

  const startView = (role: any) => {
    setViewingRole(role);
    setEditingRole(null);
    setIsCreateOpen(false);
  };

  const filteredRoles = useMemo(
    () => roles.filter(
      (role: any) =>
        role.name.toLowerCase().includes(search.toLowerCase()) ||
        (role.description?.toLowerCase().includes(search.toLowerCase()) ?? false),
    ),
    [roles, search],
  );

  const canSubmit = name.trim().length > 0 && selectedPermissions.size > 0;

  const isModalOpen = isCreateOpen || !!editingRole;

  return (
    <motion.div
      variants={containerVariants}
      initial={false}
      animate="visible"
      className="relative min-h-screen overflow-hidden"
    >
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-gradient-to-br from-violet-500/8 to-purple-500/8 blur-3xl dark:from-violet-500/15 dark:to-purple-500/15" />
        <div className="absolute bottom-0 -left-32 h-80 w-80 rounded-full bg-gradient-to-tr from-amber-500/8 to-orange-500/8 blur-3xl dark:from-amber-500/15 dark:to-orange-500/15" />
      </div>

      <div className="relative z-10 space-y-5">
        {/* ── Header ── */}
        <motion.div variants={itemVariants} className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="absolute -inset-1 rounded-lg bg-gradient-to-r from-violet-500 to-purple-500 opacity-20 blur-sm" />
                <Shield className="relative h-7 w-7 text-violet-600 dark:text-violet-400" />
              </div>
              <h1 className="font-display text-3xl font-bold tracking-tight text-foreground ">
                Roles
              </h1>
            </div>
            <p className="ml-10 text-sm text-muted-foreground">
              Manage user roles and their permissions.
            </p>
          </div>
          <Button size="sm" onClick={() => { resetForm(); setIsCreateOpen(true); setEditingRole(null); setViewingRole(null); }} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            Create role
          </Button>
        </motion.div>

        {/* ── Search Bar ── */}
        <motion.div variants={itemVariants} className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[200px] flex-1 max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search roles…"
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {roles.length} roles
            </Badge>
            {presets.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {presets.length} presets
              </Badge>
            )}
          </div>
        </motion.div>

        {/* ── Role Grid ── */}
        {isLoading ? (
          <motion.div variants={itemVariants} className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="rounded-xl border border-border bg-card/80 p-5">
                <div className="flex items-start gap-3">
                  <div className="h-9 w-9 animate-pulse rounded-lg bg-surface-3" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-24 animate-pulse rounded bg-surface-3" />
                    <div className="h-3 w-36 animate-pulse rounded bg-surface-2" />
                    <div className="flex gap-1.5">
                      <div className="h-5 w-14 animate-pulse rounded-full bg-surface-2" />
                      <div className="h-5 w-16 animate-pulse rounded-full bg-surface-2" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </motion.div>
        ) : filteredRoles.length === 0 ? (
          <motion.div variants={itemVariants}>
            <EmptyState
              title={search.trim() ? 'No roles found' : 'No roles'}
              description={search.trim() ? 'Try a different role name or description.' : 'Create a role to define permissions for users.'}
              action={
                <Button size="sm" onClick={() => { resetForm(); setIsCreateOpen(true); setEditingRole(null); setViewingRole(null); }} className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  Create role
                </Button>
              }
            />
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {filteredRoles.map((role: any, i: number) => (
              <RoleCard
                key={role.id}
                role={role}
                index={i}
                isActive={viewingRole?.id === role.id}
                onView={() => startView(role)}
                onEdit={() => startEdit(role)}
                onDelete={() => setDeletingRole(role)}
                canDelete={role.userCount === 0}
                isDeleting={deleteMutation.isPending}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Create/Edit Modal ── */}
      <ModalShell
        open={isModalOpen}
        onClose={() => { resetForm(); setIsCreateOpen(false); setEditingRole(null); }}
        title={editingRole ? 'Edit role' : 'Create role'}
        subtitle={editingRole ? 'Update role name, description, and permissions.' : 'Define a new role with specific permissions.'}
        wide
        footer={
          <>
            <span className="text-muted-foreground">
              {selectedPermissions.size} permission{selectedPermissions.size === 1 ? '' : 's'} selected
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { resetForm(); setIsCreateOpen(false); setEditingRole(null); }}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!canSubmit || createMutation.isPending || updateMutation.isPending}
                onClick={() => {
                  const data = {
                    name: name.trim(),
                    description: description.trim() || undefined,
                    permissions: Array.from(selectedPermissions),
                  };
                  if (editingRole) {
                    updateMutation.mutate({ roleId: editingRole.id, data });
                  } else {
                    createMutation.mutate(data);
                  }
                }}
              >
                {createMutation.isPending || updateMutation.isPending
                  ? 'Saving…'
                  : editingRole
                  ? 'Save changes'
                  : 'Create role'}
              </Button>
            </div>
          </>
        }
      >
        <div className="space-y-6">
          {/* Presets — only for create */}
          {!editingRole && presets.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                Quick start
              </div>
              <div className="flex flex-wrap gap-2">
                {presets.map((preset) => (
                  <button
                    key={preset.key}
                    onClick={() => applyPreset(preset)}
                    className="rounded-md border border-border bg-muted px-3 py-1.5 text-xs text-foreground transition-colors hover:border-primary/50"
                  >
                    {preset.label}
                    <span className="ml-1 text-muted-foreground">({preset.permissions.length})</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Basic Info */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Role details</div>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">Name</span>
                <Input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Moderator" />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">Description</span>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe what this role can do…" />
              </label>
            </div>
          </div>

          {/* Permissions */}
          <PermissionSelector
            selectedPermissions={selectedPermissions}
            onToggle={togglePermission}
            permissionSearch={permissionSearch}
            onPermissionSearchChange={setPermissionSearch}
          />

          {/* Node Assignments */}
          <NodeAssignmentsSelector
            roleId={editingRole?.id}
            selectedNodes={selectedNodeIds}
            onSelectionChange={setSelectedNodeIds}
            disabled={createMutation.isPending || updateMutation.isPending}
          />
        </div>
      </ModalShell>

      {/* ── View Detail Modal ── */}
      <ModalShell
        open={!!viewingRole && !editingRole && !isCreateOpen}
        onClose={() => setViewingRole(null)}
        title={viewingRole?.name || ''}
        subtitle={viewingRole?.description}
      >
        <div className="space-y-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Permissions ({viewingRole?.permissions?.length || 0})
          </div>

          {viewingRole?.permissions?.includes('*') ? (
            <div className="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning-muted p-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning/20">
                <Lock className="h-4 w-4 text-warning" />
              </div>
              <div>
                <div className="text-sm font-semibold text-warning">
                  Full Administrator Access
                </div>
                <div className="text-xs text-warning/70">
                  This role has unrestricted access to all system permissions.
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3 max-h-72 overflow-y-auto">
              {getPermissionCategories(viewingRole?.permissions || []).map((cat) => (
                <div key={cat.category} className="rounded-lg border border-border bg-card">
                  <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                    <span className="text-sm font-semibold text-foreground dark:text-foreground">
                      {getCategoryIcon(cat.category)} {cat.category}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {cat.count} permission{cat.count === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="divide-y divide-border/30">
                    {(viewingRole?.permissions || [])
                      .filter((p: string) => {
                        const prefix = p.split('.')[0];
                        return PERMISSION_CATEGORIES.find((catData) =>
                          catData.label === cat.category && catData.permissions.includes(p),
                        ) || cat.category.toLowerCase() === prefix;
                      })
                      .map((permission: string) => (
                        <div key={permission} className="px-4 py-2 text-sm text-foreground dark:text-foreground">
                          {formatPermission(permission)}
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Metadata */}
          <div className="space-y-1 border-t border-border/50 pt-3 text-xs text-muted-foreground">
            <div>Role ID: {viewingRole?.id}</div>
            <div>
              Created: {viewingRole?.createdAt ? `${new Date(viewingRole.createdAt).toLocaleDateString()} at ${new Date(viewingRole.createdAt).toLocaleTimeString()}` : '—'}
            </div>
            {viewingRole?.updatedAt !== viewingRole?.createdAt && (
              <div>
                Updated: {viewingRole?.updatedAt ? `${new Date(viewingRole.updatedAt).toLocaleDateString()} at ${new Date(viewingRole.updatedAt).toLocaleTimeString()}` : '—'}
              </div>
            )}
            {viewingRole?.userCount !== undefined && viewingRole.userCount > 0 && (
              <div className="text-foreground dark:text-foreground">
                Assigned to {viewingRole.userCount} user{viewingRole.userCount === 1 ? '' : 's'}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2 border-t border-border/50 pt-3">
            <Button variant="outline" size="sm" onClick={() => startEdit(viewingRole)} className="gap-1.5">
              <Settings className="h-3.5 w-3.5" />
              Edit role
            </Button>
            {viewingRole?.userCount === 0 && (
              <Button variant="destructive" size="sm" onClick={() => setDeletingRole(viewingRole)} disabled={deleteMutation.isPending} className="gap-1.5">
                <Trash2 className="h-3.5 w-3.5" />
                {deleteMutation.isPending ? 'Deleting…' : 'Delete role'}
              </Button>
            )}
          </div>
        </div>
      </ModalShell>

      {/* ── Delete Confirmation ── */}
      <ConfirmDialog
        open={!!deletingRole}
        title="Delete role?"
        message={`Are you sure you want to delete "${deletingRole?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deletingRole) {
            deleteMutation.mutate(deletingRole.id, {
              onSuccess: () => { setDeletingRole(null); setViewingRole(null); },
            });
          }
        }}
        onCancel={() => setDeletingRole(null)}
      />
    </motion.div>
  );
}

export default RolesPage;
