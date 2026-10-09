import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useMutation, useQuery, useVirtualizer } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import {
  Shield,
  Search,
  Plus,
  Trash2,
  Eye,
  KeyRound,
  Zap,
  Check,
  Server,
  Info,
  Lock,
  Pencil,
  Clock,
  Users,
  Globe,
} from 'lucide-react';

import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { rolesApi } from '../../services/api/roles';
import { useStreamAwareInterval } from '../../hooks/useStreamAwareInterval';
import LastUpdated from '../../components/shared/LastUpdated';
import type { Role } from '../../types/admin';
import { notifyError, notifySuccess } from '../../utils/notify';
import { roleDescriptionLabel, roleLabel } from '../../utils/constants';
import { formatDate, formatTime } from '../../i18n/format';
import { ConfirmDialog } from '../../components/shared/ConfirmDialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

import TabEmptyState from '../../components/servers/tabs/TabEmptyState';
import { BracketLabel, Segmented } from '../../components/deck/primitives';
import { cn } from '@/lib/utils';
import { formatPermission } from './role-creator/permissionLabels';
import {
  RoleCreatorDialog,
  type RoleCreatorPayload,
} from './role-creator/RoleCreatorDialog';

// ── Permission categories ──────────────────────────────────────────────
const PERMISSION_CATEGORIES = [
 {
 key: 'server',
 icon: Server,
 color: 'bg-primary/10',
 accent: 'text-primary',
 border: 'border-primary/20',
 bg: 'bg-primary/5',
 permissions: [
 'server.read', 'server.create', 'server.start', 'server.stop',
 'server.delete', 'server.suspend', 'server.transfer', 'server.schedule',
 'server.update', 'server.install', 'server.reinstall', 'server.rebuild',
 'server.clone', 'server.kill', 'server.network', 'server.storage',
 'server.archive', 'server.migrate',
 ],
 },
 {
 key: 'node',
 icon: Zap,
 color: 'bg-primary/10',
 accent: 'text-primary',
 border: 'border-primary/20',
 bg: 'bg-primary/5',
 permissions: [
 'node.read', 'node.create', 'node.update', 'node.delete',
 'node.view_stats', 'node.manage_allocation', 'node.assign',
 'node.server_manage', 'node.agent_control',
 ],
 },
 {
 key: 'location',
 icon: Globe,
 color: 'bg-primary/10',
 accent: 'text-primary',
 border: 'border-primary/20',
 bg: 'bg-primary/5',
 permissions: ['location.read', 'location.create', 'location.update', 'location.delete'],
 },
 {
 key: 'template',
 icon: Info,
 color: 'bg-primary/10',
 accent: 'text-primary',
 border: 'border-primary/20',
 bg: 'bg-primary/5',
 permissions: ['template.read', 'template.create', 'template.update', 'template.delete'],
 },
 {
 key: 'userManagement',
 icon: Users,
 color: 'bg-primary/10',
 accent: 'text-primary',
 border: 'border-primary/20',
 bg: 'bg-primary/5',
 permissions: ['user.read', 'user.create', 'user.update', 'user.delete', 'user.ban', 'user.unban', 'user.set_roles'],
 },
 {
 key: 'roleManagement',
 icon: Shield,
 color: 'bg-primary/10',
 accent: 'text-primary',
 border: 'border-primary/20',
 bg: 'bg-primary/5',
 permissions: ['role.read', 'role.create', 'role.update', 'role.delete'],
 },
 {
 key: 'backup',
 icon: Shield,
 color: 'bg-primary/10',
 accent: 'text-primary',
 border: 'border-primary/20',
 bg: 'bg-primary/5',
 permissions: ['backup.read', 'backup.create', 'backup.delete', 'backup.restore', 'backup.download'],
 },
 {
 key: 'fileManagement',
 icon: Info,
 color: 'bg-primary/10',
 accent: 'text-primary',
 border: 'border-primary/20',
 bg: 'bg-primary/5',
 permissions: ['file.read', 'file.write'],
 },
 {
 key: 'console',
 icon: Info,
 color: 'bg-primary/10',
 accent: 'text-primary',
 border: 'border-primary/20',
 bg: 'bg-primary/5',
 permissions: ['console.read', 'console.write'],
 },
 {
 key: 'database',
 icon: Info,
 color: 'bg-primary/10',
 accent: 'text-primary',
 border: 'border-primary/20',
 bg: 'bg-primary/5',
 permissions: ['database.create', 'database.read', 'database.delete', 'database.rotate'],
 },
 {
 key: 'alerts',
 icon: Info,
 color: 'bg-primary/10',
 accent: 'text-primary',
 border: 'border-primary/20',
 bg: 'bg-primary/5',
 permissions: ['alert.read', 'alert.create', 'alert.update', 'alert.delete'],
 },
 {
 key: 'systemAdministration',
 icon: Lock,
 color: 'bg-primary/10',
 accent: 'text-primary',
 border: 'border-primary/20',
 bg: 'bg-primary/5',
 // apikey.manage stays listed during the split alias window.
 permissions: ['admin.read', 'admin.write', 'apikey.manage', 'apikey.read', 'apikey.write'],
 },
 {
 key: 'serverContent',
 icon: Info,
 color: 'bg-primary/10',
 accent: 'text-primary',
 border: 'border-primary/20',
 bg: 'bg-primary/5',
 permissions: ['mods.manage', 'plugins.manage'],
 },
 {
 key: 'operations',
 icon: Lock,
 color: 'bg-primary/10',
 accent: 'text-primary',
 border: 'border-primary/20',
 bg: 'bg-primary/5',
 permissions: ['migration.manage', 'update.trigger', 'diagnostics.download'],
 },
];

