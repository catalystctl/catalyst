import { useMemo, useRef, useState, useCallback } from 'react';
import { useMutation } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import {
 Users,
 UserPlus,
 Search,
 Filter,
 ArrowUpDown,
 Trash2,
 Shield,
 Mail,
 X,
 Ban,
 CheckCircle,
 MoreHorizontal,
 KeyRound,
 Fingerprint,
 ShieldCheck,
 Link2,
 Unlink,
 Globe,
 Clock,
 ChevronRight,
 ChevronLeft,
 Check,
 Server,
 Pencil,
 Lock,
 Eye,
 User,
 MailCheck,
} from 'lucide-react';
import TabHeader from '../../components/servers/tabs/TabHeader';
import TabLoadingState from '../../components/servers/tabs/TabLoadingState';
import TabEmptyState from '../../components/servers/tabs/TabEmptyState';
import ConfirmDialog from '../../components/shared/ConfirmDialog';
import Pagination from '../../components/shared/Pagination';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
 Select,
 SelectContent,
 SelectItem,
 SelectTrigger,
 SelectValue,
} from '../../components/ui/select';
import {
 DropdownMenu,
 DropdownMenuContent,
 DropdownMenuItem,
 DropdownMenuSeparator,
 DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { useAdminRoles, useAdminServers, useAdminUsers } from '../../hooks/useAdmin';
import { adminApi } from '../../services/api/admin';
import { notifyError, notifySuccess } from '../../utils/notify';
import { NodeAssignmentsSelector } from '../../components/admin/NodeAssignmentsSelector';
import type { NodeAssignmentWithExpiration } from '../../components/admin/NodeAssignmentsSelector';
import type { AdminUser } from '../../types/admin';
import { ModalPortal } from '@/components/ui/modal-portal';

const pageSize = 20;

// ── Wizard Step Indicator ──
function StepIndicator({ steps, currentStep, onStepClick, canNavigate }: {
 steps: { label: string; icon: typeof User }[];
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
 ? 'bg-primary text-primary-foreground'
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

// ── Role Chip ──
function RoleChip({ role, selected, onToggle }: { role: { id: string; name: string }; selected: boolean; onToggle: () => void }) {
 return (
 <button
 type="button"
 onClick={onToggle}
 className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all duration-150 ${
 selected
 ? 'border-primary/30 bg-primary/10 text-primary shadow-sm'
 : 'border-border/30 bg-card text-muted-foreground hover:border-primary/20 hover:text-foreground'
 }`}
 >
 <Shield className={`h-3 w-3 ${selected ? 'text-primary' : ''}`} />
 {selected && <Check className="h-2.5 w-2.5" />}
 {role.name}
 </button>
 );
}

// ── Server Chip ──
function ServerChip({ server, selected, onToggle }: { server: { id: string; name: string }; selected: boolean; onToggle: () => void }) {
 return (
 <button
 type="button"
 onClick={onToggle}
 className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all duration-150 ${
 selected
 ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-700 shadow-sm shadow-cyan-500/10'
 : 'border-border/30 bg-card text-muted-foreground hover:border-cyan-500/20 hover:text-foreground'
 }`}
 >
 <Server className={`h-3 w-3 ${selected ? 'text-cyan-600' : ''}`} />
 {selected && <Check className="h-2.5 w-2.5" />}
 {server.name}
 </button>
 );
}

// ── Security Section (read-only, for edit modal only) ──
function SecuritySection({ user, onWipePasskeys, onWipe2fa, onEnforce2fa, onUnlink, loading }: {
 user: AdminUser;
 onWipePasskeys: () => void;
 onWipe2fa: () => void;
 onEnforce2fa: (enforce: boolean) => void;
 onUnlink: (accountId: string, providerId: string) => void;
 loading: boolean;
}) {
 const passkeys = user.passkeys ?? [];
 const accounts = user.accounts ?? [];
 const has2fa = !!(user.twoFactor?.length);
 const twoFactorEnabled = user.twoFactorEnabled ?? false;
 const lastLogin = user.lastSuccessfulLogin;
 const lastIp = user.lastSignInIp;

 const providerLabel = (id: string) => {
 const labels: Record<string, string> = {
 credential: 'Email & Password',
 whmcs: 'WHMCS',
 paymenter: 'Paymenter',
 google: 'Google',
 github: 'GitHub',
 discord: 'Discord',
 };
 return labels[id] ?? id;
 };

 return (
 <div className="space-y-4">
 {/* Sign-in info */}
 {(lastLogin || lastIp) && (
 <div className="flex flex-wrap items-center gap-2">
 {lastIp && (
 <div className="flex items-center gap-1.5 rounded-lg border border-border/30 bg-surface-2 px-2.5 py-1.5 text-xs">
 <Globe className="h-3 w-3 text-muted-foreground" />
 <span className="text-muted-foreground">Last IP:</span>
 <span className="font-mono text-foreground">{lastIp}</span>
 </div>
 )}
 {lastLogin && (
 <div className="flex items-center gap-1.5 rounded-lg border border-border/30 bg-surface-2 px-2.5 py-1.5 text-xs">
 <Clock className="h-3 w-3 text-muted-foreground" />
 <span className="text-muted-foreground">Last sign-in:</span>
 <span className="text-foreground">{new Date(lastLogin).toLocaleString()}</span>
 </div>
 )}
 </div>
 )}

 {/* 2FA status */}
 <div className="rounded-xl border border-border/30 bg-card p-4">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-3">
 <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${twoFactorEnabled ? 'bg-emerald-500/10' : 'bg-surface-2'}`}>
 <ShieldCheck className={`h-4 w-4 ${twoFactorEnabled ? 'text-emerald-600' : 'text-muted-foreground'}`} />
 </div>
 <div>
 <div className="text-sm font-medium text-foreground">Two-Factor Authentication</div>
 <div className="text-[11px] text-muted-foreground">
 {has2fa ? (twoFactorEnabled ? 'Enabled and enforced' : 'Set up but not enforced') : 'Not set up'}
 </div>
 </div>
 </div>
 <div className="flex items-center gap-1.5">
 {has2fa && !twoFactorEnabled && (
 <Button variant="outline" size="sm" className="gap-1 text-xs" disabled={loading} onClick={() => onEnforce2fa(true)}>
 <ShieldCheck className="h-3 w-3" /> Enforce
 </Button>
 )}
 {twoFactorEnabled && has2fa && (
 <Button variant="outline" size="sm" className="gap-1 text-xs" disabled={loading} onClick={() => onEnforce2fa(false)}>
 Unenforce
 </Button>
 )}
 {has2fa && (
 <Button variant="outline" size="sm" className="gap-1 text-xs text-destructive hover:bg-destructive/5 hover:text-destructive hover:border-destructive/20" disabled={loading} onClick={onWipe2fa}>
 <Trash2 className="h-3 w-3" /> Wipe 2FA
 </Button>
 )}
 </div>
 </div>
 </div>

 {/* Passkeys */}
 <div className="rounded-xl border border-border/30 bg-card p-4">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-3">
 <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${passkeys.length > 0 ? 'bg-blue-500/10' : 'bg-surface-2'}`}>
 <Fingerprint className={`h-4 w-4 ${passkeys.length > 0 ? 'text-blue-600' : 'text-muted-foreground'}`} />
 </div>
 <div>
 <div className="text-sm font-medium text-foreground">Passkeys</div>
 <div className="text-[11px] text-muted-foreground">
 {passkeys.length ? `${passkeys.length} passkey${passkeys.length === 1 ? '' : 's'} registered` : 'No passkeys registered'}
 </div>
 </div>
 </div>
 {passkeys.length > 0 && (
 <Button variant="outline" size="sm" className="gap-1 text-xs text-destructive hover:bg-destructive/5 hover:text-destructive hover:border-destructive/20" disabled={loading} onClick={onWipePasskeys}>
 <Trash2 className="h-3 w-3" /> Wipe all
 </Button>
 )}
 </div>
 {passkeys.length > 0 && (
 <div className="mt-3 space-y-1.5">
 {passkeys.map((pk) => (
 <div key={pk.id} className="flex items-center justify-between rounded-lg bg-surface-2/50 px-3 py-2 text-xs">
 <span className="text-muted-foreground">{pk.name || 'Unnamed passkey'}</span>
 <span className="text-[10px] text-muted-foreground/60">{new Date(pk.createdAt).toLocaleDateString()}</span>
 </div>
 ))}
 </div>
 )}
 </div>

 {/* Linked SSO accounts */}
 <div className="rounded-xl border border-border/30 bg-card p-4">
 <div className="flex items-center gap-2 mb-3">
 <Link2 className="h-4 w-4 text-muted-foreground" />
 <span className="text-sm font-medium text-foreground">Linked Accounts</span>
 </div>
 {accounts.length === 0 ? (
 <p className="text-xs text-muted-foreground">No linked accounts</p>
 ) : (
 <div className="space-y-2">
 {accounts.map((account) => {
 const isSSO = account.providerId !== 'credential';
 return (
 <div key={account.id} className="flex items-center justify-between rounded-lg bg-surface-2/50 px-3 py-2 text-xs">
 <div className="flex items-center gap-2">
 <KeyRound className={`h-3.5 w-3.5 ${isSSO ? 'text-primary' : 'text-muted-foreground'}`} />
 <span className="text-foreground">{providerLabel(account.providerId)}</span>
 {isSSO && (
 <span className="text-[10px] font-mono text-muted-foreground/60">
 {account.accountId.slice(0, 12)}…
 </span>
 )}
 </div>
 {isSSO && (
 <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-[11px] text-destructive hover:bg-destructive/5 hover:text-destructive" disabled={loading} onClick={() => onUnlink(account.id, account.providerId)}>
 <Unlink className="h-3 w-3" /> Unlink
 </Button>
 )}
 </div>
 );
 })}
 </div>
 )}
 </div>
 </div>
 );
}

// ── Main Component ──
function UsersPage() {

 const [page, setPage] = useState(1);
 const [search, setSearch] = useState('');
 const [sort, setSort] = useState('username-asc');
 const [roleFilter, setRoleFilter] = useState('');
 const [statusFilter, setStatusFilter] = useState('');
 const [selectedIds, setSelectedIds] = useState<string[]>([]);
 const [showFilters, setShowFilters] = useState(false);

 // View user state
 const [viewingUser, setViewingUser] = useState<AdminUser | null>(null);

 // Create user state
 const [isCreateOpen, setIsCreateOpen] = useState(false);
 const [createEmail, setCreateEmail] = useState('');
 const [createUsername, setCreateUsername] = useState('');
 const [createPassword, setCreatePassword] = useState('');
 const [createRoleIds, setCreateRoleIds] = useState<string[]>([]);
 const [createServerIds, setCreateServerIds] = useState<string[]>([]);
 const [roleSearch, setRoleSearch] = useState('');
 const [serverSearch, setServerSearch] = useState('');

 // Edit user state
 const [editingUserId, setEditingUserId] = useState<string | null>(null);
 const editingRequestRef = useRef(0);
 const [editEmail, setEditEmail] = useState('');
 const [editUsername, setEditUsername] = useState('');
 const [editPassword, setEditPassword] = useState('');
 const [editRoleIds, setEditRoleIds] = useState<string[]>([]);
 const [editServerIds, setEditServerIds] = useState<string[]>([]);
 const [editRoleSearch, setEditRoleSearch] = useState('');
 const [editServerSearch, setEditServerSearch] = useState('');
 const [selectedNodeIds, setSelectedNodeIds] = useState<NodeAssignmentWithExpiration[]>([]);

 // Wizard state
 const [wizardStep, setWizardStep] = useState(0);
 const [, setWizardDirection] = useState(1);

 // Delete/ban confirmation state
 const [deletingUser, setDeletingUser] = useState<{ id: string; username: string } | null>(null);
 const [banTargets, setBanTargets] = useState<{ userIds: string[]; label: string } | null>(null);
 const [unbanTargets, setUnbanTargets] = useState<{ userIds: string[]; label: string } | null>(null);
 const [banReason, setBanReason] = useState('');

 // Security action confirmation state
 const [wipePasskeyTarget, setWipePasskeyTarget] = useState<{ id: string; username: string; count: number } | null>(null);
 const [wipe2faTarget, setWipe2faTarget] = useState<{ id: string; username: string } | null>(null);
 const [enforce2faTarget, setEnforce2faTarget] = useState<{ id: string; username: string; enforce: boolean } | null>(null);
 const [unlinkTarget, setUnlinkTarget] = useState<{ userId: string; username: string; accountId: string; providerId: string } | null>(null);

 const { data, isLoading } = useAdminUsers({
 page,
 limit: pageSize,
 search: search.trim() || undefined,
 });
 const { data: roles = [] } = useAdminRoles();
 const { data: serversResponse } = useAdminServers({ page: 1, limit: 200 });

 const users = useMemo(() => data?.users ?? [], [data?.users]);
 const pagination = data?.pagination;
 const servers = useMemo(() => serversResponse?.servers ?? [], [serversResponse?.servers]);

 const sortedRoles = useMemo(
 () => [...roles].sort((a, b) => a.name.localeCompare(b.name)),
 [roles],
 );

 const sortedServers = useMemo(
 () => servers.slice().sort((a, b) => a.name.localeCompare(b.name)),
 [servers],
 );

 const hasActiveFilters = roleFilter || statusFilter;

 const clearFilters = () => {
 setRoleFilter('');
 setStatusFilter('');
 setPage(1);
 };

 const filteredUsers = useMemo(() => {
 let filtered = users;
 if (roleFilter) {
 filtered = filtered.filter((user) =>
 user.roles.some((role) => role.id === roleFilter),
 );
 }
 if (statusFilter === 'banned') {
 filtered = filtered.filter((user) => user.banned);
 } else if (statusFilter === 'active') {
 filtered = filtered.filter((user) => !user.banned);
 } else if (statusFilter === 'unverified') {
 filtered = filtered.filter((user) => !user.emailVerified);
 }
 const sorted = [...filtered];
 sorted.sort((a, b) => {
 switch (sort) {
 case 'username-desc':
 return b.username.localeCompare(a.username);
 case 'email-asc':
 return a.email.localeCompare(b.email);
 case 'email-desc':
 return b.email.localeCompare(a.email);
 case 'created':
 return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
 case 'roles':
 return a.roles.length - b.roles.length;
 default:
 return a.username.localeCompare(b.username);
 }
 });
 return sorted;
 }, [users, roleFilter, statusFilter, sort]);

 const filteredIds = useMemo(() => filteredUsers.map((user) => user.id), [filteredUsers]);
 const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.includes(id));

 const currentUserIds = useMemo(() => new Set(users.map((u) => u.id)), [users]);
 const validSelectedIds = useMemo(
 () => selectedIds.filter((id) => currentUserIds.has(id)),
 [selectedIds, currentUserIds],
 );

 if (validSelectedIds.length !== selectedIds.length) {
 setSelectedIds(validSelectedIds);
 }

 // ── Derived filter lists ──
 const roleCounts = useMemo(() => {
 const counts: Record<string, number> = {};
 for (const user of users) {
 for (const role of user.roles) {
 counts[role.id] = (counts[role.id] || 0) + 1;
 }
 }
 return counts;
 }, [users]);

 const bannedCount = useMemo(
 () => users.filter((u) => u.banned).length,
 [users],
 );

 const unverifiedCount = useMemo(
 () => users.filter((u) => !u.emailVerified).length,
 [users],
 );

 // ── Filtered role/server lists for modals ──
 const filteredModalRoles = useMemo(
 () =>
 sortedRoles.filter((role) =>
 role.name.toLowerCase().includes(roleSearch.trim().toLowerCase()),
 ),
 [sortedRoles, roleSearch],
 );

 const filteredModalServers = useMemo(
 () =>
 sortedServers.filter(
 (server) =>
 server.name.toLowerCase().includes(serverSearch.trim().toLowerCase()) ||
 server.id.toLowerCase().includes(serverSearch.trim().toLowerCase()),
 ),
 [sortedServers, serverSearch],
 );

 const filteredEditRoles = useMemo(
 () =>
 sortedRoles.filter((role) =>
 role.name.toLowerCase().includes(editRoleSearch.trim().toLowerCase()),
 ),
 [sortedRoles, editRoleSearch],
 );

 const filteredEditServers = useMemo(
 () =>
 sortedServers.filter(
 (server) =>
 server.name.toLowerCase().includes(editServerSearch.trim().toLowerCase()) ||
 server.id.toLowerCase().includes(editServerSearch.trim().toLowerCase()),
 ),
 [sortedServers, editServerSearch],
 );

 // ── Mutations ──
 const createMutation = useMutation({
 mutationFn: () =>
 adminApi.createUser({
 email: createEmail.trim(),
 username: createUsername.trim(),
 password: createPassword.trim(),
 roleIds: createRoleIds,
 serverIds: createServerIds,
 }),
 onSuccess: () => {
 notifySuccess('User created');
 resetCreateForm();
 setIsCreateOpen(false);
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminUsers() });
 },
 onError: (error: any) => {
 const rawError = error?.response?.data?.error;
 const message =
 (typeof rawError === 'string'
 ? rawError
 : rawError?.message || rawError?.error) || 'Failed to create user';
 notifyError(message);
 },
 });

 const updateMutation = useMutation({
 mutationFn: (userId: string) =>
 adminApi.updateUser(userId, {
 email: editEmail.trim(),
 username: editUsername.trim(),
 password: editPassword.trim() ? editPassword.trim() : undefined,
 roleIds: editRoleIds,
 serverIds: editServerIds,
 }),
 onSuccess: () => {
 notifySuccess('User updated');
 setEditingUserId(null);
 setEditRoleSearch('');
 setEditServerSearch('');
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminUsers() });
 queryClient.invalidateQueries({ queryKey: qk.adminRoles() });
 },
 onError: (error: any) => {
 const rawError = error?.response?.data?.error;
 const message =
 (typeof rawError === 'string'
 ? rawError
 : rawError?.message || rawError?.error) || 'Failed to update user';
 notifyError(message);
 },
 });

 const deleteMutation = useMutation({
 mutationFn: (userId: string) => adminApi.deleteUser(userId),
 onSuccess: () => {
 notifySuccess('User deleted');
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminUsers() });
 queryClient.invalidateQueries({ queryKey: qk.adminRoles() });
 },
 onError: (error: any) => {
 const rawError = error?.response?.data?.error;
 const message =
 (typeof rawError === 'string'
 ? rawError
 : rawError?.message || rawError?.error) || 'Failed to delete user';
 notifyError(message);
 },
 });

 const banMutation = useMutation({
 mutationKey: qk.mutation.adminUserBan(),
 mutationFn: (payload: { userIds: string[]; reason?: string }) => {
 return Promise.all(
 payload.userIds.map((userId) =>
 adminApi.banUser(userId, payload.reason),
 ),
 );
 },
 onSuccess: (_data, variables) => {
 notifySuccess(
 `${variables.userIds.length} user${variables.userIds.length === 1 ? '' : 's'} banned`,
 );
 setSelectedIds([]);
 setBanTargets(null);
 setBanReason('');
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminUsers() });
 },
 onError: (error: any) => {
 const message =
 error?.response?.data?.error || 'Failed to ban user(s)';
 notifyError(message);
 },
 });

 const unbanMutation = useMutation({
 mutationKey: qk.mutation.adminUserUnban(),
 mutationFn: (userIds: string[]) => {
 return Promise.all(userIds.map((userId) => adminApi.unbanUser(userId)));
 },
 onSuccess: (_data, userIds) => {
 notifySuccess(
 `${userIds.length} user${userIds.length === 1 ? '' : 's'} unbanned`,
 );
 setSelectedIds([]);
 setUnbanTargets(null);
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminUsers() });
 },
 onError: (error: any) => {
 const message =
 error?.response?.data?.error || 'Failed to unban user(s)';
 notifyError(message);
 },
 });

 const wipePasskeysMutation = useMutation({
 mutationFn: (userId: string) => adminApi.wipePasskeys(userId),
 onSuccess: (_data, userId) => {
 notifySuccess('Passkeys wiped');
 setWipePasskeyTarget(null);
 const updatedUser = users.find((u) => u.id === userId);
 if (updatedUser) handleEditUser(updatedUser);
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminUsers() });
 },
 onError: (error: any) => {
 notifyError(error?.response?.data?.error || 'Failed to wipe passkeys');
 },
 });

 const wipe2faMutation = useMutation({
 mutationFn: (userId: string) => adminApi.wipeTwoFactor(userId),
 onSuccess: (_data, userId) => {
 notifySuccess('2FA wiped');
 setWipe2faTarget(null);
 const updatedUser = users.find((u) => u.id === userId);
 if (updatedUser) handleEditUser(updatedUser);
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminUsers() });
 },
 onError: (error: any) => {
 notifyError(error?.response?.data?.error || 'Failed to wipe 2FA');
 },
 });

 const enforce2faMutation = useMutation({
 mutationFn: ({ userId, enforce }: { userId: string; enforce: boolean }) =>
 adminApi.enforceTwoFactor(userId, enforce),
 onSuccess: (_data, variables) => {
 notifySuccess(variables.enforce ? '2FA enforcement enabled' : '2FA enforcement disabled');
 setEnforce2faTarget(null);
 const updatedUser = users.find((u) => u.id === variables.userId);
 if (updatedUser) handleEditUser(updatedUser);
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminUsers() });
 },
 onError: (error: any) => {
 notifyError(error?.response?.data?.error || 'Failed to update 2FA enforcement');
 },
 });

 const unlinkAccountMutation = useMutation({
 mutationFn: ({ userId, accountId }: { userId: string; accountId: string }) =>
 adminApi.unlinkAccount(userId, accountId),
 onSuccess: (_data, variables) => {
 notifySuccess('SSO account unlinked');
 setUnlinkTarget(null);
 const updatedUser = users.find((u) => u.id === variables.userId);
 if (updatedUser) handleEditUser(updatedUser);
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminUsers() });
 },
 onError: (error: any) => {
 notifyError(error?.response?.data?.error || 'Failed to unlink SSO account');
 },
 });

 const verifyEmailMutation = useMutation({
 mutationFn: (userId: string) => adminApi.verifyUserEmail(userId),
 onSuccess: () => {
 notifySuccess('Email verified');
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminUsers() });
 },
 onError: (error: any) => {
 notifyError(error?.response?.data?.error || 'Failed to verify email');
 },
 });

 const bulkDeleteMutation = useMutation({
 mutationFn: (userIds: string[]) => {
 return Promise.all(userIds.map((userId) => adminApi.deleteUser(userId)));
 },
 onSuccess: (_data, userIds) => {
 notifySuccess(
 `${userIds.length} user${userIds.length === 1 ? '' : 's'} deleted`,
 );
 setSelectedIds([]);
 setDeletingUser(null);
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminUsers() });
 queryClient.invalidateQueries({ queryKey: qk.adminRoles() });
 },
 onError: (error: any) => {
 const message =
 error?.response?.data?.error || 'Failed to delete user(s)';
 notifyError(message);
 },
 });

 // ── Helpers ──
 const toggleItem = (items: string[], value: string) =>
 items.includes(value) ? items.filter((item) => item !== value) : [...items, value];

 const canSubmitCreate = useMemo(
 () => createEmail.trim() && createUsername.trim() && createPassword.trim().length >= 8,
 [createEmail, createUsername, createPassword],
 );

 const canSubmitEdit = useMemo(
 () =>
 editEmail.trim() &&
 editUsername.trim() &&
 (!editPassword || editPassword.length >= 8),
 [editEmail, editUsername, editPassword],
 );

 const resetCreateForm = useCallback(() => {
 setCreateEmail('');
 setCreateUsername('');
 setCreatePassword('');
 setCreateRoleIds([]);
 setCreateServerIds([]);
 setRoleSearch('');
 setServerSearch('');
 setWizardStep(0);
 }, []);

 const resetEditForm = useCallback(() => {
 setEditingUserId(null);
 setEditRoleSearch('');
 setEditServerSearch('');
 setSelectedNodeIds([]);
 setWizardStep(0);
 }, []);

 const startView = (user: AdminUser) => {
 setViewingUser(user);
 setEditingUserId(null);
 setIsCreateOpen(false);
 };

 const handleEditUser = async (user: AdminUser) => {
 const nextId = user.id;
 const requestId = editingRequestRef.current + 1;
 editingRequestRef.current = requestId;
 setEditingUserId(nextId);
 setEditEmail(user.email);
 setEditUsername(user.username);
 setEditPassword('');
 setEditRoleIds(user.roles.map((role) => role.id));
 setEditServerIds([]);
 setEditRoleSearch('');
 setEditServerSearch('');
 setWizardStep(0);

 adminApi
 .getUserServers(nextId)
 .then((serverSelection) => {
 if (editingRequestRef.current === requestId) {
 setEditServerIds(serverSelection);
 }
 })
 .catch(() => {
 notifyError('Failed to load user servers');
 });

 try {
 const response = await fetch(`/api/roles/users/${nextId}/nodes`, {
 headers: { 'Content-Type': 'application/json' },
 });
 const data = await response.json();
 const nodes = data.data || [];
 if (editingRequestRef.current === requestId) {
 setSelectedNodeIds(
 nodes.map((n: any) => ({
 nodeId: n.nodeId,
 nodeName: n.name,
 source: n.source || 'user',
 roleName: n.roleName,
 expiresAt: n.expiresAt,
 })),
 );
 }
 } catch {
 setSelectedNodeIds([]);
 }
 };

 const handleBulkBan = (userIds: string[], label: string) => {
 if (!userIds.length) return;
 setBanTargets({ userIds, label });
 setBanReason('');
 };

 const handleBulkUnban = (userIds: string[], label: string) => {
 if (!userIds.length) return;
 setUnbanTargets({ userIds, label });
 };

 const handleBulkDelete = (userIds: string[], label: string) => {
 if (!userIds.length) return;
 setDeletingUser({ id: userIds.join(','), username: label });
 };

 const handleBulkVerifyEmails = (userIds: string[]) => {
 if (!userIds.length) return;
 // Only verify unverified users — filter to those that need it
 const unverifiedIds = userIds.filter((id) => {
 const user = users.find((u) => u.id === id);
 return user && !user.emailVerified;
 });
 if (unverifiedIds.length === 0) return;
 Promise.all(unverifiedIds.map((id) => adminApi.verifyUserEmail(id)))
 .then(() => {
 notifySuccess(`Verified ${unverifiedIds.length} email${unverifiedIds.length !== 1 ? 's' : ''}`);
 queryClient.invalidateQueries({ queryKey: qk.adminUsers() });
 })
 .catch((err: any) => {
 notifyError(err?.response?.data?.error || 'Failed to verify emails');
 });
 };

 // ── Wizard logic ──
 const createSteps = [
 { label: 'Account', icon: User },
 { label: 'Roles & Servers', icon: Shield },
 { label: 'Node Access', icon: Server },
 ];

 const editSteps = [
 { label: 'Account', icon: User },
 { label: 'Roles & Servers', icon: Shield },
 { label: 'Node Access', icon: Server },
 { label: 'Security', icon: Lock },
 ];

 const currentSteps = editingUserId ? editSteps : createSteps;

 const canNavigateCreateStep = [
 true,
 !!(createEmail.trim() && createUsername.trim() && createPassword.trim().length >= 8),
 !!(createEmail.trim() && createUsername.trim() && createPassword.trim().length >= 8),
 ];

 const canNavigateEditStep = [
 true,
 !!(editEmail.trim() && editUsername.trim() && (!editPassword || editPassword.length >= 8)),
 !!(editEmail.trim() && editUsername.trim() && (!editPassword || editPassword.length >= 8)),
 !!(editEmail.trim() && editUsername.trim() && (!editPassword || editPassword.length >= 8)),
 ];

 const canNavigateStep = editingUserId ? canNavigateEditStep : canNavigateCreateStep;

 const goToStep = (step: number) => {
 if (step < 0 || step >= currentSteps.length) return;
 if (!canNavigateStep[step]) return;
 setWizardDirection(step > wizardStep ? 1 : -1);
 setWizardStep(step);
 };

 const isModalOpen = isCreateOpen || !!editingUserId;
 const editingUser = editingUserId ? users.find((u) => u.id === editingUserId) : null;

 return (
 <div className="space-y-5">
 <TabHeader
 icon={Users}
 title="User Management"
 description="Create and manage accounts with role-based access."
 actions={
 <div className="flex flex-wrap gap-2">
 {isLoading ? (
 <>
 <div className="h-8 w-24 animate-pulse rounded-lg bg-surface-3" />
 <div className="h-8 w-24 animate-pulse rounded-lg bg-surface-3" />
 </>
 ) : (
 <>
 <Badge variant="outline" className="h-8 gap-1.5 px-3 text-xs">
 <span className="h-2 w-2 rounded-full bg-surface-3" />
 {data?.pagination?.total ?? 0} users
 </Badge>
 {roles.length > 0 && (
 <Badge variant="outline" className="h-8 gap-1.5 px-3 text-xs">
 <Shield className="h-2.5 w-2.5" />
 {roles.length} role{roles.length === 1 ? '' : 's'}
 </Badge>
 )}
 {bannedCount > 0 && (
 <Badge variant="destructive" className="h-8 gap-1.5 px-3 text-xs">
 <Ban className="h-2.5 w-2.5" />
 {bannedCount} banned
 </Badge>
 )}
 {unverifiedCount > 0 && (
 <Badge variant="outline" className="h-8 gap-1.5 px-3 text-xs text-warning border-warning/30">
 <MailCheck className="h-2.5 w-2.5" />
 {unverifiedCount} unverified
 </Badge>
 )}
 </>
 )}
 <Button
 size="sm"
 onClick={() => {
 resetCreateForm();
 setIsCreateOpen(true);
 }}
 className="gap-1.5"
 >
 <UserPlus className="h-3.5 w-3.5" />
 Create user
 </Button>
 </div>
 }
 />

 {/* ── Search & Controls Bar ── */}
 <div
 className="flex flex-wrap items-center gap-2.5"
 >
 {/* Search input */}
 <div className="relative min-w-[200px] flex-1 max-w-sm">
 <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
 <Input
 value={search}
 onChange={(event) => {
 setSearch(event.target.value);
 setPage(1);
 }}
 placeholder="Search users by name, email, or ID…"
 className="pl-9"
 />
 </div>

 {/* Filter toggle */}
 <Button
 variant={hasActiveFilters ? 'default' : 'outline'}
 size="sm"
 onClick={() => setShowFilters(!showFilters)}
 className="gap-2"
 >
 <Filter className="h-3.5 w-3.5" />
 Filters
 {hasActiveFilters && (
 <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/20 text-[10px] font-bold">
 {[roleFilter, statusFilter].filter(Boolean).length}
 </span>
 )}
 </Button>

 {/* Sort */}
 <Select value={sort} onValueChange={setSort}>
 <SelectTrigger className="w-40 gap-2 text-xs">
 <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="username-asc">Username A→Z</SelectItem>
 <SelectItem value="username-desc">Username Z→A</SelectItem>
 <SelectItem value="email-asc">Email A→Z</SelectItem>
 <SelectItem value="email-desc">Email Z→A</SelectItem>
 <SelectItem value="created">Newest first</SelectItem>
 <SelectItem value="roles">Most roles</SelectItem>
 </SelectContent>
 </Select>

 {/* Results count */}
 <span className="text-xs text-muted-foreground">
 {filteredUsers.length} of {data?.pagination?.total ?? users.length}
 </span>
 </div>

 {/* ── Expandable Filter Panel ── */}
 {showFilters && (
 <div
 className="overflow-hidden"
 >
 <div className="rounded-xl border border-border/30 bg-card/80 p-4 backdrop-blur-sm">
 <div className="flex flex-wrap items-end gap-4">
 <label className="space-y-1.5">
 <span className="text-xs font-medium text-muted-foreground">Role</span>
 <Select
 value={roleFilter || 'all'}
 onValueChange={(value) => {
 setRoleFilter(value === 'all' ? '' : value);
 setPage(1);
 }}
 >
 <SelectTrigger className="w-44">
 <SelectValue placeholder="All roles" />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="all">All roles</SelectItem>
 {sortedRoles.map((role) => (
 <SelectItem key={role.id} value={role.id}>
 {role.name}
 {roleCounts[role.id] ? ` (${roleCounts[role.id]})` : ''}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </label>
 <label className="space-y-1.5">
 <span className="text-xs font-medium text-muted-foreground">Status</span>
 <Select
 value={statusFilter || 'all'}
 onValueChange={(value) => {
 setStatusFilter(value === 'all' ? '' : value);
 setPage(1);
 }}
 >
 <SelectTrigger className="w-44">
 <SelectValue placeholder="All statuses" />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="all">All statuses</SelectItem>
 <SelectItem value="active">
 Active
 {bannedCount > 0 ? ` (${users.length - bannedCount})` : ''}
 </SelectItem>
 <SelectItem value="banned">
 Banned{bannedCount > 0 ? ` (${bannedCount})` : ''}
 </SelectItem>
 <SelectItem value="unverified">
 Unverified{unverifiedCount > 0 ? ` (${unverifiedCount})` : ''}
 </SelectItem>
 </SelectContent>
 </Select>
 </label>
 {hasActiveFilters && (
 <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1.5 text-xs">
 <X className="h-3 w-3" />
 Clear all
 </Button>
 )}
 </div>
 </div>
 </div>
 )}

 {/* ── Bulk Actions Bar ── */}
 {selectedIds.length > 0 && (
 <div
 className="overflow-hidden"
 >
 <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5">
 <div className="flex items-center gap-3">
 <span className="text-sm font-medium text-foreground">
 {selectedIds.length} selected
 </span>
 <button
 onClick={() => setSelectedIds([])}
 className="text-xs text-muted-foreground transition-colors hover:text-foreground"
 >
 Clear
 </button>
 </div>
 <div className="flex items-center gap-1.5">
 <Button variant="outline" size="sm" onClick={() => handleBulkBan(selectedIds, `${selectedIds.length} users`)} disabled={banMutation.isPending || unbanMutation.isPending || bulkDeleteMutation.isPending} className="gap-1.5 text-xs text-destructive hover:bg-destructive/5 hover:text-destructive hover:border-destructive/20">
 <Ban className="h-3 w-3" /> Ban
 </Button>
 <Button variant="outline" size="sm" onClick={() => handleBulkUnban(selectedIds, `${selectedIds.length} users`)} disabled={banMutation.isPending || unbanMutation.isPending || bulkDeleteMutation.isPending} className="gap-1.5 text-xs text-success hover:bg-success/5 hover:text-success hover:border-success/20">
 <CheckCircle className="h-3 w-3" /> Unban
 </Button>
 {selectedIds.some((id) => !users.find((u) => u.id === id)?.emailVerified) && (
 <Button variant="outline" size="sm" onClick={() => handleBulkVerifyEmails(selectedIds)} disabled={verifyEmailMutation.isPending} className="gap-1.5 text-xs text-success hover:bg-success/5 hover:text-success hover:border-success/20">
 <MailCheck className="h-3 w-3" /> Verify Emails
 </Button>
 )}
 <div className="mx-1 h-4 w-px bg-border" />
 <Button variant="destructive" size="sm" onClick={() => handleBulkDelete(selectedIds, `${selectedIds.length} users`)} disabled={banMutation.isPending || unbanMutation.isPending || bulkDeleteMutation.isPending} className="gap-1.5 text-xs">
 <Trash2 className="h-3 w-3" /> Delete
 </Button>
 </div>
 </div>
 </div>
 )}

 {/* ── User List ── */}
 <div>
 <div className="rounded-xl border border-border/30 bg-card/80 shadow-sm">
 {isLoading ? (
 <div className="p-4">
 <TabLoadingState rows={6} />
 </div>
 ) : filteredUsers.length > 0 ? (
 <>
 {/* Select-all header */}
 <div className="flex items-center gap-3 border-b border-border/30 px-4 py-2">
 <label className="flex items-center gap-2">
 <input
 type="checkbox"
 checked={allSelected}
 onChange={() =>
 setSelectedIds((prev) => {
 if (allSelected) {
 return prev.filter((id) => !filteredIds.includes(id));
 }
 return Array.from(new Set([...prev, ...filteredIds]));
 })
 }
 className="h-4 w-4 rounded border-border/40 bg-card text-primary-600"
 />
 <span className="text-xs font-medium text-muted-foreground">
 Select all
 </span>
 </label>
 </div>

 {/* User rows */}
 <div className="divide-y divide-border/50">
 {filteredUsers.map((user: AdminUser) => {
 const isSelected = selectedIds.includes(user.id);

 return (
 <div
 key={user.id}
 className={`group relative flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-2/50 cursor-pointer ${
 isSelected ? 'bg-primary/5' : viewingUser?.id === user.id ? 'bg-primary/5 border-l-2 border-primary' : ''
 }`}
 onClick={() => startView(user)}
 >
 {/* Checkbox */}
 <input
 type="checkbox"
 checked={isSelected}
 onChange={() =>
 setSelectedIds((prev) =>
 prev.includes(user.id)
 ? prev.filter((id) => id !== user.id)
 : [...prev, user.id],
 )
 }
 className="h-4 w-4 flex-shrink-0 rounded border-border/40 bg-card text-primary-600"
 />

 {/* Avatar icon */}
 <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-100">
 <Users className="h-4 w-4 text-primary-600" />
 </div>

 {/* User info — primary column */}
 <div className="min-w-0 flex-1">
 <div className="flex items-center gap-2.5">
 <span className="truncate font-semibold text-foreground transition-colors">
 {user.username}
 </span>
 {user.banned ? (
 <Badge variant="destructive" className="gap-1 text-[11px]">
 <Ban className="h-2.5 w-2.5" />
 Banned
 </Badge>
 ) : (
 <Badge variant="success" className="gap-1 text-[11px]">
 <span className="relative flex h-1.5 w-1.5">
 <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
 <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success/50" />
 </span>
 Active
 </Badge>
 )}
 </div>
 <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
 <span className="flex items-center gap-1">
 <Mail className="h-3 w-3 shrink-0" />
 <span className="truncate">{user.email}</span>
 </span>
 <span className="hidden font-mono text-[11px] opacity-60 sm:inline">
 {user.id}
 </span>
 {user.roles.length > 0 && (
 <span className="hidden items-center gap-1 sm:flex">
 <Shield className="h-3 w-3 shrink-0" />
 {user.roles.map((role) => role.name).join(', ')}
 </span>
 )}
 <span className="hidden md:inline">
 Created {new Date(user.createdAt).toLocaleDateString()}
 </span>
 {user.twoFactorEnabled && (
 <span className="hidden items-center gap-1 lg:flex">
 <ShieldCheck className="h-3 w-3 text-success" />
 2FA
 </span>
 )}
 {!user.emailVerified && (
 <span className="hidden items-center gap-1 lg:flex text-warning">
 <MailCheck className="h-3 w-3" />
 Unverified
 </span>
 )}
 {(user.passkeys?.length ?? 0) > 0 && (
 <span className="hidden items-center gap-1 lg:flex">
 <Fingerprint className="h-3 w-3 text-success" />
 {(user.passkeys?.length ?? 0)} key{(user.passkeys?.length ?? 0) !== 1 ? 's' : ''}
 </span>
 )}
 </div>
 </div>

 {/* Action buttons */}
 <div className="flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
 {user.banned ? (
 <button
 className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-success/5 hover:text-success disabled:pointer-events-none disabled:opacity-30"
 onClick={() => handleBulkUnban([user.id], user.username)}
 disabled={banMutation.isPending || unbanMutation.isPending}
 title="Unban"
 >
 <CheckCircle className="h-3.5 w-3.5" />
 </button>
 ) : (
 <button
 className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/5 hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
 onClick={() => handleBulkBan([user.id], user.username)}
 disabled={banMutation.isPending || unbanMutation.isPending}
 title="Ban"
 >
 <Ban className="h-3.5 w-3.5" />
 </button>
 )}
 {!user.emailVerified && (
 <button
 className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-success/5 hover:text-success disabled:pointer-events-none disabled:opacity-30"
 onClick={() => verifyEmailMutation.mutate(user.id)}
 disabled={verifyEmailMutation.isPending}
 title="Verify email"
 >
 <MailCheck className="h-3.5 w-3.5" />
 </button>
 )}

 <button
 className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-primary/5 hover:text-primary"
 onClick={(e) => { e.stopPropagation(); startView(user); }}
 title="View details"
 >
 <Eye className="h-3.5 w-3.5" />
 </button>
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <button
 className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
 title="More"
 onClick={(e) => e.stopPropagation()}
 >
 <MoreHorizontal className="h-3.5 w-3.5" />
 </button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end">
 <DropdownMenuItem
 onClick={() => startView(user)}
 className="gap-2 text-xs"
 >
 <Eye className="h-3.5 w-3.5" />
 View
 </DropdownMenuItem>
 <DropdownMenuItem
 onClick={() => handleEditUser(user)}
 disabled={updateMutation.isPending}
 className="gap-2 text-xs"
 >
 <Pencil className="h-3.5 w-3.5" />
 Edit
 </DropdownMenuItem>
 <DropdownMenuSeparator />
 {user.banned ? (
 <DropdownMenuItem
 onClick={() => handleBulkUnban([user.id], user.username)}
 disabled={banMutation.isPending || unbanMutation.isPending}
 className="gap-2 text-xs text-success"
 >
 <CheckCircle className="h-3.5 w-3.5" />
 Unban
 </DropdownMenuItem>
 ) : (
 <DropdownMenuItem
 onClick={() => handleBulkBan([user.id], user.username)}
 disabled={banMutation.isPending || unbanMutation.isPending}
 className="gap-2 text-xs text-destructive"
 >
 <Ban className="h-3.5 w-3.5" />
 Ban
 </DropdownMenuItem>
 )}
 {!user.emailVerified && (
 <DropdownMenuItem
 onClick={() => verifyEmailMutation.mutate(user.id)}
 disabled={verifyEmailMutation.isPending}
 className="gap-2 text-xs text-success"
 >
 <MailCheck className="h-3.5 w-3.5" />
 Verify Email
 </DropdownMenuItem>
 )}
 <DropdownMenuSeparator />
 <DropdownMenuItem
 onClick={() => setDeletingUser({ id: user.id, username: user.username })}
 disabled={deleteMutation.isPending}
 className="gap-2 text-xs text-destructive"
 >
 <Trash2 className="h-3.5 w-3.5" />
 Delete
 </DropdownMenuItem>
 </DropdownMenuContent>
 </DropdownMenu>
 </div>
 </div>
 );
 })}
 </div>

 {/* Pagination */}
 {pagination && pagination.totalPages > 1 ? (
 <div className="border-t border-border/30 px-4 py-3">
 <Pagination
 page={pagination.page}
 totalPages={pagination.totalPages}
 onPageChange={setPage}
 />
 </div>
 ) : null}
 </>
 ) : (
 <div className="p-6">
 <TabEmptyState
 title={search.trim() || hasActiveFilters ? 'No users found' : 'No users'}
 description={search.trim() || hasActiveFilters ? 'Try adjusting your search or filters.' : 'Create a user account to grant dashboard access.'}
 action={
 hasActiveFilters ? (
 <Button variant="outline" size="sm" onClick={clearFilters}>
 <X className="mr-1.5 h-3.5 w-3.5" />
 Clear filters
 </Button>
 ) : (
 <Button size="sm" onClick={() => { resetCreateForm(); setIsCreateOpen(true); }} className="gap-1.5">
 <UserPlus className="h-3.5 w-3.5" />
 Create user
 </Button>
 )
 }
 />
 </div>
 )}
 </div>
 </div>

 {/* ── Create/Edit User Wizard Modal ── */}
 <ModalPortal>
 {isModalOpen && (
 <div
 className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 px-4 backdrop-blur-sm"
 onClick={(e) => { if (e.target === e.currentTarget) { resetCreateForm(); setIsCreateOpen(false); resetEditForm(); } }}
 >
 <div
 className="flex w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border/30 bg-card shadow-xl m-2 max-h-[95vh] md:m-4 md:max-h-[88vh]"
 >
 {/* Header */}
 <div className="flex items-center justify-between border-b border-border/30 px-4 py-3 md:px-6 md:py-4">
 <div className="flex items-center gap-3">
 <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${editingUserId ? 'bg-amber-500/10' : 'bg-primary/10'}`}>
 {editingUserId ? <Pencil className="h-4 w-4 text-amber-600" /> : <UserPlus className="h-4 w-4 text-primary" />}
 </div>
 <div>
 <h2 className="text-lg font-semibold text-foreground">
 {editingUserId ? 'Edit user' : 'Create user'}
 </h2>
 <p className="text-xs text-muted-foreground">
 {editingUserId
 ? editingUser ? `${editingUser.username} · ${editingUser.email}` : 'Update user details and access.'
 : 'Set up a new account with roles and server access.'}
 </p>
 </div>
 </div>
 <button
 className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
 onClick={() => { resetCreateForm(); setIsCreateOpen(false); resetEditForm(); }}
 >
 <X className="h-4 w-4" />
 </button>
 </div>

 {/* Step indicator */}
 <div className="border-b border-border/50 px-4 py-2.5 md:px-6 md:py-3 overflow-x-auto">
 <StepIndicator
 steps={currentSteps}
 currentStep={wizardStep}
 onStepClick={goToStep}
 canNavigate={canNavigateStep}
 />
 </div>

 {/* Step content */}
 <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 md:px-6 md:py-5">
 {/* Step 0: Account Details */}
 {wizardStep === 0 && (
 <div
 key="step-account"
 className="space-y-5"
 >
 <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
 Account credentials
 </div>
 <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
 <label className="block space-y-1.5">
 <span className="text-xs font-medium text-muted-foreground">
 Email <span className="text-destructive">*</span>
 </span>
 <Input
 type="email"
 value={editingUserId ? editEmail : createEmail}
 onChange={(e) => editingUserId ? setEditEmail(e.target.value) : setCreateEmail(e.target.value)}
 placeholder="user@example.com"
 />
 </label>
 <label className="block space-y-1.5">
 <span className="text-xs font-medium text-muted-foreground">
 Username <span className="text-destructive">*</span>
 </span>
 <Input
 value={editingUserId ? editUsername : createUsername}
 onChange={(e) => editingUserId ? setEditUsername(e.target.value) : setCreateUsername(e.target.value)}
 placeholder="username"
 />
 </label>
 <label className="block space-y-1.5">
 <span className="text-xs font-medium text-muted-foreground">
 {editingUserId ? 'New password (leave blank to keep)' : 'Password (min 8 chars)'}
 {!editingUserId && <span className="text-destructive"> *</span>}
 </span>
 <Input
 type="password"
 value={editingUserId ? editPassword : createPassword}
 onChange={(e) => editingUserId ? setEditPassword(e.target.value) : setCreatePassword(e.target.value)}
 placeholder={editingUserId ? 'Leave blank to keep current' : '********'}
 />
 </label>
 </div>

 {/* Validation hints */}
 {!editingUserId && (
 <div className="flex flex-wrap gap-2">
 <div className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] ${createEmail.trim() ? 'text-success bg-success/5' : 'text-muted-foreground bg-surface-2'}`}>
 {createEmail.trim() ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
 Email set
 </div>
 <div className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] ${createUsername.trim() ? 'text-success bg-success/5' : 'text-muted-foreground bg-surface-2'}`}>
 {createUsername.trim() ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
 Username set
 </div>
 <div className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] ${createPassword.trim().length >= 8 ? 'text-success bg-success/5' : 'text-muted-foreground bg-surface-2'}`}>
 {createPassword.trim().length >= 8 ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
 8+ characters
 </div>
 </div>
 )}
 </div>
 )}

 {/* Step 1: Roles & Servers */}
 {wizardStep === 1 && (
 <div
 key="step-roles-servers"
 className="space-y-6"
 >
 {/* Roles section */}
 <div>
 <div className="flex items-center justify-between mb-3">
 <div className="flex items-center gap-2">
 <Shield className="h-4 w-4 text-primary" />
 <span className="text-sm font-semibold text-foreground">Roles</span>
 {(editingUserId ? editRoleIds : createRoleIds).length > 0 && (
 <Badge variant="default" className="tabular-nums text-[10px]">
 {(editingUserId ? editRoleIds : createRoleIds).length}
 </Badge>
 )}
 </div>
 <div className="relative w-48">
 <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
 <Input
 value={editingUserId ? editRoleSearch : roleSearch}
 onChange={(e) => editingUserId ? setEditRoleSearch(e.target.value) : setRoleSearch(e.target.value)}
 placeholder="Search roles…"
 className="h-8 pl-8 text-xs"
 />
 </div>
 </div>
 <div className="flex flex-wrap gap-2">
 {(editingUserId ? filteredEditRoles : filteredModalRoles).map((role) => (
 <RoleChip
 key={role.id}
 role={role}
 selected={(editingUserId ? editRoleIds : createRoleIds).includes(role.id)}
 onToggle={() => editingUserId
 ? setEditRoleIds((prev) => toggleItem(prev, role.id))
 : setCreateRoleIds((prev) => toggleItem(prev, role.id))
 }
 />
 ))}
 {(editingUserId ? filteredEditRoles : filteredModalRoles).length === 0 && (
 <span className="text-xs text-muted-foreground italic">No roles match</span>
 )}
 </div>
 </div>

 {/* Servers section */}
 <div>
 <div className="flex items-center justify-between mb-3">
 <div className="flex items-center gap-2">
 <Server className="h-4 w-4 text-cyan-600" />
 <span className="text-sm font-semibold text-foreground">Server Access</span>
 {(editingUserId ? editServerIds : createServerIds).length > 0 && (
 <Badge className="tabular-nums text-[10px] border-cyan-500/30 bg-cyan-500/10 text-cyan-700">
 {(editingUserId ? editServerIds : createServerIds).length}
 </Badge>
 )}
 </div>
 <div className="relative w-48">
 <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
 <Input
 value={editingUserId ? editServerSearch : serverSearch}
 onChange={(e) => editingUserId ? setEditServerSearch(e.target.value) : setServerSearch(e.target.value)}
 placeholder="Search servers…"
 className="h-8 pl-8 text-xs"
 />
 </div>
 </div>
 <div className="flex flex-wrap gap-2">
 {(editingUserId ? filteredEditServers : filteredModalServers).map((server) => (
 <ServerChip
 key={server.id}
 server={server}
 selected={(editingUserId ? editServerIds : createServerIds).includes(server.id)}
 onToggle={() => editingUserId
 ? setEditServerIds((prev) => toggleItem(prev, server.id))
 : setCreateServerIds((prev) => toggleItem(prev, server.id))
 }
 />
 ))}
 {(editingUserId ? filteredEditServers : filteredModalServers).length === 0 && (
 <span className="text-xs text-muted-foreground italic">No servers match</span>
 )}
 </div>
 </div>
 </div>
 )}

 {/* Step 2: Node Access */}
 {wizardStep === 2 && (
 <div
 key="step-nodes"
 >
 <NodeAssignmentsSelector
 userId={editingUserId ?? undefined}
 selectedNodes={selectedNodeIds}
 onSelectionChange={setSelectedNodeIds}
 disabled={createMutation.isPending || updateMutation.isPending}
 />
 </div>
 )}

 {/* Step 3: Security (edit only) */}
 {wizardStep === 3 && editingUserId && editingUser && (
 <div
 key="step-security"
 >
 <SecuritySection
 user={editingUser}
 onWipePasskeys={() => setWipePasskeyTarget({ id: editingUser.id, username: editingUser.username, count: editingUser.passkeys?.length ?? 0 })}
 onWipe2fa={() => setWipe2faTarget({ id: editingUser.id, username: editingUser.username })}
 onEnforce2fa={(enforce) => setEnforce2faTarget({ id: editingUser.id, username: editingUser.username, enforce })}
 onUnlink={(accountId, providerId) => setUnlinkTarget({ userId: editingUser.id, username: editingUser.username, accountId, providerId })}
 loading={wipePasskeysMutation.isPending || wipe2faMutation.isPending || enforce2faMutation.isPending || unlinkAccountMutation.isPending}
 />
 </div>
 )}
 </div>

 {/* Footer with navigation */}
 <div className="flex items-center justify-between border-t border-border/30 px-4 py-3 md:px-6 md:py-4">
 <div className="text-xs text-muted-foreground">
 {wizardStep === 0 && !editingUserId && 'All fields are required'}
 {wizardStep === 0 && editingUserId && 'Leave password blank to keep current'}
 </div>
 <div className="flex items-center gap-2">
 {wizardStep > 0 && (
 <Button variant="outline" size="sm" onClick={() => goToStep(wizardStep - 1)} className="gap-1">
 <ChevronLeft className="h-3.5 w-3.5" />
 Back
 </Button>
 )}
 {wizardStep < currentSteps.length - 1 && (
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
 {wizardStep === currentSteps.length - 1 && (
 <Button
 size="sm"
 disabled={editingUserId ? !canSubmitEdit || updateMutation.isPending : !canSubmitCreate || createMutation.isPending}
 onClick={() => {
 if (editingUserId) {
 updateMutation.mutate(editingUserId);
 } else {
 createMutation.mutate();
 }
 }}
 className="gap-1"
 >
 {createMutation.isPending || updateMutation.isPending
 ? 'Saving…'
 : editingUserId
 ? 'Save changes'
 : 'Create user'}
 </Button>
 )}
 <Button variant="ghost" size="sm" onClick={() => { resetCreateForm(); setIsCreateOpen(false); resetEditForm(); }}>
 Cancel
 </Button>
 </div>
 </div>
 </div>
 </div>
 )}
 </ModalPortal>

 {/* ── View User Modal ── */}
 <ModalPortal>
 {!!viewingUser && !editingUserId && !isCreateOpen && (
 <div
 className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 px-4 backdrop-blur-sm"
 onClick={(e) => { if (e.target === e.currentTarget) setViewingUser(null); }}
 >
 <div
 className="flex w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border/30 bg-card shadow-xl m-2 max-h-[95vh] md:m-4 md:max-h-[88vh]"
 >
 {/* Header with user identity */}
 <div className="relative overflow-hidden px-4 py-4 border-b border-border/30 md:px-6 md:py-5">
 {/* Decorative gradient */}
 <div className={`absolute inset-0 ${viewingUser.banned ? 'bg-gradient-to-br from-destructive/5 via-destructive/3 to-transparent' : 'bg-gradient-to-br from-primary/5 via-primary/3 to-transparent'}`} />

 <div className="relative flex items-start justify-between">
 <div className="flex items-center gap-3">
 <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
 viewingUser.banned
 ? 'bg-destructive/10 text-destructive'
 : 'bg-primary/10 text-primary'
 }`}>
 <User className="h-5 w-5" />
 </div>
 <div>
 <div className="flex items-center gap-2.5">
 <h2 className="text-lg font-semibold text-foreground">{viewingUser.username}</h2>
 {viewingUser.banned ? (
 <Badge variant="destructive" className="gap-1 text-[11px]">
 <Ban className="h-2.5 w-2.5" /> Banned
 </Badge>
 ) : (
 <Badge variant="success" className="gap-1 text-[11px]">
 <CheckCircle className="h-2.5 w-2.5" /> Active
 </Badge>
 )}
 </div>
 <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
 <Mail className="h-3 w-3" />
 {viewingUser.email}
 </div>
 </div>
 </div>
 <button
 className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
 onClick={() => setViewingUser(null)}
 >
 <X className="h-4 w-4" />
 </button>
 </div>

 {/* Quick stats */}
 <div className="relative mt-3 md:mt-4 flex flex-wrap gap-2 md:gap-3">
 <div className="flex items-center gap-1.5 rounded-lg border border-border/30 bg-card/80 px-3 py-1.5 text-xs">
 <Shield className="h-3 w-3 text-primary" />
 <span className="text-muted-foreground">Roles</span>
 <span className="font-semibold tabular-nums text-foreground">{viewingUser.roles.length}</span>
 </div>
 {viewingUser.twoFactorEnabled && (
 <div className="flex items-center gap-1.5 rounded-lg border border-border/30 bg-card/80 px-3 py-1.5 text-xs">
 <ShieldCheck className="h-3 w-3 text-emerald-500" />
 <span className="text-emerald-700">2FA Enabled</span>
 </div>
 )}
 {(viewingUser.passkeys?.length ?? 0) > 0 && (
 <div className="flex items-center gap-1.5 rounded-lg border border-border/30 bg-card/80 px-3 py-1.5 text-xs">
 <Fingerprint className="h-3 w-3 text-blue-500" />
 <span className="text-muted-foreground">Passkeys</span>
 <span className="font-semibold tabular-nums text-foreground">{viewingUser.passkeys?.length ?? 0}</span>
 </div>
 )}
 <div className="flex items-center gap-1.5 rounded-lg border border-border/30 bg-card/80 px-3 py-1.5 text-xs">
 <Clock className="h-3 w-3 text-muted-foreground" />
 <span className="text-muted-foreground">Created</span>
 <span className="font-medium text-foreground">{new Date(viewingUser.createdAt).toLocaleDateString()}</span>
 </div>
 {viewingUser.lastSuccessfulLogin && (
 <div className="flex items-center gap-1.5 rounded-lg border border-border/30 bg-card/80 px-3 py-1.5 text-xs">
 <Clock className="h-3 w-3 text-muted-foreground" />
 <span className="text-muted-foreground">Last login</span>
 <span className="font-medium text-foreground">{new Date(viewingUser.lastSuccessfulLogin).toLocaleDateString()}</span>
 </div>
 )}
 {viewingUser.lastSignInIp && (
 <div className="flex items-center gap-1.5 rounded-lg border border-border/30 bg-card/80 px-3 py-1.5 text-xs">
 <Globe className="h-3 w-3 text-muted-foreground" />
 <span className="text-muted-foreground">Last IP</span>
 <span className="font-mono font-medium text-foreground">{viewingUser.lastSignInIp}</span>
 </div>
 )}
 </div>
 </div>

 {/* Body */}
 <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-5 space-y-4">
 {/* Roles */}
 {viewingUser.roles.length > 0 && (
 <div className="rounded-xl border border-border/30 p-4">
 <div className="flex items-center gap-2 mb-3">
 <Shield className="h-4 w-4 text-primary" />
 <span className="text-sm font-semibold text-foreground">Roles</span>
 </div>
 <div className="flex flex-wrap gap-2">
 {viewingUser.roles.map((role) => (
 <span key={role.id} className="inline-flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary">
 <Shield className="h-3 w-3" />
 {role.name}
 </span>
 ))}
 </div>
 </div>
 )}

 {/* Accounts & Authentication */}
 {(() => {
 const accounts = viewingUser.accounts ?? [];
 const passkeys = viewingUser.passkeys ?? [];
 const has2fa = !!(viewingUser.twoFactor?.length);
 const hasContent = accounts.length > 0 || passkeys.length > 0 || has2fa;
 if (!hasContent) return null;

 const providerLabel = (id: string) => {
 const labels: Record<string, string> = {
 credential: 'Email & Password',
 whmcs: 'WHMCS',
 paymenter: 'Paymenter',
 google: 'Google',
 github: 'GitHub',
 discord: 'Discord',
 };
 return labels[id] ?? id;
 };

 return (
 <div className="rounded-xl border border-border/30 p-4 space-y-3">
 <div className="flex items-center gap-2 mb-1">
 <Lock className="h-4 w-4 text-muted-foreground" />
 <span className="text-sm font-semibold text-foreground">Authentication</span>
 </div>

 {/* 2FA */}
 {has2fa && (
 <div className="flex items-center gap-2 rounded-lg bg-surface-2/50 px-3 py-2 text-xs">
 <ShieldCheck className={`h-4 w-4 ${viewingUser.twoFactorEnabled ? 'text-emerald-500' : 'text-muted-foreground'}`} />
 <span className="text-foreground">Two-Factor Authentication</span>
 <Badge variant={viewingUser.twoFactorEnabled ? 'success' : 'outline'} className="text-[10px] ml-auto">
 {viewingUser.twoFactorEnabled ? 'Enforced' : 'Configured'}
 </Badge>
 </div>
 )}

 {/* Passkeys */}
 {passkeys.length > 0 && (
 <div className="rounded-lg bg-surface-2/50 px-3 py-2">
 <div className="flex items-center gap-2 text-xs mb-2">
 <Fingerprint className="h-4 w-4 text-blue-500" />
 <span className="text-foreground">{passkeys.length} passkey{passkeys.length === 1 ? '' : 's'}</span>
 </div>
 <div className="space-y-1">
 {passkeys.map((pk) => (
 <div key={pk.id} className="flex items-center justify-between text-[11px] text-muted-foreground pl-6">
 <span>{pk.name || 'Unnamed passkey'}</span>
 <span className="text-muted-foreground/60">{new Date(pk.createdAt).toLocaleDateString()}</span>
 </div>
 ))}
 </div>
 </div>
 )}

 {/* Linked accounts */}
 {accounts.length > 0 && (
 <div className="rounded-lg bg-surface-2/50 px-3 py-2">
 <div className="flex items-center gap-2 text-xs mb-2">
 <Link2 className="h-4 w-4 text-muted-foreground" />
 <span className="text-foreground">Linked accounts</span>
 </div>
 <div className="space-y-1">
 {accounts.map((account) => {
 const isSSO = account.providerId !== 'credential';
 return (
 <div key={account.id} className="flex items-center gap-2 text-[11px] pl-6">
 <KeyRound className={`h-3 w-3 ${isSSO ? 'text-primary' : 'text-muted-foreground'}`} />
 <span className="text-foreground">{providerLabel(account.providerId)}</span>
 {isSSO && (
 <span className="font-mono text-muted-foreground/60">{account.accountId.slice(0, 12)}…</span>
 )}
 </div>
 );
 })}
 </div>
 </div>
 )}
 </div>
 );
 })()}

 {/* Metadata */}
 <div className="space-y-1 border-t border-border/50 pt-3 text-[11px] text-muted-foreground">
 <div>User ID: <span className="font-mono">{viewingUser.id}</span></div>
 {viewingUser.updatedAt !== viewingUser.createdAt && (
 <div>Updated: {new Date(viewingUser.updatedAt).toLocaleDateString()} at {new Date(viewingUser.updatedAt).toLocaleTimeString()}</div>
 )}
 </div>
 </div>

 {/* Actions */}
 <div className="flex items-center gap-2 border-t border-border/30 px-4 py-3 md:px-6 md:py-4">
 <Button variant="outline" size="sm" onClick={() => { startView(viewingUser); handleEditUser(viewingUser); }} className="gap-1.5">
 <Pencil className="h-3.5 w-3.5" />
 Edit user
 </Button>
 {!viewingUser.banned ? (
 <Button variant="outline" size="sm" onClick={() => setBanTargets({ userIds: [viewingUser.id], label: viewingUser.username })} disabled={banMutation.isPending} className="gap-1.5 text-xs text-destructive hover:bg-destructive/5 hover:text-destructive hover:border-destructive/20">
 <Ban className="h-3.5 w-3.5" /> Ban
 </Button>
 ) : (
 <Button variant="outline" size="sm" onClick={() => handleBulkUnban([viewingUser.id], viewingUser.username)} disabled={unbanMutation.isPending} className="gap-1.5 text-xs text-success hover:bg-success/5 hover:text-success hover:border-success/20">
 <CheckCircle className="h-3.5 w-3.5" /> Unban
 </Button>
 )}
 <Button variant="destructive" size="sm" onClick={() => setDeletingUser({ id: viewingUser.id, username: viewingUser.username })} disabled={deleteMutation.isPending} className="gap-1.5">
 <Trash2 className="h-3.5 w-3.5" /> Delete
 </Button>
 <div className="flex-1" />
 <Button variant="ghost" size="sm" onClick={() => setViewingUser(null)}>
 Close
 </Button>
 </div>
 </div>
 </div>
 )}
 </ModalPortal>

 {/* ── Ban Confirmation Dialog ── */}
 <ConfirmDialog
 open={!!banTargets}
 title="Ban Users"
 message={
 <div className="space-y-3">
 <p>
 You are about to ban{' '}
 <span className="font-semibold">{banTargets?.label}</span>.
 </p>
 <label className="block space-y-1">
 <span className="text-sm text-muted-foreground">
 Reason (optional)
 </span>
 <input
 className="w-full rounded-lg border border-border/30 bg-card px-3 py-2 text-sm text-foreground transition-all duration-300 focus:border-primary focus:outline-none"
 value={banReason}
 onChange={(event) => setBanReason(event.target.value)}
 placeholder="e.g., Terms of service violation"
 onClick={(e) => e.stopPropagation()}
 />
 </label>
 </div>
 }
 confirmText="Ban"
 cancelText="Cancel"
 onConfirm={() =>
 banTargets &&
 banMutation.mutate({
 userIds: banTargets.userIds,
 reason: banReason.trim() || undefined,
 })
 }
 onCancel={() => {
 setBanTargets(null);
 setBanReason('');
 }}
 variant="warning"
 loading={banMutation.isPending}
 />

 {/* ── Unban Confirmation Dialog ── */}
 <ConfirmDialog
 open={!!unbanTargets}
 title="Unban Users"
 message={
 <p>
 You are about to unban{' '}
 <span className="font-semibold">{unbanTargets?.label}</span>.
 </p>
 }
 confirmText="Unban"
 cancelText="Cancel"
 onConfirm={() =>
 unbanTargets && unbanMutation.mutate(unbanTargets.userIds)
 }
 onCancel={() => setUnbanTargets(null)}
 variant="warning"
 loading={unbanMutation.isPending}
 />

 {/* ── Delete Confirmation Dialog ── */}
 <ConfirmDialog
 open={!!deletingUser}
 title="Delete user?"
 message={
 <div className="space-y-2">
 <p>
 Are you sure you want to delete{' '}
 <span className="font-semibold">"{deletingUser?.username}"</span>?
 This action cannot be undone and all associated data will be
 removed.
 </p>
 </div>
 }
 confirmText="Delete"
 cancelText="Cancel"
 variant="danger"
 loading={deleteMutation.isPending || bulkDeleteMutation.isPending}
 onConfirm={() => {
 if (deletingUser) {
 const ids = deletingUser.id.split(',');
 if (ids.length > 1) {
 bulkDeleteMutation.mutate(ids, {
 onSuccess: () => setDeletingUser(null),
 });
 } else {
 deleteMutation.mutate(deletingUser.id, {
 onSuccess: () => setDeletingUser(null),
 });
 }
 }
 }}
 onCancel={() => setDeletingUser(null)}
 />

 {/* ── Wipe Passkeys Confirmation Dialog ── */}
 <ConfirmDialog
 open={!!wipePasskeyTarget}
 title="Wipe passkeys?"
 message={
 <div className="space-y-2">
 <p>
 Remove all <span className="font-semibold">{wipePasskeyTarget?.count} passkey{wipePasskeyTarget?.count === 1 ? '' : 's'}</span> from{' '}
 <span className="font-semibold">{wipePasskeyTarget?.username}</span>?
 </p>
 <p className="text-xs text-muted-foreground">
 The user will no longer be able to sign in with passkeys. This cannot be undone.
 </p>
 </div>
 }
 confirmText="Wipe passkeys"
 cancelText="Cancel"
 variant="danger"
 loading={wipePasskeysMutation.isPending}
 onConfirm={() => wipePasskeyTarget && wipePasskeysMutation.mutate(wipePasskeyTarget.id)}
 onCancel={() => setWipePasskeyTarget(null)}
 />

 {/* ── Wipe 2FA Confirmation Dialog ── */}
 <ConfirmDialog
 open={!!wipe2faTarget}
 title="Wipe 2FA?"
 message={
 <div className="space-y-2">
 <p>
 Remove two-factor authentication from{' '}
 <span className="font-semibold">{wipe2faTarget?.username}</span>?
 </p>
 <p className="text-xs text-muted-foreground">
 The user's authenticator app and backup codes will be removed. 2FA enforcement will also be disabled.
 </p>
 </div>
 }
 confirmText="Wipe 2FA"
 cancelText="Cancel"
 variant="danger"
 loading={wipe2faMutation.isPending}
 onConfirm={() => wipe2faTarget && wipe2faMutation.mutate(wipe2faTarget.id)}
 onCancel={() => setWipe2faTarget(null)}
 />

 {/* ── Enforce/Unenforce 2FA Confirmation Dialog ── */}
 <ConfirmDialog
 open={!!enforce2faTarget}
 title={enforce2faTarget?.enforce ? 'Enforce 2FA?' : 'Disable 2FA enforcement?'}
 message={
 <div className="space-y-2">
 <p>
 {enforce2faTarget?.enforce
 ? <>Enforce 2FA for <span className="font-semibold">{enforce2faTarget?.username}</span>?</>
 : <>Disable 2FA enforcement for <span className="font-semibold">{enforce2faTarget?.username}</span>?</>}
 </p>
 <p className="text-xs text-muted-foreground">
 {enforce2faTarget?.enforce
 ? 'The user will be required to use 2FA on every sign-in.'
 : 'The user will no longer be required to use 2FA, but their authenticator will remain configured.'}
 </p>
 </div>
 }
 confirmText={enforce2faTarget?.enforce ? 'Enforce' : 'Disable'}
 cancelText="Cancel"
 variant="warning"
 loading={enforce2faMutation.isPending}
 onConfirm={() =>
 enforce2faTarget &&
 enforce2faMutation.mutate({
 userId: enforce2faTarget.id,
 enforce: enforce2faTarget.enforce,
 })
 }
 onCancel={() => setEnforce2faTarget(null)}
 />

 {/* ── Unlink SSO Confirmation Dialog ── */}
 <ConfirmDialog
 open={!!unlinkTarget}
 title="Unlink SSO account?"
 message={
 <div className="space-y-2">
 <p>
 Unlink <span className="font-semibold">{unlinkTarget?.providerId}</span> from{' '}
 <span className="font-semibold">{unlinkTarget?.username}</span>?
 </p>
 <p className="text-xs text-muted-foreground">
 The user will no longer be able to sign in with this provider. Make sure they have another way to log in.
 </p>
 </div>
 }
 confirmText="Unlink"
 cancelText="Cancel"
 variant="danger"
 loading={unlinkAccountMutation.isPending}
 onConfirm={() =>
 unlinkTarget &&
 unlinkAccountMutation.mutate({
 userId: unlinkTarget.userId,
 accountId: unlinkTarget.accountId,
 })
 }
 onCancel={() => setUnlinkTarget(null)}
 />
 </div>
 );
}

export default UsersPage;
