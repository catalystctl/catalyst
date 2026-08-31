import { useMemo, useRef, useState, useCallback } from 'react';
import { useMutation, useQuery } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import {
 Shield,
 Search,
 Plus,
 Trash2,
 Eye,
 Lock,
 KeyRound,
 Zap,
 ChevronRight,
 ChevronLeft,
 Check,
 Server,
 Info,
 Pencil,
 Clock,
 Users,
 Sparkles,
 Globe,
 Layers,
} from 'lucide-react';

import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { rolesApi } from '../../services/api/roles';
import { serversApi } from '../../services/api/servers';
import { useNodes } from '../../hooks/useNodes';
import {
 useServerPermissionOptions,
 serverPermissionLabel,
} from '../../lib/serverPermissions';
import type { RoleScope, RoleScopeMode } from '../../types/admin';
import { notifyError, notifySuccess } from '../../utils/notify';
import { NodeAssignmentsSelector } from '../../components/admin/NodeAssignmentsSelector';
import type { NodeAssignmentWithExpiration } from '../../components/admin/NodeAssignmentsSelector';
import { ConfirmDialog } from '../../components/shared/ConfirmDialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogToolbar,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import TabHeader from '../../components/servers/tabs/TabHeader';

import SectionHeader from '../../components/servers/tabs/SectionHeader';

import TabEmptyState from '../../components/servers/tabs/TabEmptyState';

// ── Permission categories ──────────────────────────────────────────────
const PERMISSION_CATEGORIES = [
 {
 label: 'Server',
 icon: Server,
 color: 'bg-primary/10',
 accent: 'text-primary',
 border: 'border-primary/20',
 bg: 'bg-primary/5',
 permissions: [
 'server.read', 'server.create', 'server.start', 'server.stop',
 'server.delete', 'server.suspend', 'server.transfer', 'server.schedule',
 ],
 },
 {
 label: 'Node',
 icon: Zap,
 color: 'bg-primary/10',
 accent: 'text-primary',
 border: 'border-primary/20',
 bg: 'bg-primary/5',
 permissions: [
 'node.read', 'node.create', 'node.update', 'node.delete',
 'node.view_stats', 'node.manage_allocation', 'node.assign',
 ],
 },
 {
 label: 'Location',
 icon: Globe,
 color: 'bg-primary/10',
 accent: 'text-primary',
 border: 'border-primary/20',
 bg: 'bg-primary/5',
 permissions: ['location.read', 'location.create', 'location.update', 'location.delete'],
 },
 {
 label: 'Template',
 icon: Info,
 color: 'bg-primary/10',
 accent: 'text-primary',
 border: 'border-primary/20',
 bg: 'bg-primary/5',
 permissions: ['template.read', 'template.create', 'template.update', 'template.delete'],
 },
 {
 label: 'User Management',
 icon: Users,
 color: 'bg-primary/10',
 accent: 'text-primary',
 border: 'border-primary/20',
 bg: 'bg-primary/5',
 permissions: ['user.read', 'user.create', 'user.update', 'user.delete', 'user.ban', 'user.unban', 'user.set_roles'],
 },
 {
 label: 'Role Management',
 icon: Shield,
 color: 'bg-primary/10',
 accent: 'text-primary',
 border: 'border-primary/20',
 bg: 'bg-primary/5',
 permissions: ['role.read', 'role.create', 'role.update', 'role.delete'],
 },
 {
 label: 'Backup',
 icon: Shield,
 color: 'bg-primary/10',
 accent: 'text-primary',
 border: 'border-primary/20',
 bg: 'bg-primary/5',
 permissions: ['backup.read', 'backup.create', 'backup.delete', 'backup.restore'],
 },
 {
 label: 'File Management',
 icon: Info,
 color: 'bg-primary/10',
 accent: 'text-primary',
 border: 'border-primary/20',
 bg: 'bg-primary/5',
 permissions: ['file.read', 'file.write'],
 },
 {
 label: 'Console',
 icon: Info,
 color: 'bg-primary/10',
 accent: 'text-primary',
 border: 'border-primary/20',
 bg: 'bg-primary/5',
 permissions: ['console.read', 'console.write'],
 },
 {
 label: 'Database',
 icon: Info,
 color: 'bg-primary/10',
 accent: 'text-primary',
 border: 'border-primary/20',
 bg: 'bg-primary/5',
 permissions: ['database.create', 'database.read', 'database.delete', 'database.rotate'],
 },
 {
 label: 'Alerts',
 icon: Info,
 color: 'bg-primary/10',
 accent: 'text-primary',
 border: 'border-primary/20',
 bg: 'bg-primary/5',
 permissions: ['alert.read', 'alert.create', 'alert.update', 'alert.delete'],
 },
 {
 label: 'System Administration',
 icon: Lock,
 color: 'bg-primary/10',
 accent: 'text-primary',
 border: 'border-primary/20',
 bg: 'bg-primary/5',
 permissions: ['admin.read', 'admin.write', 'apikey.manage'],
 },
];