/** Display label for a permission category group. */
function permissionCategoryLabel(t: TFunction<'admin-access'>, key: string): string {
  switch (key) {
    case 'server': return t('roles.permissionCategories.server');
    case 'node': return t('roles.permissionCategories.node');
    case 'location': return t('roles.permissionCategories.location');
    case 'template': return t('roles.permissionCategories.template');
    case 'userManagement': return t('roles.permissionCategories.userManagement');
    case 'roleManagement': return t('roles.permissionCategories.roleManagement');
    case 'backup': return t('roles.permissionCategories.backup');
    case 'fileManagement': return t('roles.permissionCategories.fileManagement');
    case 'console': return t('roles.permissionCategories.console');
    case 'database': return t('roles.permissionCategories.database');
    case 'alerts': return t('roles.permissionCategories.alerts');
    case 'systemAdministration': return t('roles.permissionCategories.systemAdministration');
    case 'serverContent': return t('roles.permissionCategories.serverContent');
    case 'operations': return t('roles.permissionCategories.operations');
    default: return key;
  }
}

function getPermissionCategories(t: TFunction<'admin-access'>, permissions: string[]) {
 if (permissions.includes('*')) return [{ category: t('roles.permissionLabels.all'), count: 1, icon: KeyRound, color: 'bg-primary/10', accent: 'text-primary', border: 'border-primary/20' }];
 const categoryMap = new Map<string, { count: number; icon: typeof Shield; color: string; accent: string; border: string }>();
 for (const perm of permissions) {
 const prefix = perm.split('.')[0];
 const cat = PERMISSION_CATEGORIES.find((c) => c.permissions.some((p) => p.startsWith(prefix)));
 const label = cat ? permissionCategoryLabel(t, cat.key) : prefix.charAt(0).toUpperCase() + prefix.slice(1);
 if (!categoryMap.has(label)) {
 categoryMap.set(label, {
 count: 0,
 icon: cat?.icon || Shield,
 color: cat?.color || 'bg-primary/10',
 accent: cat?.accent || 'text-primary',
 border: cat?.border || 'border-primary/20',
 });
 }
 categoryMap.get(label)!.count++;
 }
 return Array.from(categoryMap.entries())
 .map(([category, data]) => ({ category, ...data }))
 .sort((a, b) => b.count - a.count);
}