// Permission presets
const PERMISSION_PRESETS = [
 {
 key: 'administrator', label: 'Administrator', description: 'Full unrestricted system access',
 icon: KeyRound, color: 'bg-primary/10',
 permissions: ['*'],
 },
 {
 key: 'moderator', label: 'Moderator', description: 'Manage servers, files, console — not users/roles',
 icon: Shield, color: 'bg-primary/10',
 permissions: [
 'node.read', 'node.update', 'node.view_stats', 'node.assign',
 'location.read', 'template.read', 'user.read', 'server.read',
 'server.start', 'server.stop', 'file.read', 'file.write',
 'console.read', 'console.write', 'alert.read', 'alert.create',
 'alert.update', 'alert.delete',
 ],
 },
 {
 key: 'user', label: 'User', description: 'Basic access to own servers',
 icon: Users, color: 'bg-primary/10',
 permissions: ['server.read'],
 },
 {
 key: 'support', label: 'Support', description: 'Read-only access for support staff',
 icon: Eye, color: 'bg-primary/10',
 permissions: [
 'node.read', 'node.view_stats', 'location.read', 'template.read',
 'server.read', 'file.read', 'console.read', 'alert.read', 'user.read',
 ],
 },
];

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
 if (perm === '*') return 'All Permissions';
 return PERMISSION_LABELS[perm] || perm.split('.').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' › ');
}

function getPermissionCategories(permissions: string[]) {
 if (permissions.includes('*')) return [{ category: 'All Permissions', count: 1, icon: KeyRound, color: 'bg-primary/10', accent: 'text-primary', border: 'border-primary/20' }];
 const categoryMap = new Map<string, { count: number; icon: typeof Shield; color: string; accent: string; border: string }>();
 for (const perm of permissions) {
 const prefix = perm.split('.')[0];
 const cat = PERMISSION_CATEGORIES.find((c) => c.permissions.some((p) => p.startsWith(prefix)));
 const label = cat?.label || prefix.charAt(0).toUpperCase() + prefix.slice(1);
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
function RoleCard({
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
 const isWildcard = role.permissions?.includes('*');
 const permCats = getPermissionCategories(role.permissions || []);

 return (
 <div
 onClick={onView}
 className={`group relative cursor-pointer overflow-hidden rounded-xl border p-5 transition-all duration-200 ${
 isActive
 ? 'border-primary/40 bg-primary/5'
 : 'border-border bg-card hover:border-primary/20'
 }`}
 >
  <div className="flex items-start justify-between gap-3">
 <div className="min-w-0 flex-1">
 <div className="flex items-center gap-2.5">
 <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${isWildcard ? 'bg-warning/10 text-warning' : 'bg-primary/10 text-primary'}`}>
 {isWildcard ? <KeyRound className="h-4 w-4" /> : <Shield className="h-4 w-4" />}
 </div>
 <div className="min-w-0">
 <div className="truncate font-semibold text-foreground">
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
 onClick={(e) => { e.stopPropagation(); onView(); }}
 title="View details"
 >
 <Eye className="h-3.5 w-3.5" />
 </button>
 <button
 className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-primary/5 hover:text-primary"
 onClick={(e) => { e.stopPropagation(); onEdit(); }}
 title="Edit"
 >
 <Pencil className="h-3.5 w-3.5" />
 </button>
 {canDelete ? (
 <button
 className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/5 hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
 onClick={(e) => { e.stopPropagation(); onDelete(); }}
 disabled={isDeleting}
 title="Delete"
 >
 <Trash2 className="h-3.5 w-3.5" />
 </button>
 ) : null}
 </div>
 </div>

 {/* Permission preview chips */}
 <div className="mt-4 flex flex-wrap gap-1.5">
 {isWildcard ? (
 <Badge className="gap-1 border-warning/30 bg-warning/10 text-warning">
 <Zap className="h-3 w-3" /> Full Admin
 </Badge>
 ) : (
 permCats.slice(0, 4).map((cat) => {
 const Icon = cat.icon;
 return (
 <Badge key={cat.category} variant="outline" className="gap-1 text-[10px]">
 <Icon className="h-2.5 w-2.5" /> {cat.category} ({cat.count})
 </Badge>
 );
 })
 )}
 {!isWildcard && permCats.length > 4 && (
 <Badge variant="secondary" className="text-[10px]">+{permCats.length - 4} more</Badge>
 )}
 </div>

 {/* Scoped access badges */}
 {(role.serverGrantCount > 0 || role.nodeGrantCount > 0) && (
 <div className="mt-1.5 flex flex-wrap gap-1.5">
 {role.nodeGrantCount > 0 && (
 <Badge variant="outline" className="gap-1 text-[10px]">
 <Globe className="h-2.5 w-2.5" /> {role.nodeGrantCount} node{role.nodeGrantCount > 1 ? 's' : ''} scoped
 </Badge>
 )}
 {role.serverGrantCount > 0 && (
 <Badge variant="outline" className="gap-1 text-[10px]">
 <Server className="h-2.5 w-2.5" /> {role.serverGrantCount} server{role.serverGrantCount > 1 ? 's' : ''} scoped
 </Badge>
 )}
 </div>
 )}

 {/* Footer */}
 <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
 <Badge variant="outline" className="text-[10px]">
 {role.permissions?.length || 0} perm{role.permissions?.length === 1 ? '' : 's'}
 </Badge>
 {role.userCount > 0 ? (
 <Badge variant="secondary" className="gap-1 text-[10px]">
 <Users className="h-2.5 w-2.5" /> {role.userCount}
 </Badge>
 ) : null}
 </div>
 </div>
 );
}

// ── Scoped Access Step (server/node grants with subuser permissions) ──
function ScopedAccessStep({
 scopeMode,
 onScopeModeChange,
 nodes,
 selectedNodeIds,
 onToggleNode,
 servers,
 selectedServerIds,
 onToggleServer,
 permissionOptions,
 selectedPermissions,
 onTogglePermission,
 search,
 onSearchChange,
 permissionSearch,
 onPermissionSearchChange,
}: {
 scopeMode: RoleScopeMode;
 onScopeModeChange: (mode: RoleScopeMode) => void;
 nodes: Array<{ id: string; name: string }>;
 selectedNodeIds: string[];
 onToggleNode: (id: string) => void;
 servers: Array<{ id: string; name: string; nodeName?: string }>;
 selectedServerIds: string[];
 onToggleServer: (id: string) => void;
 permissionOptions: string[];
 selectedPermissions: Set<string>;
 onTogglePermission: (perm: string) => void;
 search: string;
 onSearchChange: (value: string) => void;
 permissionSearch: string;
 onPermissionSearchChange: (value: string) => void;
}) {
 const modeCards: Array<{ mode: RoleScopeMode; title: string; description: string }> = [
 { mode: 'none', title: 'No scoped access', description: 'Members only get the global permissions above.' },
 { mode: 'nodes', title: 'By node', description: 'Grant the selected permissions on every server hosted on the chosen nodes.' },
 { mode: 'servers', title: 'By server', description: 'Grant the selected permissions on specific servers, on any node.' },
 ];

 const filteredNodes = nodes.filter((n) =>
 n.name.toLowerCase().includes(search.toLowerCase())
 );
 const filteredServers = servers.filter(
 (s) =>
 s.name.toLowerCase().includes(search.toLowerCase()) ||
 (s.nodeName?.toLowerCase().includes(search.toLowerCase()) ?? false)
 );
 const filteredPerms = permissionOptions.filter((p) =>
 p.toLowerCase().includes(permissionSearch.toLowerCase())
 );
 const hasAllNodes = selectedNodeIds.includes('*');

 return (
 <div className="space-y-4">
 {/* Mode selection */}
 <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
 {modeCards.map(({ mode, title, description }) => (
 <button
 key={mode}
 type="button"
 onClick={() => onScopeModeChange(mode)}
 className={`rounded-xl border p-4 text-left transition-all duration-200 ${
 scopeMode === mode
 ? 'border-primary/40 bg-primary/5'
 : 'border-border bg-card hover:border-primary/20'
 }`}
 >
 <div className={`text-sm font-semibold ${scopeMode === mode ? 'text-primary' : 'text-foreground'}`}>
 {title}
 </div>
 <div className="mt-1 text-[11px] text-muted-foreground">{description}</div>
 </button>
 ))}
 </div>

 {/* Resource selection */}
 {scopeMode === 'nodes' && (
 <div>
 <div className="mb-2 flex items-center justify-between gap-3">
 <span className="text-sm font-semibold text-foreground">Nodes</span>
 <div className="relative w-56">
 <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
 <Input
 value={search}
 onChange={(e) => onSearchChange(e.target.value)}
 placeholder="Search nodes…"
 className="h-8 pl-8 text-xs"
 />
 </div>
 </div>

 {/* All nodes */}
 <label className="mb-2 flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:border-primary/20">
 <input
 type="checkbox"
 className="h-3.5 w-3.5 rounded border-border/40 bg-card text-primary-600"
 checked={hasAllNodes}
 onChange={() => onToggleNode('*')}
 />
 <Globe className="h-3.5 w-3.5 text-muted-foreground" />
 <span className="text-xs font-semibold text-foreground">All nodes</span>
 <span className="text-[11px] text-muted-foreground">Every server in the panel</span>
 </label>

 <div className="max-h-44 space-y-1.5 overflow-y-auto rounded-xl border border-border bg-card p-2">
 {filteredNodes.map((node) => (
 <label
 key={node.id}
 className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs text-foreground transition-colors hover:bg-primary/5"
 >
 <input
 type="checkbox"
 className="h-3.5 w-3.5 rounded border-border/40 bg-card text-primary-600"
 checked={selectedNodeIds.includes(node.id)}
 onChange={() => onToggleNode(node.id)}
 />
 <Server className="h-3 w-3 text-muted-foreground" />
 <span>{node.name}</span>
 </label>
 ))}
 {filteredNodes.length === 0 && (
 <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">No nodes match</div>
 )}
 </div>
 </div>
 )}

 {scopeMode === 'servers' && (
 <div>
 <div className="mb-2 flex items-center justify-between gap-3">
 <span className="text-sm font-semibold text-foreground">Servers</span>
 <div className="relative w-56">
 <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
 <Input
 value={search}
 onChange={(e) => onSearchChange(e.target.value)}
 placeholder="Search servers…"
 className="h-8 pl-8 text-xs"
 />
 </div>
 </div>
 <div className="max-h-44 space-y-1.5 overflow-y-auto rounded-xl border border-border bg-card p-2">
 {filteredServers.map((server) => (
 <label
 key={server.id}
 className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs text-foreground transition-colors hover:bg-primary/5"
 >
 <input
 type="checkbox"
 className="h-3.5 w-3.5 rounded border-border/40 bg-card text-primary-600"
 checked={selectedServerIds.includes(server.id)}
 onChange={() => onToggleServer(server.id)}
 />
 <span className="truncate">{server.name}</span>
 {server.nodeName && (
 <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{server.nodeName}</span>
 )}
 </label>
 ))}
 {filteredServers.length === 0 && (
 <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">No servers match</div>
 )}
 </div>
 </div>
 )}

 {/* Permission checklist — the shared subuser permission list */}
 {scopeMode !== 'none' && (
 <div>
 <div className="mb-2 flex items-center justify-between gap-3">
 <div className="flex items-center gap-2">
 <span className="text-sm font-semibold text-foreground">Permissions</span>
 <Badge variant={selectedPermissions.size > 0 ? 'default' : 'outline'} className="tabular-nums text-[10px]">
 {selectedPermissions.size} selected
 </Badge>
 </div>
 <div className="relative w-56">
 <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
 <Input
 value={permissionSearch}
 onChange={(e) => onPermissionSearchChange(e.target.value)}
 placeholder="Search permissions…"
 className="h-8 pl-8 text-xs"
 />
 </div>
 </div>
 <div className="grid max-h-52 grid-cols-1 gap-1.5 overflow-y-auto rounded-xl border border-border bg-card p-3 sm:grid-cols-2">
 {filteredPerms.map((perm) => (
 <label key={perm} className="flex cursor-pointer items-center gap-2 text-[11px] text-muted-foreground">
 <input
 type="checkbox"
 className="h-3.5 w-3.5 rounded border-border/40 bg-card text-primary-600"
 checked={selectedPermissions.has(perm)}
 onChange={() => onTogglePermission(perm)}
 />
 <span>{serverPermissionLabel(perm)}</span>
 <span className="ml-auto font-mono text-[9px] opacity-60">{perm}</span>
 </label>
 ))}
 {filteredPerms.length === 0 && (
 <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">No permissions match</div>
 )}
 </div>
 <div className="mt-2 text-[11px] text-muted-foreground">
 Members of this role get exactly these permissions on the selected{' '}
 {scopeMode === 'nodes' ? 'nodes’ servers' : 'servers'} — like adding a subuser, in bulk.
 </div>
 </div>
 )}
 </div>
 );
}

// ── Wizard Step Indicator ──
function StepIndicator({ steps, currentStep, onStepClick, canNavigate }: {
 steps: { label: string; icon: typeof Shield }[];
 currentStep: number;
 onStepClick: (i: number) => void;
 canNavigate: boolean[];
}) {
 return (
 <div className="flex items-center justify-center gap-1">
 {steps.map((step, i) => {
 const Icon = step.icon;
 const isActive = i === currentStep;
 const isComplete = i < currentStep;
 const canClick = canNavigate[i];

 return (
 <div key={step.label} className="flex items-center">
 <button
 onClick={() => canClick && onStepClick(i)}
 disabled={!canClick}
 className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
 isActive
 ? 'bg-primary text-primary-foreground '
 : isComplete
 ? 'bg-primary/10 text-primary'
 : canClick
 ? 'text-muted-foreground hover:text-foreground hover:bg-surface-2'
 : 'text-muted-foreground/40 cursor-not-allowed'
 }`}
 >
 <Icon className="h-3 w-3" />
 <span className="hidden sm:inline">{step.label}</span>
 {isComplete && <Check className="h-2.5 w-2.5" />}
 </button>
 {i < steps.length - 1 && (
 <ChevronRight className={`mx-1 h-3 w-3 ${i < currentStep ? 'text-primary' : 'text-muted-foreground/30'}`} />
 )}
 </div>
 );
 })}
 </div>
 );
}