// ── Role Card ──
/**
 * One grid template shared by the column header and every row so columns line
 * up. Fixed / minmax(0,1fr) tracks only — never `auto`.
 *   base : identity · actions
 *   md   : identity · permissions · scoped · users · actions
 */
const GRID =
 'grid grid-cols-1 items-center gap-x-3 gap-y-1.5 ' +
 'md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7rem_5rem_6.5rem]';

function RoleRow({
 role,
 isActive,
 onView,
 onEdit,
 onDelete,
 canDelete,
 isDeleting,
}: {
 role: any;
 isActive: boolean;
 onView: () => void;
 onEdit: () => void;
 onDelete: () => void;
 canDelete: boolean;
 isDeleting: boolean;
}) {
 const { t } = useTranslation('admin-access');
 const isWildcard = role.permissions?.includes('*');
 const permCats = getPermissionCategories(t, role.permissions || []);

 return (
 <div
 role="row"
 onClick={onView}
 className={cn(
 GRID,
 'group cursor-pointer py-1.5 pl-3 pr-3 transition-colors hover:bg-surface-1/40',
 isActive && 'bg-primary/5',
 )}
 >
 {/* identity */}
 <div className="flex min-w-0 items-center gap-2">
 {isWildcard ? (
 <KeyRound className="h-3.5 w-3.5 shrink-0 text-warning" />
 ) : (
 <Shield className="h-3.5 w-3.5 shrink-0 text-primary" />
 )}
 <div className="flex min-h-9 min-w-0 flex-col justify-center leading-tight">
 <span
 className="truncate font-display text-data font-semibold tracking-tight text-foreground"
 title={roleLabel(t, role.name)}
 >
 {roleLabel(t, role.name)}
 </span>
 {role.description && (
 <span
 className="truncate text-micro text-muted-foreground"
 title={roleDescriptionLabel(t, role.description)}
 >
 {roleDescriptionLabel(t, role.description)}
 </span>
 )}
 <span className="flex min-w-0 items-center gap-2 text-micro text-muted-foreground md:hidden">
 <span className="truncate">
 {t('roles.permissionCount', { count: role.permissions?.length || 0 })}
 </span>
 {role.userCount > 0 && (
 <span className="shrink-0">
 {t('roles.usersLabel')} {role.userCount}
 </span>
 )}
 </span>
 </div>
 </div>

 {/* permissions — nowrap so the permission-count badge never wraps to a
 second line and breaks the row rhythm */}
 <div className="hidden min-w-0 items-center gap-1 md:flex">
 <div className="flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden">
 {isWildcard ? (
 <Badge className="min-w-0 max-w-44 shrink gap-1 truncate border-warning/30 bg-warning/10 text-warning text-micro">
 <Zap className="h-3 w-3" /> {t('roles.cardFullAdmin')}
 </Badge>
 ) : (
 <>
 {permCats.slice(0, 4).map((cat) => {
 const Icon = cat.icon;
 return (
 <Badge key={cat.category} variant="outline" className="min-w-0 max-w-44 shrink gap-1 truncate text-micro">
 <Icon className="h-2.5 w-2.5" /> {cat.category} ({cat.count})
 </Badge>
 );
 })}
 {permCats.length > 4 && (
 <Badge variant="secondary" className="min-w-0 max-w-32 shrink truncate text-micro">{t('roles.cardMore', { count: permCats.length - 4 })}</Badge>
 )}
 </>
 )}
 </div>
 <Badge variant="outline" className="shrink-0 whitespace-nowrap text-micro">
 {t('roles.permissionCount', { count: role.permissions?.length || 0 })}
 </Badge>
 </div>

 {/* scoped access */}
 <span className="hidden min-w-0 justify-self-end md:flex">
 {role.nodeGrantCount > 0 || role.serverGrantCount > 0 ? (
 <span className="flex flex-col items-end gap-0.5 text-micro text-muted-foreground">
 {role.nodeGrantCount > 0 && (
 <span className="flex items-center gap-1">
 <Globe className="h-3 w-3" /> {t('roles.nodeGrantCount', { count: role.nodeGrantCount })}
 </span>
 )}
 {role.serverGrantCount > 0 && (
 <span className="flex items-center gap-1">
 <Server className="h-3 w-3" /> {t('roles.serverGrantCount', { count: role.serverGrantCount })}
 </span>
 )}
 </span>
 ) : (
 <span className="text-micro text-muted-foreground/40">—</span>
 )}
 </span>

 {/* users */}
 <span className="hidden items-center justify-self-end md:flex">
 {role.userCount > 0 ? (
 <span className="flex items-center gap-1">
 <Users className="h-3 w-3 text-muted-foreground" />
 <Segmented muted>{role.userCount}</Segmented>
 </span>
 ) : (
 <span className="text-micro text-muted-foreground/40">—</span>
 )}
 </span>

 {/* actions */}
 <span className="col-span-full flex shrink-0 items-center justify-start gap-1 md:col-auto md:justify-end">
 <button
 className="flex h-7 w-7 items-center justify-center rounded-sm border border-border/60 text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
 onClick={(e) => { e.stopPropagation(); onView(); }}
 title={t('roles.actionViewDetails')}
 >
 <Eye className="h-3.5 w-3.5" />
 </button>
 <button
 className="flex h-7 w-7 items-center justify-center rounded-sm border border-border/60 text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
 onClick={(e) => { e.stopPropagation(); onEdit(); }}
 title={t('common:actions.edit')}
 >
 <Pencil className="h-3.5 w-3.5" />
 </button>
 {canDelete ? (
 <button
 className="flex h-7 w-7 items-center justify-center rounded-sm border border-border/60 text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
 onClick={(e) => { e.stopPropagation(); onDelete(); }}
 disabled={isDeleting}
 title={t('common:actions.delete')}
 >
 <Trash2 className="h-3.5 w-3.5" />
 </button>
 ) : null}
 </span>
 </div>
 );
}

// ── Permission Category Card (read-only, for view modal) ──
function PermissionCategoryReadCard({
 category,
 permissions,
}: {
 category: { category: string; count: number; icon: typeof Shield; color: string; accent: string; border: string };
  permissions: string[];
}) {
 const { t } = useTranslation('admin-access');
 return (
 <div className={`rounded-sm border ${category.border}`}>
 <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
 <div className="flex items-center gap-2.5">
 <span className="text-sm font-semibold text-foreground">{category.category}</span>
 </div>
 <Badge variant="secondary" className="text-micro tabular-nums">{category.count}</Badge>
 </div>
 <div className="px-4 py-3">
 <div className="flex flex-wrap gap-1.5">
 {permissions.map((perm) => (
 <span key={perm} className="inline-flex items-center gap-1 rounded-sm border border-border bg-surface-2 px-2 py-1 text-micro text-foreground">
 <Check className="h-2.5 w-2.5 text-primary" />
 {formatPermission(t, perm)}
 </span>
 ))}
 </div>
 </div>
 </div>
 );
}

// ── Main Page ──
function RolesPage() {
  const { t } = useTranslation('admin-access');
  const [search, setSearch] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [viewingRole, setViewingRole] = useState<Role | null>(null);
  const [deletingRole, setDeletingRole] = useState<Role | null>(null);

  // Fetch roles
  // P1-24: role CRUD arrives via the admin stream only — poll during outages
  // (same pattern as useAdmin.ts useAdminRoles).
  const rolesOutagePoll = useStreamAwareInterval(60_000);
  const { data: roles = [], isLoading } = useQuery({
    queryKey: qk.adminRoles(),
    queryFn: rolesApi.list,
    staleTime: 5 * 60 * 1000,
    refetchInterval: rolesOutagePoll,
    refetchIntervalInBackground: false,
  });

  // Permission presets offered by the role editor toolbar.
  const { data: presets = [] } = useQuery({
    queryKey: qk.rolePresets(),
    queryFn: rolesApi.getPresets,
    staleTime: 10 * 60 * 1000,
  });

  const createMutation = useMutation({
    mutationFn: (data: RoleCreatorPayload) => rolesApi.create(data),
    onSuccess: () => {
      notifySuccess(t('roles.toasts.created'));
      setIsCreateOpen(false);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.adminRoles() });
    },
    onError: (error: any) => notifyError(error),
  });

  const updateMutation = useMutation({
    mutationFn: ({ roleId, data }: { roleId: string; data: RoleCreatorPayload }) =>
      rolesApi.update(roleId, data),
    onSuccess: () => {
      notifySuccess(t('roles.toasts.updated'));
      setEditingRole(null);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.adminRoles() });
    },
    onError: (error: any) => notifyError(error),
  });

  const deleteMutation = useMutation({
    mutationFn: (roleId: string) => rolesApi.delete(roleId),
    onSuccess: () => {
      notifySuccess(t('roles.toasts.deleted'));
      setViewingRole(null);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.adminRoles() });
    },
    onError: (error: any) => notifyError(error),
  });

  /**
   * Editing opens instantly on the list row; the row payload omits `scope`, so
   * the fetched detail (which carries it) is merged in by the dialog when it
   * arrives — see the late-arrival effect in RoleCreatorDialog.
   */
  const startEdit = async (role: Role) => {
    setViewingRole(null);
    setIsCreateOpen(false);
    setEditingRole(role);
    try {
      const detail = await rolesApi.get(role.id);
      if (detail) setEditingRole(detail);
    } catch {
      // Keep the list row's data; the editor falls back to "panel only".
    }
  };

  const startView = (role: Role) => {
    setViewingRole(role);
    setEditingRole(null);
    setIsCreateOpen(false);
  };

  const filteredRoles = useMemo(
    () =>
      roles.filter(
        (role: Role) =>
          role.name.toLowerCase().includes(search.toLowerCase()) ||
          (role.description?.toLowerCase().includes(search.toLowerCase()) ?? false),
      ),
    [roles, search],
  );

  // ── Virtualization setup ──
  const rolesListRef = useRef<HTMLDivElement>(null);
  const rolesVirtualizer = useVirtualizer({
    count: filteredRoles.length,
    getScrollElement: () => rolesListRef.current,
    estimateSize: () => 58,
    overscan: 10,
    getItemKey: (index) => filteredRoles[index]?.id ?? index,
  });

  const isModalOpen = isCreateOpen || !!editingRole;
  const isPending = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = (payload: RoleCreatorPayload) => {
    if (editingRole) {
      updateMutation.mutate({ roleId: editingRole.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* ── Deck header ── */}
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <BracketLabel>{t('layout:sections.accessControl')}</BracketLabel>
          <h1 className="font-display text-lg font-semibold leading-none tracking-tight text-foreground">
            {t('roles.title')}
          </h1>
          <p className="text-mini text-muted-foreground">{t('roles.description')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LastUpdated queryKey={qk.adminRoles()} />
          <Button
            size="sm"
            onClick={() => {
              setIsCreateOpen(true);
              setEditingRole(null);
              setViewingRole(null);
            }}
            className="h-8 gap-1.5 rounded-sm px-3 text-mini"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('roles.createTitle')}
          </Button>
        </div>
      </header>

      {/* ── The deck: controls, columns and rows in one frame ── */}
      <div className="deck-panel flex min-h-0 flex-col overflow-hidden">
        {/* Control strip */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border/50 bg-surface-1/40 px-3 py-1.5">
          <label className="relative flex min-w-[12rem] flex-1 items-center">
            <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('roles.searchPlaceholder')}
              className="h-7 w-full rounded-sm border border-border/60 bg-background/40 pl-7 pr-2 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
            />
          </label>
          <span className="flex items-center gap-3">
            <Segmented muted className="text-micro">
              {t('roles.roleCount', { count: roles.length })}
            </Segmented>
            {presets.length > 0 && (
              <Segmented muted className="text-micro">
                {t('roles.presetCount', { count: presets.length })}
              </Segmented>
            )}
          </span>
        </div>

        {/* Column header — same grid as the rows, so columns always line up */}
        <div
          className={cn(
            GRID,
            'sticky top-0 z-10 hidden border-b border-border/50 bg-surface-1 py-1.5 pl-3 pr-3 text-muted-foreground/70 md:grid',
          )}
        >
          <span className="type-overline">{t('roles.nameLabel')}</span>
          <span className="type-overline">{t('roles.permissionsHeading')}</span>
          <span className="type-overline hidden justify-self-end md:inline-flex">{t('roles.nodesHeading')}</span>
          <span className="type-overline hidden justify-self-end md:inline-flex">{t('roles.usersLabel')}</span>
          <span className="type-overline justify-self-end">{t('common:actions.more')}</span>
        </div>

        {/* Rows */}
        <div ref={rolesListRef} className="max-h-[calc(100dvh-20rem)] min-w-0 overflow-y-auto bg-background/25">
          {isLoading ? (
            <div>
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className={cn(GRID, 'border-t border-border/40 py-2 pl-3 pr-3')}>
                  <div className="flex items-center gap-2">
                    <div className="h-3.5 w-3.5 animate-pulse bg-surface-3" />
                    <div className="h-3.5 w-28 animate-pulse bg-surface-3" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredRoles.length === 0 ? (
            <div className="p-3">
              <TabEmptyState
                title={search.trim() ? t('roles.emptyFilteredTitle') : t('roles.emptyTitle')}
                description={search.trim() ? t('roles.emptyFilteredDescription') : t('roles.emptyDescription')}
                action={
                  <Button
                    size="sm"
                    className="h-7 gap-1.5 rounded-sm px-2.5 text-mini"
                    onClick={() => {
                      setIsCreateOpen(true);
                      setEditingRole(null);
                      setViewingRole(null);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {t('roles.createTitle')}
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="relative" style={{ height: rolesVirtualizer.getTotalSize() }}>
              {rolesVirtualizer.getVirtualItems().map((item) => {
                const role = filteredRoles[item.index];
                if (!role) return null;
                return (
                  <div
                    key={item.key}
                    ref={rolesVirtualizer.measureElement}
                    data-index={item.index}
                    className="absolute left-0 right-0"
                    style={{ transform: `translateY(${item.start}px)` }}
                  >
                    <RoleRow
                      role={role}
                      isActive={viewingRole?.id === role.id}
                      onView={() => startView(role)}
                      onEdit={() => startEdit(role)}
                      onDelete={() => setDeletingRole(role)}
                      canDelete={role.userCount === 0}
                      isDeleting={deleteMutation.isPending}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Create/Edit role ── */}
      <RoleCreatorDialog
        open={isModalOpen}
        role={editingRole}
        presets={presets}
        isPending={isPending}
        onOpenChange={(open) => {
          if (!open) {
            setIsCreateOpen(false);
            setEditingRole(null);
          }
        }}
        onSubmit={handleSubmit}
      />

      {/* ── View Detail Modal ── */}
      <Dialog
        open={!!viewingRole && !editingRole && !isCreateOpen}
        onOpenChange={(open) => {
          if (!open) setViewingRole(null);
        }}
      >
        <DialogContent size="xl">
          <DialogHeader
            icon={viewingRole?.permissions?.includes('*') ? <KeyRound className="h-4 w-4" /> : <Shield className="h-4 w-4" />}
            iconClassName={viewingRole?.permissions?.includes('*')
              ? 'border-warning/20 bg-warning/10 text-warning'
              : 'border-primary/20 bg-primary/10 text-primary'}
          >
            <DialogTitle>{viewingRole ? roleLabel(t, viewingRole.name) : t('roles.viewTitleFallback')}</DialogTitle>
            <DialogDescription>
              {viewingRole?.description || t('roles.viewDescriptionFallback')}
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-3">
            {viewingRole && (
              <>
                <div className="flex flex-wrap gap-2 md:gap-3">
                  <div className="flex items-center gap-1.5 rounded-sm border border-border bg-card px-3 py-1.5 text-mini">
                    <Shield className="h-3 w-3 text-primary" />
                    <span className="text-muted-foreground">{t('roles.permissionsHeading')}</span>
                    <span className="font-semibold tabular-nums text-foreground">{viewingRole.permissions?.length || 0}</span>
                  </div>
                  {(viewingRole.userCount ?? 0) > 0 && (
                    <div className="flex items-center gap-1.5 rounded-sm border border-border bg-card px-3 py-1.5 text-mini">
                      <Users className="h-3 w-3 text-primary" />
                      <span className="text-muted-foreground">{t('roles.usersLabel')}</span>
                      <span className="font-semibold tabular-nums text-foreground">{viewingRole.userCount}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 rounded-sm border border-border bg-card px-3 py-1.5 text-mini">
                    <Clock className="h-3 w-3 text-muted-foreground" />
                    <span className="text-muted-foreground">{t('created')}</span>
                    <span className="font-medium text-foreground">{viewingRole.createdAt ? formatDate(viewingRole.createdAt) : '—'}</span>
                  </div>
                </div>

                {viewingRole.permissions?.includes('*') ? (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-sm border border-border/60 bg-surface-1/40 px-3 py-2 text-mini text-muted-foreground">
                    <Zap className="h-3 w-3 shrink-0" />
                    <span className="font-medium text-foreground">{t('roles.fullAccessTitle')}</span>
                    <span>{t('roles.fullAccessDescription')}</span>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3">
                    {getPermissionCategories(t, viewingRole.permissions || []).map((cat) => {
                      const catPerms = (viewingRole.permissions || []).filter((p: string) => {
                        const catData = PERMISSION_CATEGORIES.find((c) => permissionCategoryLabel(t, c.key) === cat.category);
                        return catData ? catData.permissions.includes(p) : p.split('.')[0] === cat.category.toLowerCase().split(' ')[0];
                      });
                      return (
                        <PermissionCategoryReadCard
                          key={cat.category}
                          category={cat}
                          permissions={catPerms}
                        />
                      );
                    })}
                  </div>
                )}

                <div className="space-y-1 border-t border-border/50 pt-3 text-micro text-muted-foreground">
                  <div>{t('roles.roleId')} <span className="font-mono">{viewingRole.id}</span></div>
                  {viewingRole.updatedAt !== viewingRole.createdAt && (
                    <div>{t('updatedAt', { date: formatDate(viewingRole.updatedAt), time: formatTime(viewingRole.updatedAt) })}</div>
                  )}
                </div>
              </>
            )}
          </DialogBody>

          <DialogFooter className="sm:justify-between">
            <div className="flex items-center gap-2">
              {viewingRole && (
                <Button variant="outline" size="sm" onClick={() => startEdit(viewingRole)} className="gap-1.5">
                  <Pencil className="h-3.5 w-3.5" />
                  {t('roles.editRole')}
                </Button>
              )}
              {viewingRole && viewingRole.userCount === 0 && (
                <Button variant="destructive" size="sm" onClick={() => setDeletingRole(viewingRole)} disabled={deleteMutation.isPending} className="gap-1.5">
                  <Trash2 className="h-3.5 w-3.5" />
                  {deleteMutation.isPending ? t('roles.deleting') : t('common:actions.delete')}
                </Button>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={() => setViewingRole(null)}>
              {t('common:actions.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation ── */}
      <ConfirmDialog
        open={!!deletingRole}
        title={t('roles.deleteTitle')}
        message={t('roles.deleteConfirm', { name: deletingRole ? roleLabel(t, deletingRole.name) : '' })}
        confirmText={t('common:actions.delete')}
        cancelText={t('common:actions.cancel')}
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
    </div>
  );
}

export default RolesPage;