// ── Permission Chip ──
function PermissionChip({
 permission,
 selected,
 onToggle,
 compact,
}: {
 permission: string;
 selected: boolean;
 onToggle: () => void;
 compact?: boolean;
}) {
 return (
 <button
 type="button"
 onClick={onToggle}
 className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-all duration-150 ${
 compact ? 'px-1.5 py-0.5 text-[10px]' : ''
 } ${
 selected
 ? 'border-primary/30 bg-primary/10 text-primary '
 : 'border-border bg-card text-muted-foreground hover:border-primary/20 hover:text-foreground'
 }`}
 >
 {selected && <Check className={`h-2.5 w-2.5 ${compact ? 'h-2 w-2' : ''}`} />}
 {formatPermission(permission)}
 </button>
 );
}

// ── Permission Category Card (editable) ──
function PermissionCategoryCard({
 category,
 selectedPermissions,
 onTogglePermission,
 onToggleCategory,
 searchQuery,
}: {
 category: typeof PERMISSION_CATEGORIES[0];
 selectedPermissions: Set<string>;
 onTogglePermission: (perm: string) => void;
 onToggleCategory: (perms: string[], select: boolean) => void;
 searchQuery: string;
}) {
 const Icon = category.icon;
 const allSelected = category.permissions.every((p) => selectedPermissions.has(p));
 const someSelected = category.permissions.some((p) => selectedPermissions.has(p));
 const selectedCount = category.permissions.filter((p) => selectedPermissions.has(p)).length;

 const filteredPerms = searchQuery
 ? category.permissions.filter((p) =>
 p.toLowerCase().includes(searchQuery.toLowerCase()) ||
 (PERMISSION_LABELS[p] || '').toLowerCase().includes(searchQuery.toLowerCase())
 )
 : category.permissions;

 if (filteredPerms.length === 0) return null;

 return (
 <div className={`rounded-xl border transition-all duration-200 ${someSelected ? category.border : 'border-border'}`}>
 {/* Category header */}
 <div
 className="flex items-center justify-between px-3 py-2.5 cursor-pointer select-none md:px-4 md:py-3"
 onClick={() => onToggleCategory(category.permissions, !allSelected)}
 >
 <div className="flex items-center gap-2.5">
 <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${category.color}`}>
 <Icon className={`h-3.5 w-3.5 ${category.accent}`} />
 </div>
 <span className="text-sm font-semibold text-foreground">{category.label}</span>
 </div>

 <div className="flex items-center gap-2">
 <span className={`text-[11px] tabular-nums ${someSelected ? category.accent : 'text-muted-foreground'}`}>
 {selectedCount}/{category.permissions.length}
 </span>
 <div className={`flex h-5 w-9 items-center rounded-full transition-all duration-200 ${
 allSelected ? 'bg-primary' : someSelected ? 'bg-primary/40' : 'bg-surface-3'
 }`}>
 <div className={`h-3.5 w-3.5 rounded-full bg-card  transition-all duration-200 ${
 allSelected ? 'translate-x-[18px]' : someSelected ? 'translate-x-[10px]' : 'translate-x-[2px]'
 }`} />
 </div>
 </div>
 </div>

 {/* Permission chips */}
 <div className="border-t border-border/50 px-3 py-2.5 md:px-4 md:py-3">
 <div className="flex flex-wrap gap-1.5">
 {filteredPerms.map((perm) => (
 <PermissionChip
 key={perm}
 permission={perm}
 selected={selectedPermissions.has(perm)}
 onToggle={() => onTogglePermission(perm)}
 />
 ))}
 </div>
 </div>
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
 const Icon = category.icon;
 return (
 <div className={`rounded-xl border ${category.border}`}>
 <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
 <div className="flex items-center gap-2.5">
 <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${category.color}`}>
 <Icon className={`h-3.5 w-3.5 ${category.accent}`} />
 </div>
 <span className="text-sm font-semibold text-foreground">{category.category}</span>
 </div>
 <Badge variant="secondary" className="text-[10px] tabular-nums">{category.count}</Badge>
 </div>
 <div className="px-4 py-3">
 <div className="flex flex-wrap gap-1.5">
 {permissions.map((perm) => (
 <span key={perm} className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-1 text-[11px] text-foreground">
 <Check className="h-2.5 w-2.5 text-primary" />
 {formatPermission(perm)}
 </span>
 ))}
 </div>
 </div>
 </div>
 );
}

// ── Preset Card ──
function PresetCard({
 preset,
 onApply,
 isActive,
}: {
 preset: typeof PERMISSION_PRESETS[0];
 onApply: () => void;
 isActive: boolean;
}) {
 const Icon = preset.icon;
 const isWildcard = preset.permissions.includes('*');
 return (
 <button
 type="button"
 onClick={onApply}
 className={`group flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-all duration-200 ${
 isActive
 ? 'border-primary/40 bg-primary/5 '
 : 'border-border bg-card hover:border-primary/20'
 }`}
 >
 <div className="flex items-center gap-2.5 w-full">
 <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${preset.color}`}>
 <Icon className="h-4 w-4 text-foreground/80" />
 </div>
 <div className="min-w-0 flex-1">
 <div className="text-sm font-semibold text-foreground">{preset.label}</div>
 <div className="text-[11px] text-muted-foreground">{preset.description}</div>
 </div>
 </div>
 <div className="flex flex-wrap gap-1">
 {isWildcard ? (
 <Badge className="gap-1 border-warning/30 bg-warning/10 text-warning text-[9px]">
 <Zap className="h-2.5 w-2.5" /> All Permissions
 </Badge>
 ) : (
 <>
 {preset.permissions.slice(0, 3).map((p) => (
 <Badge key={p} variant="outline" className="text-[9px]">
 {formatPermission(p)}
 </Badge>
 ))}
 {preset.permissions.length > 3 && (
 <Badge variant="secondary" className="text-[9px]">+{preset.permissions.length - 3}</Badge>
 )}
 </>
 )}
 </div>
 </button>
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

 // Wizard state
 const [wizardStep, setWizardStep] = useState(0);

 // Scoped access state (role wizard step 3)
 const [scopeMode, setScopeMode] = useState<RoleScopeMode>('none');
 const [scopedNodeIds, setScopedNodeIds] = useState<string[]>([]);
 const [scopedServerIds, setScopedServerIds] = useState<string[]>([]);
 const [scopedPermissions, setScopedPermissions] = useState<Set<string>>(new Set());
 const [scopeSearch, setScopeSearch] = useState('');
 const [scopePermSearch, setScopePermSearch] = useState('');

 // Form state
 const [name, setName] = useState('');
 const [description, setDescription] = useState('');
 const [selectedPermissions, setSelectedPermissions] = useState<Set<string>>(new Set());
 const [permissionSearch, setPermissionSearch] = useState('');
 const [selectedNodeIds, setSelectedNodeIds] = useState<NodeAssignmentWithExpiration[]>([]);
 const [activePreset, setActivePreset] = useState<string | null>(null);

 // Fetch roles
 const { data: roles = [], isLoading } = useQuery({
 queryKey: qk.adminRoles(),
 queryFn: rolesApi.list,
 staleTime: 5 * 60 * 1000,
 });

 // Scoped-access inputs: shared permission list, nodes, servers
 const { data: scopePermissionOptions = [] } = useServerPermissionOptions();
 const { data: scopeNodes = [] } = useNodes();
 const { data: scopeServers = [] } = useQuery({
 queryKey: ['admin-servers-for-scope'],
 queryFn: () => serversApi.list({ limit: 500 }),
 staleTime: 60 * 1000,
 });

 // Fetch presets
 const { data: presets = [] } = useQuery({
 queryKey: qk.rolePresets(),
 queryFn: rolesApi.getPresets,
 staleTime: 10 * 60 * 1000,
 });

 const createMutation = useMutation({
 mutationFn: (data: { name: string; description?: string; permissions: string[]; scope?: RoleScope }) => rolesApi.create(data),
 onSuccess: () => {
 notifySuccess('Role created');
 resetForm();
 setIsCreateOpen(false);
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminRoles() });
 },
 onError: (error: any) => notifyError(error?.response?.data?.error || 'Failed to create role'),
 });

 const updateMutation = useMutation({
 mutationFn: ({ roleId, data }: { roleId: string; data: Partial<{ name: string; description?: string; permissions: string[]; scope?: RoleScope }> }) =>
 rolesApi.update(roleId, data),
 onSuccess: () => {
 notifySuccess('Role updated');
 resetForm();
 setEditingRole(null);
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminRoles() });
 },
 onError: (error: any) => notifyError(error?.response?.data?.error || 'Failed to update role'),
 });

 const deleteMutation = useMutation({
 mutationFn: (roleId: string) => rolesApi.delete(roleId),
 onSuccess: () => {
 notifySuccess('Role deleted');
 setViewingRole(null);
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminRoles() });
 },
 onError: (error: any) => notifyError(error?.response?.data?.error || 'Failed to delete role'),
 });

 const togglePermission = useCallback((permission: string) => {
 setSelectedPermissions((prev) => {
 const newSet = new Set(prev);
 if (newSet.has(permission)) newSet.delete(permission);
 else newSet.add(permission);
 return newSet;
 });
 setActivePreset(null);
 }, []);

 const toggleCategory = useCallback((perms: string[], select: boolean) => {
 setSelectedPermissions((prev) => {
 const newSet = new Set(prev);
 perms.forEach((p) => (select ? newSet.add(p) : newSet.delete(p)));
 return newSet;
 });
 setActivePreset(null);
 }, []);

 const applyPreset = useCallback((preset: typeof PERMISSION_PRESETS[0]) => {
 setName(preset.label);
 setDescription(preset.description);
 setSelectedPermissions(new Set(preset.permissions));
 setActivePreset(preset.key);
 }, []);

 const resetForm = useCallback(() => {
 setName('');
 setDescription('');
 setSelectedPermissions(new Set());
 setPermissionSearch('');
 setSelectedNodeIds([]);
 setWizardStep(0);
 setActivePreset(null);
 setScopeMode('none');
 setScopedNodeIds([]);
 setScopedServerIds([]);
 setScopedPermissions(new Set());
 setScopeSearch('');
 setScopePermSearch('');
 }, []);

 const startEdit = async (role: any) => {
 const requestId = editingRequestRef.current + 1;
 editingRequestRef.current = requestId;
 setEditingRole(role);
 setName(role.name);
 setDescription(role.description || '');
 setSelectedPermissions(new Set(role.permissions || []));
 setIsCreateOpen(false);
 setViewingRole(null);
 setWizardStep(0);
 setActivePreset(null);

 // Prefill scoped access from the role detail (grants are not in the list payload)
 try {
 const detail = await rolesApi.get(role.id);
 if (editingRequestRef.current === requestId && detail?.scope) {
 setScopeMode(detail.scope.mode ?? 'none');
 setScopedNodeIds(detail.scope.nodeIds ?? []);
 setScopedServerIds(detail.scope.serverIds ?? []);
 setScopedPermissions(new Set(detail.scope.permissions ?? []));
 }
 } catch {
 // keep defaults — the wizard treats unknown scope as 'none'
 }

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

 const scopeSelectionValid =
 scopeMode === 'none' ||
 (scopeMode === 'nodes' && scopedNodeIds.length > 0 && scopedPermissions.size > 0) ||
 (scopeMode === 'servers' && scopedServerIds.length > 0 && scopedPermissions.size > 0);
 const canSubmit =
 name.trim().length > 0 && selectedPermissions.size > 0 && scopeSelectionValid;
 const isModalOpen = isCreateOpen || !!editingRole;

 const wizardSteps = [
 { label: 'Details', icon: Info },
 { label: 'Permissions', icon: Shield },
 { label: 'Node Access', icon: Server },
 { label: 'Scoped Access', icon: Layers },
 ];

 const canNavigateStep = [
 true,
 name.trim().length > 0,
 name.trim().length > 0 && selectedPermissions.size > 0,
 name.trim().length > 0 && selectedPermissions.size > 0,
 ];

 const goToStep = (step: number) => {
 if (step < 0 || step >= wizardSteps.length) return;
 if (!canNavigateStep[step]) return;
 setWizardStep(step);
 };

 const handleSubmit = () => {
 const scope: RoleScope | undefined =
 scopeMode === 'none'
 ? { mode: 'none', permissions: [] }
 : {
 mode: scopeMode,
 nodeIds: scopeMode === 'nodes' ? scopedNodeIds : undefined,
 serverIds: scopeMode === 'servers' ? scopedServerIds : undefined,
 permissions: Array.from(scopedPermissions),
 };
 const data = {
 name: name.trim(),
 description: description.trim() || undefined,
 permissions: Array.from(selectedPermissions),
 scope,
 };
 if (editingRole) {
 updateMutation.mutate({ roleId: editingRole.id, data });
 } else {
 createMutation.mutate(data);
 }
 };

 return (
 <div className="space-y-5">
 {/* ── Header ── */}
 <TabHeader
 icon={Shield}
 title="Roles"
 description="Manage user roles and their permissions"
 actions={
 <Button size="sm" onClick={() => { resetForm(); setIsCreateOpen(true); setEditingRole(null); setViewingRole(null); }} className="gap-1.5">
 <Plus className="h-3.5 w-3.5" />
 Create role
 </Button>
 }
 />

 {/* ── Search Bar ── */}
 <div className="flex flex-wrap items-center gap-3">
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
 </div>

 {/* ── Role Grid ── */}
 {isLoading ? (
 <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
 {[1, 2, 3, 4, 5, 6].map((i) => (
 <div key={i} className="rounded-xl border border-border bg-card p-5">
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
 </div>
 ) : filteredRoles.length === 0 ? (
 <TabEmptyState
 title={search.trim() ? 'No roles found' : 'No roles'}
 description={search.trim() ? 'Try a different role name or description.' : 'Create a role to define permissions for users.'}
 action={
 <Button size="sm" onClick={() => { resetForm(); setIsCreateOpen(true); setEditingRole(null); setViewingRole(null); }} className="gap-1.5">
 <Plus className="h-3.5 w-3.5" />
 Create role
 </Button>
 }
 />
 ) : (
 <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
 {filteredRoles.map((role: any) => (
 <RoleCard
 key={role.id}
 role={role}
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

 {/* ── Create/Edit Wizard Modal ── */}
<Dialog
 open={isModalOpen}
 onOpenChange={(open) => {
 if (!open) {
 resetForm();
 setIsCreateOpen(false);
 setEditingRole(null);
 }
 }}
>
 <DialogContent size="2xl">
 <DialogHeader icon={<Shield className="h-4 w-4" />}>
 <DialogTitle>{editingRole ? 'Edit role' : 'Create role'}</DialogTitle>
 <DialogDescription>
 {editingRole ? 'Update role name, description, and permissions.' : 'Define a new role with specific permissions.'}
 </DialogDescription>
 </DialogHeader>

 <DialogToolbar className="overflow-x-auto">
 <StepIndicator
 steps={wizardSteps}
 currentStep={wizardStep}
 onStepClick={goToStep}
 canNavigate={canNavigateStep}
 />
 </DialogToolbar>

 <DialogBody>
 {/* Step 0: Details */}
 {wizardStep === 0 && (
 <div className="space-y-6">
 {/* Presets — only for create */}
 {!editingRole && (
 <div>
 <div className="flex items-center gap-2 mb-3">
 <Sparkles className="h-4 w-4 text-warning" />
 <span className="text-sm font-semibold text-foreground">Quick start from a preset</span>
 </div>
 <div className="grid grid-cols-2 gap-3">
 {PERMISSION_PRESETS.map((preset) => (
 <PresetCard
 key={preset.key}
 preset={preset}
 onApply={() => applyPreset(preset)}
 isActive={activePreset === preset.key}
 />
 ))}
 </div>
 </div>
 )}

 {/* Basic Info */}
 <div>
 <SectionHeader icon={Info} title="Role details" />
 <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
 <label className="block space-y-1.5">
 <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">Name <span className="text-destructive">*</span></span>
 <Input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Moderator" />
 </label>
 <label className="block space-y-1.5">
 <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">Description</span>
 <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe what this role can do…" />
 </label>
 </div>
 </div>
 </div>
 )}

 {/* Step 1: Permissions */}
 {wizardStep === 1 && (
 <div className="space-y-4">
 <div className="flex items-center justify-between gap-3">
 <div className="flex items-center gap-2">
 <span className="text-sm font-semibold text-foreground">Permissions</span>
 <Badge variant={selectedPermissions.size > 0 ? 'default' : 'outline'} className="tabular-nums text-[10px]">
 {selectedPermissions.size} selected
 </Badge>
 </div>
 <div className="relative w-56">
 <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
 <Input
 value={permissionSearch}
 onChange={(e) => setPermissionSearch(e.target.value)}
 placeholder="Search permissions…"
 className="h-8 pl-8 text-xs"
 />
 </div>
 </div>

 {/* Wildcard toggle */}
 <button
 type="button"
 onClick={() => togglePermission('*')}
 className={`flex items-center gap-3 rounded-xl border p-4 w-full transition-all duration-200 ${
 selectedPermissions.has('*')
 ? 'border-warning/30 bg-warning/5'
 : 'border-border bg-card hover:border-warning/20'
 }`}
 >
 <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning/10">
 <Zap className="h-4 w-4 text-warning" />
 </div>
 <div className="text-left flex-1">
 <div className="text-sm font-semibold text-warning">Wildcard — All Permissions</div>
 <div className="text-[11px] text-muted-foreground">Grants unrestricted access to every system permission</div>
 </div>
 <div className={`flex h-6 w-11 items-center rounded-full transition-all duration-200 ${
 selectedPermissions.has('*') ? 'bg-warning' : 'bg-surface-3'
 }`}>
 <div className={`h-4 w-4 rounded-full bg-card  transition-all duration-200 ${
 selectedPermissions.has('*') ? 'translate-x-6' : 'translate-x-1'
 }`} />
 </div>
 </button>

 {/* Category grid */}
 {!selectedPermissions.has('*') && (
 <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
 {PERMISSION_CATEGORIES.map((category) => (
 <PermissionCategoryCard
 key={category.label}
 category={category}
 selectedPermissions={selectedPermissions}
 onTogglePermission={togglePermission}
 onToggleCategory={toggleCategory}
 searchQuery={permissionSearch}
 />
 ))}
 </div>
 )}
 </div>
 )}

 {/* Step 2: Node Access */}
 {wizardStep === 2 && (
 <div>
 <NodeAssignmentsSelector
 roleId={editingRole?.id}
 selectedNodes={selectedNodeIds}
 onSelectionChange={setSelectedNodeIds}
 disabled={createMutation.isPending || updateMutation.isPending}
 />
 </div>
 )}

 {/* Step 3: Scoped Access (server/node grants with subuser permissions) */}
 {wizardStep === 3 && (
 <ScopedAccessStep
 scopeMode={scopeMode}
 onScopeModeChange={setScopeMode}
 nodes={scopeNodes as Array<{ id: string; name: string }>}
 selectedNodeIds={scopedNodeIds}
 onToggleNode={(id: string) =>
 setScopedNodeIds((prev) =>
 prev.includes(id) ? prev.filter((n) => n !== id) : [...prev, id]
 )
 }
 servers={scopeServers as Array<{ id: string; name: string; nodeName?: string }>}
 selectedServerIds={scopedServerIds}
 onToggleServer={(id: string) =>
 setScopedServerIds((prev) =>
 prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
 )
 }
 permissionOptions={scopePermissionOptions}
 selectedPermissions={scopedPermissions}
 onTogglePermission={(perm: string) =>
 setScopedPermissions((prev) => {
 const newSet = new Set(prev);
 if (newSet.has(perm)) newSet.delete(perm);
 else newSet.add(perm);
 return newSet;
 })
 }
 search={scopeSearch}
 onSearchChange={setScopeSearch}
 permissionSearch={scopePermSearch}
 onPermissionSearchChange={setScopePermSearch}
 />
 )}
 </DialogBody>

 <DialogFooter className="sm:justify-between">
 <div className="text-xs text-muted-foreground">
 {selectedPermissions.size > 0 && (
 <span>{selectedPermissions.size} permission{selectedPermissions.size === 1 ? '' : 's'} selected</span>
 )}
 </div>
 <div className="flex items-center gap-2">
 {wizardStep > 0 && (
 <Button variant="outline" size="sm" onClick={() => goToStep(wizardStep - 1)} className="gap-1">
 <ChevronLeft className="h-3.5 w-3.5" />
 Back
 </Button>
 )}
 {wizardStep < wizardSteps.length - 1 && (
 <Button
 size="sm"
 onClick={() => goToStep(wizardStep + 1)}
 disabled={!canNavigateStep[wizardStep + 1]}
 className="gap-1"
 >
 Next
 <ChevronRight className="h-3.5 w-3.5" />
 </Button>
 )}
 {wizardStep === wizardSteps.length - 1 && (
 <Button
 size="sm"
 disabled={!canSubmit || createMutation.isPending || updateMutation.isPending}
 onClick={handleSubmit}
 className="gap-1"
 >
 {createMutation.isPending || updateMutation.isPending
 ? 'Saving…'
 : editingRole
 ? 'Save changes'
 : 'Create role'}
 </Button>
 )}
 <Button variant="ghost" size="sm" onClick={() => { resetForm(); setIsCreateOpen(false); setEditingRole(null); }}>
 Cancel
 </Button>
 </div>
 </DialogFooter>
 </DialogContent>
 </Dialog>

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
 <DialogTitle>{viewingRole?.name ?? 'Role details'}</DialogTitle>
 <DialogDescription>
 {viewingRole?.description || 'Role permissions and metadata.'}
 </DialogDescription>
 </DialogHeader>

 <DialogBody className="space-y-4">
 {viewingRole && (
 <>
 <div className="flex flex-wrap gap-2 md:gap-3">
 <div className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs">
 <Shield className="h-3 w-3 text-primary" />
 <span className="text-muted-foreground">Permissions</span>
 <span className="font-semibold tabular-nums text-foreground">{viewingRole.permissions?.length || 0}</span>
 </div>
 {(viewingRole.userCount ?? 0) > 0 && (
 <div className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs">
 <Users className="h-3 w-3 text-primary" />
 <span className="text-muted-foreground">Users</span>
 <span className="font-semibold tabular-nums text-foreground">{viewingRole.userCount}</span>
 </div>
 )}
 <div className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs">
 <Clock className="h-3 w-3 text-muted-foreground" />
 <span className="text-muted-foreground">Created</span>
 <span className="font-medium text-foreground">{viewingRole.createdAt ? new Date(viewingRole.createdAt).toLocaleDateString() : '—'}</span>
 </div>
 </div>

 {viewingRole.permissions?.includes('*') ? (
 <div className="flex flex-col items-center gap-3 rounded-xl border border-warning/20 bg-warning/5 p-6 text-center">
 <div className="flex h-12 w-12 items-center justify-center rounded-full bg-warning/20">
 <Zap className="h-6 w-6 text-warning" />
 </div>
 <div>
 <div className="text-base font-semibold text-warning">Full Administrator Access</div>
 <div className="text-xs text-warning/70">This role has unrestricted access to all system permissions.</div>
 </div>
 </div>
 ) : (
 <div className="grid grid-cols-1 gap-3">
 {getPermissionCategories(viewingRole.permissions || []).map((cat) => {
 const catPerms = (viewingRole.permissions || []).filter((p: string) => {
 const catData = PERMISSION_CATEGORIES.find((c) => c.label === cat.category);
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

 <div className="space-y-1 border-t border-border/50 pt-3 text-[11px] text-muted-foreground">
 <div>Role ID: <span className="font-mono">{viewingRole.id}</span></div>
 {viewingRole.updatedAt !== viewingRole.createdAt && (
 <div>Updated: {new Date(viewingRole.updatedAt).toLocaleDateString()} at {new Date(viewingRole.updatedAt).toLocaleTimeString()}</div>
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
 Edit role
 </Button>
 )}
 {viewingRole && viewingRole.userCount === 0 && (
 <Button variant="destructive" size="sm" onClick={() => setDeletingRole(viewingRole)} disabled={deleteMutation.isPending} className="gap-1.5">
 <Trash2 className="h-3.5 w-3.5" />
 {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
 </Button>
 )}
 </div>
 <Button variant="ghost" size="sm" onClick={() => setViewingRole(null)}>
 Close
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>

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
 </div>
 );
}

export default RolesPage;
