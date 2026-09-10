import { useMemo, useRef, useState, useCallback } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
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
import { roleLabel } from '../../utils/constants';
import { formatDate, formatDateTime, formatTime } from '../../i18n/format';
import { NodeAssignmentsSelector } from '../../components/admin/NodeAssignmentsSelector';
import type { NodeAssignmentWithExpiration } from '../../components/admin/NodeAssignmentsSelector';
import type { AdminUser } from '../../types/admin';
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
 const { t } = useTranslation('admin-access');
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
 {roleLabel(t, role.name)}
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
 ? 'border-primary/30 bg-primary/10 text-primary shadow-sm'
 : 'border-border/30 bg-card text-muted-foreground hover:border-primary/20 hover:text-foreground'
 }`}
 >
 <Server className={`h-3 w-3 ${selected ? 'text-primary' : ''}`} />
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
 const { t } = useTranslation('admin-access');
 const passkeys = user.passkeys ?? [];
 const accounts = user.accounts ?? [];
 const has2fa = !!(user.twoFactor?.length);
 const twoFactorEnabled = user.twoFactorEnabled ?? false;
 const lastLogin = user.lastSuccessfulLogin;
 const lastIp = user.lastSignInIp;
 return (
 <div className="space-y-4">
 {/* Sign-in info */}
 {(lastLogin || lastIp) && (
 <div className="flex flex-wrap items-center gap-2">
 {lastIp && (
 <div className="flex items-center gap-1.5 rounded-lg border border-border/30 bg-surface-2 px-2.5 py-1.5 text-xs">
 <Globe className="h-3 w-3 text-muted-foreground" />
 <span className="text-muted-foreground">{t('users.lastIpLabel')}</span>
 <span className="font-mono text-foreground">{lastIp}</span>
 </div>
 )}
 {lastLogin && (
 <div className="flex items-center gap-1.5 rounded-lg border border-border/30 bg-surface-2 px-2.5 py-1.5 text-xs">
 <Clock className="h-3 w-3 text-muted-foreground" />
 <span className="text-muted-foreground">{t('users.lastSignIn')}</span>
 <span className="text-foreground">{formatDateTime(lastLogin)}</span>
 </div>
 )}
 </div>
 )}

 {/* 2FA status */}
 <div className="rounded-xl border border-border/30 bg-card p-4">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-3">
 <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${twoFactorEnabled ? 'bg-success/10' : 'bg-surface-2'}`}>
 <ShieldCheck className={`h-4 w-4 ${twoFactorEnabled ? 'text-success' : 'text-muted-foreground'}`} />
 </div>
 <div>
 <div className="text-sm font-medium text-foreground">{t('users.twoFactorAuth')}</div>
 <div className="text-[11px] text-muted-foreground">
 {has2fa ? (twoFactorEnabled ? t('users.enabledAndEnforced') : t('users.setUpNotEnforced')) : t('users.notSetUp')}
 </div>
 </div>
 </div>
 <div className="flex items-center gap-1.5">
 {has2fa && !twoFactorEnabled && (
 <Button variant="outline" size="sm" className="gap-1 text-xs" disabled={loading} onClick={() => onEnforce2fa(true)}>
 <ShieldCheck className="h-3 w-3" /> {t('users.enforce')}
 </Button>
 )}
 {twoFactorEnabled && has2fa && (
 <Button variant="outline" size="sm" className="gap-1 text-xs" disabled={loading} onClick={() => onEnforce2fa(false)}>
 {t('users.unenforce')}
 </Button>
 )}
 {has2fa && (
 <Button variant="outline" size="sm" className="gap-1 text-xs text-destructive hover:bg-destructive/5 hover:text-destructive hover:border-destructive/20" disabled={loading} onClick={onWipe2fa}>
 <Trash2 className="h-3 w-3" /> {t('users.wipeTwoFactor')}
 </Button>
 )}
 </div>
 </div>
 </div>

 {/* Passkeys */}
 <div className="rounded-xl border border-border/30 bg-card p-4">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-3">
 <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${passkeys.length > 0 ? 'bg-primary/10' : 'bg-surface-2'}`}>
 <Fingerprint className={`h-4 w-4 ${passkeys.length > 0 ? 'text-primary' : 'text-muted-foreground'}`} />
 </div>
 <div>
 <div className="text-sm font-medium text-foreground">{t('users.passkeys')}</div>
 <div className="text-[11px] text-muted-foreground">
 {passkeys.length ? t('users.passkeysRegistered', { count: passkeys.length }) : t('users.noPasskeys')}
 </div>
 </div>
 </div>
 {passkeys.length > 0 && (
 <Button variant="outline" size="sm" className="gap-1 text-xs text-destructive hover:bg-destructive/5 hover:text-destructive hover:border-destructive/20" disabled={loading} onClick={onWipePasskeys}>
 <Trash2 className="h-3 w-3" /> {t('users.wipeAll')}
 </Button>
 )}
 </div>
 {passkeys.length > 0 && (
 <div className="mt-3 space-y-1.5">
 {passkeys.map((pk) => (
 <div key={pk.id} className="flex items-center justify-between rounded-lg bg-surface-2/50 px-3 py-2 text-xs">
 <span className="text-muted-foreground">{pk.name || t('users.unnamedPasskey')}</span>
 <span className="text-[10px] text-muted-foreground/60">{formatDate(pk.createdAt)}</span>
 </div>
 ))}
 </div>
 )}
 </div>

 {/* Linked SSO accounts */}
 <div className="rounded-xl border border-border/30 bg-card p-4">
 <div className="flex items-center gap-2 mb-3">
 <Link2 className="h-4 w-4 text-muted-foreground" />
 <span className="text-sm font-medium text-foreground">{t('users.linkedAccounts')}</span>
 </div>
 {accounts.length === 0 ? (
 <p className="text-xs text-muted-foreground">{t('users.noLinkedAccounts')}</p>
 ) : (
 <div className="space-y-2">
 {accounts.map((account) => {
 const isSSO = account.providerId !== 'credential';
 return (
 <div key={account.id} className="flex items-center justify-between rounded-lg bg-surface-2/50 px-3 py-2 text-xs">
 <div className="flex items-center gap-2">
 <KeyRound className={`h-3.5 w-3.5 ${isSSO ? 'text-primary' : 'text-muted-foreground'}`} />
 <span className="text-foreground">{providerLabel(t, account.providerId)}</span>
 {isSSO && (
 <span className="text-[10px] font-mono text-muted-foreground/60">
 {account.accountId.slice(0, 12)}…
 </span>
 )}
 </div>
 {isSSO && (
 <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-[11px] text-destructive hover:bg-destructive/5 hover:text-destructive" disabled={loading} onClick={() => onUnlink(account.id, account.providerId)}>
 <Unlink className="h-3 w-3" /> {t('users.unlink')}
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
/** SSO provider labels. Brand names are product names and stay untranslated. */
const SSO_PROVIDER_NAMES: Record<string, string> = {
 whmcs: 'WHMCS',
 paymenter: 'Paymenter',
 google: 'Google',
 github: 'GitHub',
 discord: 'Discord',
};

/** Resolve the display label for an SSO provider id. */
function providerLabel(t: TFunction<'admin-access'>, providerId: string): string {
 if (providerId === 'credential') return t('users.providerCredential');
 return SSO_PROVIDER_NAMES[providerId] ?? providerId;
}

// ── Main Component ──
function UsersPage() {
 const { t } = useTranslation('admin-access');

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
 notifySuccess(t('users.toasts.created'));
 resetCreateForm();
 setIsCreateOpen(false);
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminUsers() });
 },
 onError: (error: any) => {
 notifyError(error);
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
 notifySuccess(t('users.toasts.updated'));
 setEditingUserId(null);
 setEditRoleSearch('');
 setEditServerSearch('');
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminUsers() });
 queryClient.invalidateQueries({ queryKey: qk.adminRoles() });
 },
 onError: (error: any) => {
 notifyError(error);
 },
 });

 const deleteMutation = useMutation({
 mutationFn: (userId: string) => adminApi.deleteUser(userId),
 onSuccess: () => {
 notifySuccess(t('users.toasts.deleted'));
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminUsers() });
 queryClient.invalidateQueries({ queryKey: qk.adminRoles() });
 },
 onError: (error: any) => {
 notifyError(error);
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
 t('users.toasts.usersBanned', { count: variables.userIds.length }),
 );
 setSelectedIds([]);
 setBanTargets(null);
 setBanReason('');
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminUsers() });
 },
 onError: (error: any) => {
 notifyError(error);
 },
 });

 const unbanMutation = useMutation({
 mutationKey: qk.mutation.adminUserUnban(),
 mutationFn: (userIds: string[]) => {
 return Promise.all(userIds.map((userId) => adminApi.unbanUser(userId)));
 },
 onSuccess: (_data, userIds) => {
 notifySuccess(
 t('users.toasts.usersUnbanned', { count: userIds.length }),
 );
 setSelectedIds([]);
 setUnbanTargets(null);
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminUsers() });
 },
 onError: (error: any) => {
 notifyError(error);
 },
 });

 const wipePasskeysMutation = useMutation({
 mutationFn: (userId: string) => adminApi.wipePasskeys(userId),
 onSuccess: (_data, userId) => {
 notifySuccess(t('users.toasts.passkeysWiped'));
 setWipePasskeyTarget(null);
 const updatedUser = users.find((u) => u.id === userId);
 if (updatedUser) handleEditUser(updatedUser);
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminUsers() });
 },
 onError: (error: any) => {
 notifyError(error);
 },
 });

 const wipe2faMutation = useMutation({
 mutationFn: (userId: string) => adminApi.wipeTwoFactor(userId),
 onSuccess: (_data, userId) => {
 notifySuccess(t('users.toasts.twoFactorWiped'));
 setWipe2faTarget(null);
 const updatedUser = users.find((u) => u.id === userId);
 if (updatedUser) handleEditUser(updatedUser);
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminUsers() });
 },
 onError: (error: any) => {
 notifyError(error);
 },
 });

 const enforce2faMutation = useMutation({
 mutationFn: ({ userId, enforce }: { userId: string; enforce: boolean }) =>
 adminApi.enforceTwoFactor(userId, enforce),
 onSuccess: (_data, variables) => {
 notifySuccess(variables.enforce ? t('users.toasts.twoFactorEnforcementEnabled') : t('users.toasts.twoFactorEnforcementDisabled'));
 setEnforce2faTarget(null);
 const updatedUser = users.find((u) => u.id === variables.userId);
 if (updatedUser) handleEditUser(updatedUser);
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminUsers() });
 },
 onError: (error: any) => {
 notifyError(error);
 },
 });

 const unlinkAccountMutation = useMutation({
 mutationFn: ({ userId, accountId }: { userId: string; accountId: string }) =>
 adminApi.unlinkAccount(userId, accountId),
 onSuccess: (_data, variables) => {
 notifySuccess(t('users.toasts.ssoUnlinked'));
 setUnlinkTarget(null);
 const updatedUser = users.find((u) => u.id === variables.userId);
 if (updatedUser) handleEditUser(updatedUser);
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminUsers() });
 },
 onError: (error: any) => {
 notifyError(error);
 },
 });

 const verifyEmailMutation = useMutation({
 mutationFn: (userId: string) => adminApi.verifyUserEmail(userId),
 onSuccess: () => {
 notifySuccess(t('users.toasts.emailVerified'));
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminUsers() });
 },
 onError: (error: any) => {
 notifyError(error);
 },
 });

 const bulkDeleteMutation = useMutation({
 mutationFn: (userIds: string[]) => {
 return Promise.all(userIds.map((userId) => adminApi.deleteUser(userId)));
 },
 onSuccess: (_data, userIds) => {
 notifySuccess(
 t('users.toasts.usersDeleted', { count: userIds.length }),
 );
 setSelectedIds([]);
 setDeletingUser(null);
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminUsers() });
 queryClient.invalidateQueries({ queryKey: qk.adminRoles() });
 },
 onError: (error: any) => {
 notifyError(error);
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
 .catch((error: unknown) => {
 notifyError(error);
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
 notifySuccess(t('users.toasts.emailsVerified', { count: unverifiedIds.length }));
 queryClient.invalidateQueries({ queryKey: qk.adminUsers() });
 })
 .catch((err: any) => {
 notifyError(err);
 });
 };

 // ── Wizard logic ──
 const createSteps = [
 { label: t('wizard.account'), icon: User },
 { label: t('wizard.rolesServers'), icon: Shield },
 { label: t('wizard.nodeAccess'), icon: Server },
 ];
 const editSteps = [
 { label: t('wizard.account'), icon: User },
 { label: t('wizard.rolesServers'), icon: Shield },
 { label: t('wizard.nodeAccess'), icon: Server },
 { label: t('wizard.security'), icon: Lock },
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
 title={t('users.title')}
 description={t('users.description')}
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
 {t('users.count', { count: data?.pagination?.total ?? 0 })}
 </Badge>
 {roles.length > 0 && (
 <Badge variant="outline" className="h-8 gap-1.5 px-3 text-xs">
 <Shield className="h-2.5 w-2.5" />
 {t('users.roleCount', { count: roles.length })}
 </Badge>
 )}
 {bannedCount > 0 && (
 <Badge variant="destructive" className="h-8 gap-1.5 px-3 text-xs">
 <Ban className="h-2.5 w-2.5" />
 {t('users.bannedCount', { count: bannedCount })}
 </Badge>
 )}
 {unverifiedCount > 0 && (
 <Badge variant="outline" className="h-8 gap-1.5 px-3 text-xs text-warning border-warning/30">
 <MailCheck className="h-2.5 w-2.5" />
 {t('users.unverifiedCount', { count: unverifiedCount })}
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
 {t('users.createTitle')}
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
 placeholder={t('users.searchPlaceholder')}
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
 {t('filters')}
 {hasActiveFilters && (
 <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary-foreground/20 text-[10px] font-bold">
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
 <SelectItem value="username-asc">{t('users.sortUsernameAsc')}</SelectItem>
 <SelectItem value="username-desc">{t('users.sortUsernameDesc')}</SelectItem>
 <SelectItem value="email-asc">{t('users.sortEmailAsc')}</SelectItem>
 <SelectItem value="email-desc">{t('users.sortEmailDesc')}</SelectItem>
 <SelectItem value="created">{t('users.sortNewest')}</SelectItem>
 <SelectItem value="roles">{t('users.sortMostRoles')}</SelectItem>
 </SelectContent>
 </Select>

 {/* Results count */}
 <span className="text-xs text-muted-foreground">
 {t('users.showing', { shown: filteredUsers.length, total: data?.pagination?.total ?? users.length })}
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
 <span className="text-xs font-medium text-muted-foreground">{t('users.roleLabel')}</span>
 <Select
 value={roleFilter || 'all'}
 onValueChange={(value) => {
 setRoleFilter(value === 'all' ? '' : value);
 setPage(1);
 }}
 >
 <SelectTrigger className="w-44">
 <SelectValue placeholder={t('users.allRoles')} />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="all">{t('users.allRoles')}</SelectItem>
 {sortedRoles.map((role) => (
 <SelectItem key={role.id} value={role.id}>
 {roleLabel(t, role.name)}
 {roleCounts[role.id] ? ` (${roleCounts[role.id]})` : ''}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </label>
 <label className="space-y-1.5">
 <span className="text-xs font-medium text-muted-foreground">{t('users.statusLabel')}</span>
 <Select
 value={statusFilter || 'all'}
 onValueChange={(value) => {
 setStatusFilter(value === 'all' ? '' : value);
 setPage(1);
 }}
 >
 <SelectTrigger className="w-44">
 <SelectValue placeholder={t('users.allStatuses')} />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="all">{t('users.allStatuses')}</SelectItem>
 <SelectItem value="active">
 {t('users.statusActive')}
 {bannedCount > 0 ? ` (${users.length - bannedCount})` : ''}
 </SelectItem>
 <SelectItem value="banned">
 {t('users.statusBanned')}{bannedCount > 0 ? ` (${bannedCount})` : ''}
 </SelectItem>
 <SelectItem value="unverified">
 {t('users.statusUnverified')}{unverifiedCount > 0 ? ` (${unverifiedCount})` : ''}
 </SelectItem>
 </SelectContent>
 </Select>
 </label>
 {hasActiveFilters && (
 <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1.5 text-xs">
 <X className="h-3 w-3" />
 {t('users.clearAll')}
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
 {t('users.selectedCount', { count: selectedIds.length })}
 </span>
 <button
 onClick={() => setSelectedIds([])}
 className="text-xs text-muted-foreground transition-colors hover:text-foreground"
 >
 {t('users.clearSelection')}
 </button>
 </div>
 <div className="flex items-center gap-1.5">
 <Button variant="outline" size="sm" onClick={() => handleBulkBan(selectedIds, t('users.userCount', { count: selectedIds.length }))} disabled={banMutation.isPending || unbanMutation.isPending || bulkDeleteMutation.isPending} className="gap-1.5 text-xs text-destructive hover:bg-destructive/5 hover:text-destructive hover:border-destructive/20">
 <Ban className="h-3 w-3" /> {t('users.ban')}
 </Button>
 <Button variant="outline" size="sm" onClick={() => handleBulkUnban(selectedIds, t('users.userCount', { count: selectedIds.length }))} disabled={banMutation.isPending || unbanMutation.isPending || bulkDeleteMutation.isPending} className="gap-1.5 text-xs text-success hover:bg-success/5 hover:text-success hover:border-success/20">
 <CheckCircle className="h-3 w-3" /> {t('users.unban')}
 </Button>
 {selectedIds.some((id) => !users.find((u) => u.id === id)?.emailVerified) && (
 <Button variant="outline" size="sm" onClick={() => handleBulkVerifyEmails(selectedIds)} disabled={verifyEmailMutation.isPending} className="gap-1.5 text-xs text-success hover:bg-success/5 hover:text-success hover:border-success/20">
 <MailCheck className="h-3 w-3" /> {t('users.verifyEmails')}
 </Button>
 )}
 <div className="mx-1 h-4 w-px bg-border" />
 <Button variant="destructive" size="sm" onClick={() => handleBulkDelete(selectedIds, t('users.userCount', { count: selectedIds.length }))} disabled={banMutation.isPending || unbanMutation.isPending || bulkDeleteMutation.isPending} className="gap-1.5 text-xs">
 <Trash2 className="h-3 w-3" /> {t('common:actions.delete')}
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
 {t('users.selectAll')}
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
 {t('users.statusBanned')}
 </Badge>
 ) : (
 <Badge variant="success" className="gap-1 text-[11px]">
 <span className="relative flex h-1.5 w-1.5">
 <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
 <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success/50" />
 </span>
 {t('users.statusActive')}
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
 {user.roles.map((role) => roleLabel(t, role.name)).join(', ')}
 </span>
 )}
 <span className="hidden md:inline">
 {t('users.createdOn', { date: formatDate(user.createdAt) })}
 </span>
 {user.twoFactorEnabled && (
 <span className="hidden items-center gap-1 lg:flex">
 <ShieldCheck className="h-3 w-3 text-success" />
 {t('users.twoFactorShort')}
 </span>
 )}
 {!user.emailVerified && (
 <span className="hidden items-center gap-1 lg:flex text-warning">
 <MailCheck className="h-3 w-3" />
 {t('users.statusUnverified')}
 </span>
 )}
 {(user.passkeys?.length ?? 0) > 0 && (
 <span className="hidden items-center gap-1 lg:flex">
 <Fingerprint className="h-3 w-3 text-success" />
 {t('users.keyCount', { count: user.passkeys?.length ?? 0 })}
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
 title={t('users.unban')}
 >
 <CheckCircle className="h-3.5 w-3.5" />
 </button>
 ) : (
 <button
 className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/5 hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
 onClick={() => handleBulkBan([user.id], user.username)}
 disabled={banMutation.isPending || unbanMutation.isPending}
 title={t('users.ban')}
 >
 <Ban className="h-3.5 w-3.5" />
 </button>
 )}
 {!user.emailVerified && (
 <button
 className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-success/5 hover:text-success disabled:pointer-events-none disabled:opacity-30"
 onClick={() => verifyEmailMutation.mutate(user.id)}
 disabled={verifyEmailMutation.isPending}
 title={t('users.verifyEmailAction')}
 >
 <MailCheck className="h-3.5 w-3.5" />
 </button>
 )}

 <button
 className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-primary/5 hover:text-primary"
 onClick={(e) => { e.stopPropagation(); startView(user); }}
 title={t('users.viewDetails')}
 >
 <Eye className="h-3.5 w-3.5" />
 </button>
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <button
 className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
 title={t('users.more')}
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
 {t('users.view')}
 </DropdownMenuItem>
 <DropdownMenuItem
 onClick={() => handleEditUser(user)}
 disabled={updateMutation.isPending}
 className="gap-2 text-xs"
 >
 <Pencil className="h-3.5 w-3.5" />
 {t('common:actions.edit')}
 </DropdownMenuItem>
 <DropdownMenuSeparator />
 {user.banned ? (
 <DropdownMenuItem
 onClick={() => handleBulkUnban([user.id], user.username)}
 disabled={banMutation.isPending || unbanMutation.isPending}
 className="gap-2 text-xs text-success"
 >
 <CheckCircle className="h-3.5 w-3.5" />
 {t('users.unban')}
 </DropdownMenuItem>
 ) : (
 <DropdownMenuItem
 onClick={() => handleBulkBan([user.id], user.username)}
 disabled={banMutation.isPending || unbanMutation.isPending}
 className="gap-2 text-xs text-destructive"
 >
 <Ban className="h-3.5 w-3.5" />
 {t('users.ban')}
 </DropdownMenuItem>
 )}
 {!user.emailVerified && (
 <DropdownMenuItem
 onClick={() => verifyEmailMutation.mutate(user.id)}
 disabled={verifyEmailMutation.isPending}
 className="gap-2 text-xs text-success"
 >
 <MailCheck className="h-3.5 w-3.5" />
 {t('users.verifyEmailMenuItem')}
 </DropdownMenuItem>
 )}
 <DropdownMenuSeparator />
 <DropdownMenuItem
 onClick={() => setDeletingUser({ id: user.id, username: user.username })}
 disabled={deleteMutation.isPending}
 className="gap-2 text-xs text-destructive"
 >
 <Trash2 className="h-3.5 w-3.5" />
 {t('common:actions.delete')}
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
 title={search.trim() || hasActiveFilters ? t('users.emptyFilteredTitle') : t('users.emptyTitle')}
 description={search.trim() || hasActiveFilters ? t('users.emptyFilteredDescription') : t('users.emptyDescription')}
 action={
 hasActiveFilters ? (
 <Button variant="outline" size="sm" onClick={clearFilters}>
 <X className="mr-1.5 h-3.5 w-3.5" />
 {t('users.clearFilters')}
 </Button>
 ) : (
 <Button size="sm" onClick={() => { resetCreateForm(); setIsCreateOpen(true); }} className="gap-1.5">
 <UserPlus className="h-3.5 w-3.5" />
 {t('users.createTitle')}
 </Button>
 )
 }
 />
 </div>
 )}
 </div>
 </div>

 {/* ── Create/Edit User Wizard Modal ── */}
<Dialog
 open={isModalOpen}
 onOpenChange={(open) => {
 if (!open) {
 resetCreateForm();
 setIsCreateOpen(false);
 resetEditForm();
 }
 }}
>
 <DialogContent size="2xl">
 <DialogHeader
 icon={editingUserId ? <Pencil className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
 iconClassName={editingUserId
 ? 'border-warning/20 bg-warning/10 text-warning'
 : 'border-primary/20 bg-primary/10 text-primary'}
 >
 <DialogTitle>{editingUserId ? t('users.editTitle') : t('users.createTitle')}</DialogTitle>
 <DialogDescription>
 {editingUserId
 ? editingUser ? `${editingUser.username} · ${editingUser.email}` : t('users.editDescription')
 : t('users.createDescription')}
 </DialogDescription>
 </DialogHeader>

 <DialogToolbar className="overflow-x-auto">
 <StepIndicator
 steps={currentSteps}
 currentStep={wizardStep}
 onStepClick={goToStep}
 canNavigate={canNavigateStep}
 />
 </DialogToolbar>

 <DialogBody>
 {/* Step 0: Account Details */}
 {wizardStep === 0 && (
 <div
 key="step-account"
 className="space-y-5"
 >
 <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
 {t('users.accountCredentials')}
 </div>
 <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
 <label className="block space-y-1.5">
 <span className="text-xs font-medium text-muted-foreground">
 {t('users.emailLabel')} <span className="text-destructive">*</span>
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
 {t('users.usernameLabel')} <span className="text-destructive">*</span>
 </span>
 <Input
 value={editingUserId ? editUsername : createUsername}
 onChange={(e) => editingUserId ? setEditUsername(e.target.value) : setCreateUsername(e.target.value)}
 placeholder="username"
 />
 </label>
 <label className="block space-y-1.5">
 <span className="text-xs font-medium text-muted-foreground">
 {editingUserId ? t('users.newPasswordLabel') : t('users.passwordLabel')}
 {!editingUserId && <span className="text-destructive"> *</span>}
 </span>
 <Input
 type="password"
 autoComplete={editingUserId ? 'current-password' : 'new-password'}
 value={editingUserId ? editPassword : createPassword}
 onChange={(e) => editingUserId ? setEditPassword(e.target.value) : setCreatePassword(e.target.value)}
 placeholder={editingUserId ? t('users.leaveBlankPlaceholder') : '********'}
 />
 </label>
 </div>

 {/* Validation hints */}
 {!editingUserId && (
 <div className="flex flex-wrap gap-2">
 <div className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] ${createEmail.trim() ? 'text-success bg-success/5' : 'text-muted-foreground bg-surface-2'}`}>
 {createEmail.trim() ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
 {t('users.emailSet')}
 </div>
 <div className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] ${createUsername.trim() ? 'text-success bg-success/5' : 'text-muted-foreground bg-surface-2'}`}>
 {createUsername.trim() ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
 {t('users.usernameSet')}
 </div>
 <div className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] ${createPassword.trim().length >= 8 ? 'text-success bg-success/5' : 'text-muted-foreground bg-surface-2'}`}>
 {createPassword.trim().length >= 8 ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
 {t('users.characters8')}
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
 <span className="text-sm font-semibold text-foreground">{t('users.rolesHeading')}</span>
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
 placeholder={t('users.searchRoles')}
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
 <span className="text-xs text-muted-foreground italic">{t('users.noRolesMatch')}</span>
 )}
 </div>
 </div>

 {/* Servers section */}
 <div>
 <div className="flex items-center justify-between mb-3">
 <div className="flex items-center gap-2">
 <Server className="h-4 w-4 text-primary" />
 <span className="text-sm font-semibold text-foreground">{t('users.serverAccess')}</span>
 {(editingUserId ? editServerIds : createServerIds).length > 0 && (
 <Badge className="tabular-nums text-[10px] border-primary/30 bg-primary/10 text-primary">
 {(editingUserId ? editServerIds : createServerIds).length}
 </Badge>
 )}
 </div>
 <div className="relative w-48">
 <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
 <Input
 value={editingUserId ? editServerSearch : serverSearch}
 onChange={(e) => editingUserId ? setEditServerSearch(e.target.value) : setServerSearch(e.target.value)}
 placeholder={t('users.searchServers')}
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
 <span className="text-xs text-muted-foreground italic">{t('users.noServersMatch')}</span>
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
 </DialogBody>

 <DialogFooter className="sm:justify-between">
 <div className="text-xs text-muted-foreground">
 {wizardStep === 0 && !editingUserId && t('users.allFieldsRequired')}
 {wizardStep === 0 && editingUserId && t('users.leavePasswordBlank')}
 </div>
 <div className="flex items-center gap-2">
 {wizardStep > 0 && (
 <Button variant="outline" size="sm" onClick={() => goToStep(wizardStep - 1)} className="gap-1">
 <ChevronLeft className="h-3.5 w-3.5" />
 {t('common:actions.back')}
 </Button>
 )}
 {wizardStep < currentSteps.length - 1 && (
 <Button
 size="sm"
 onClick={() => goToStep(wizardStep + 1)}
 disabled={!canNavigateStep[wizardStep + 1]}
 className="gap-1"
 >
 {t('common:actions.next')}
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
 ? t('saving')
 : editingUserId
 ? t('saveChanges')
 : t('users.createTitle')}
 </Button>
 )}
 <Button variant="ghost" size="sm" onClick={() => { resetCreateForm(); setIsCreateOpen(false); resetEditForm(); }}>
 {t('common:actions.cancel')}
 </Button>
 </div>
 </DialogFooter>
 </DialogContent>
 </Dialog>

 {/* ── View User Modal ── */}
<Dialog
 open={!!viewingUser && !editingUserId && !isCreateOpen}
 onOpenChange={(open) => {
 if (!open) setViewingUser(null);
 }}
>
 <DialogContent size="xl">
 <DialogHeader
 icon={<User className="h-4 w-4" />}
 iconClassName={viewingUser?.banned
 ? 'border-destructive/20 bg-destructive/10 text-destructive'
 : 'border-primary/20 bg-primary/10 text-primary'}
 >
 <DialogTitle>{viewingUser?.username ?? t('users.viewTitle')}</DialogTitle>
 <DialogDescription>{viewingUser?.email ?? t('users.viewDescription')}</DialogDescription>
 </DialogHeader>

 <DialogBody className="space-y-4">
 {viewingUser && (
 <>
 <div className="flex flex-wrap items-center gap-2">
 {viewingUser.banned ? (
 <Badge variant="destructive" className="gap-1 text-[11px]">
 <Ban className="h-2.5 w-2.5" />
 {t('users.statusBanned')}
 </Badge>
 ) : (
 <Badge variant="success" className="gap-1 text-[11px]">
 <CheckCircle className="h-2.5 w-2.5" /> {t('users.statusActive')}
 </Badge>
 )}
 </div>

 <div className="flex flex-wrap gap-2 md:gap-3">
 <div className="flex items-center gap-1.5 rounded-lg border border-border/30 bg-card/80 px-3 py-1.5 text-xs">
 <Shield className="h-3 w-3 text-primary" />
 <span className="text-muted-foreground">{t('users.rolesHeading')}</span>
 <span className="font-semibold tabular-nums text-foreground">{viewingUser.roles.length}</span>
 </div>
 {viewingUser.twoFactorEnabled && (
 <div className="flex items-center gap-1.5 rounded-lg border border-border/30 bg-card/80 px-3 py-1.5 text-xs">
 <ShieldCheck className="h-3 w-3 text-success" />
 <span className="text-success">{t('users.twoFactorEnabled')}</span>
 </div>
 )}
 {(viewingUser.passkeys?.length ?? 0) > 0 && (
 <div className="flex items-center gap-1.5 rounded-lg border border-border/30 bg-card/80 px-3 py-1.5 text-xs">
 <Fingerprint className="h-3 w-3 text-primary" />
 <span className="text-muted-foreground">{t('users.passkeys')}</span>
 <span className="font-semibold tabular-nums text-foreground">{viewingUser.passkeys?.length ?? 0}</span>
 </div>
 )}
 <div className="flex items-center gap-1.5 rounded-lg border border-border/30 bg-card/80 px-3 py-1.5 text-xs">
 <Clock className="h-3 w-3 text-muted-foreground" />
 <span className="text-muted-foreground">{t('created')}</span>
 <span className="font-medium text-foreground">{formatDate(viewingUser.createdAt)}</span>
 </div>
 {viewingUser.lastSuccessfulLogin && (
 <div className="flex items-center gap-1.5 rounded-lg border border-border/30 bg-card/80 px-3 py-1.5 text-xs">
 <Clock className="h-3 w-3 text-muted-foreground" />
 <span className="text-muted-foreground">{t('users.lastLogin')}</span>
 <span className="font-medium text-foreground">{formatDate(viewingUser.lastSuccessfulLogin)}</span>
 </div>
 )}
 {viewingUser.lastSignInIp && (
 <div className="flex items-center gap-1.5 rounded-lg border border-border/30 bg-card/80 px-3 py-1.5 text-xs">
 <Globe className="h-3 w-3 text-muted-foreground" />
 <span className="text-muted-foreground">{t('users.lastIp')}</span>
 <span className="font-mono font-medium text-foreground">{viewingUser.lastSignInIp}</span>
 </div>
 )}
 </div>

 {viewingUser.roles.length > 0 && (
 <div className="rounded-xl border border-border/30 p-4">
 <div className="flex items-center gap-2 mb-3">
 <Shield className="h-4 w-4 text-primary" />
 <span className="text-sm font-semibold text-foreground">{t('users.rolesHeading')}</span>
 </div>
 <div className="flex flex-wrap gap-2">
 {viewingUser.roles.map((role) => (
 <span key={role.id} className="inline-flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary">
 <Shield className="h-3 w-3" />
 {roleLabel(t, role.name)}
 </span>
 ))}
 </div>
 </div>
 )}

 {(() => {
 const accounts = viewingUser.accounts ?? [];
 const passkeys = viewingUser.passkeys ?? [];
 const has2fa = !!(viewingUser.twoFactor?.length);
 const hasContent = accounts.length > 0 || passkeys.length > 0 || has2fa;
 if (!hasContent) return null;
 return (
 <div className="rounded-xl border border-border/30 p-4 space-y-3">
 <div className="flex items-center gap-2 mb-1">
 <Lock className="h-4 w-4 text-muted-foreground" />
 <span className="text-sm font-semibold text-foreground">{t('users.authentication')}</span>
 </div>

 {has2fa && (
 <div className="flex items-center gap-2 rounded-lg bg-surface-2/50 px-3 py-2 text-xs">
 <ShieldCheck className={`h-4 w-4 ${viewingUser.twoFactorEnabled ? 'text-success' : 'text-muted-foreground'}`} />
 <span className="text-foreground">{t('users.twoFactorAuth')}</span>
 <Badge variant={viewingUser.twoFactorEnabled ? 'success' : 'outline'} className="text-[10px] ml-auto">
 {viewingUser.twoFactorEnabled ? t('users.enforced') : t('users.configured')}
 </Badge>
 </div>
 )}

 {passkeys.length > 0 && (
 <div className="rounded-lg bg-surface-2/50 px-3 py-2">
 <div className="flex items-center gap-2 text-xs mb-2">
 <Fingerprint className="h-4 w-4 text-primary" />
 <span className="text-foreground">{t('users.passkeyCount', { count: passkeys.length })}</span>
 </div>
 <div className="space-y-1">
 {passkeys.map((pk) => (
 <div key={pk.id} className="flex items-center justify-between text-[11px] text-muted-foreground pl-6">
 <span>{pk.name || t('users.unnamedPasskey')}</span>
 <span className="text-muted-foreground/60">{formatDate(pk.createdAt)}</span>
 </div>
 ))}
 </div>
 </div>
 )}

 {accounts.length > 0 && (
 <div className="rounded-lg bg-surface-2/50 px-3 py-2">
 <div className="flex items-center gap-2 text-xs mb-2">
 <Link2 className="h-4 w-4 text-muted-foreground" />
 <span className="text-foreground">{t('users.linkedAccountsView')}</span>
 </div>
 <div className="space-y-1">
 {accounts.map((account) => {
 const isSSO = account.providerId !== 'credential';
 return (
 <div key={account.id} className="flex items-center gap-2 text-[11px] pl-6">
 <KeyRound className={`h-3 w-3 ${isSSO ? 'text-primary' : 'text-muted-foreground'}`} />
 <span className="text-foreground">{providerLabel(t, account.providerId)}</span>
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

 <div className="space-y-1 border-t border-border/50 pt-3 text-[11px] text-muted-foreground">
 <div>{t('users.userId')} <span className="font-mono">{viewingUser.id}</span></div>
 {viewingUser.updatedAt !== viewingUser.createdAt && (
 <div>{t('updatedAt', { date: formatDate(viewingUser.updatedAt), time: formatTime(viewingUser.updatedAt) })}</div>
 )}
 </div>
 </>
 )}
 </DialogBody>

 <DialogFooter className="sm:justify-between">
 <div className="flex items-center gap-2">
 {viewingUser && (
 <>
 <Button variant="outline" size="sm" onClick={() => { startView(viewingUser); handleEditUser(viewingUser); }} className="gap-1.5">
 <Pencil className="h-3.5 w-3.5" />
 {t('users.editUser')}
 </Button>
 {!viewingUser.banned ? (
 <Button variant="outline" size="sm" onClick={() => setBanTargets({ userIds: [viewingUser.id], label: viewingUser.username })} disabled={banMutation.isPending} className="gap-1.5 text-xs text-destructive hover:bg-destructive/5 hover:text-destructive hover:border-destructive/20">
 <Ban className="h-3.5 w-3.5" /> {t('users.ban')}
 </Button>
 ) : (
 <Button variant="outline" size="sm" onClick={() => handleBulkUnban([viewingUser.id], viewingUser.username)} disabled={unbanMutation.isPending} className="gap-1.5 text-xs text-success hover:bg-success/5 hover:text-success hover:border-success/20">
 <CheckCircle className="h-3.5 w-3.5" /> {t('users.unban')}
 </Button>
 )}
 <Button variant="destructive" size="sm" onClick={() => setDeletingUser({ id: viewingUser.id, username: viewingUser.username })} disabled={deleteMutation.isPending} className="gap-1.5">
 <Trash2 className="h-3.5 w-3.5" /> {t('common:actions.delete')}
 </Button>
 </>
 )}
 </div>
 <Button variant="ghost" size="sm" onClick={() => setViewingUser(null)}>
 {t('common:actions.close')}
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>

 {/* ── Ban Confirmation Dialog ── */}
 <ConfirmDialog
 open={!!banTargets}
 title={t('users.dialogs.banTitle')}
 message={
 <div className="space-y-3">
 <p>
 <Trans
 i18nKey="users.dialogs.banMessage"
 ns="admin-access"
 values={{ label: banTargets?.label }}
 components={{ bold: <span className="font-semibold" /> }}
 >
 You are about to ban {'{{label}}'}.
 </Trans>
 </p>
 <label className="block space-y-1">
 <span className="text-sm text-muted-foreground">
 {t('users.dialogs.reasonLabel')}
 </span>
 <input
 className="w-full rounded-lg border border-border/30 bg-card px-3 py-2 text-sm text-foreground transition-all duration-300 focus:border-primary focus:outline-none"
 value={banReason}
 onChange={(event) => setBanReason(event.target.value)}
 placeholder={t('users.dialogs.reasonPlaceholder')}
 onClick={(e) => e.stopPropagation()}
 />
 </label>
 </div>
 }
 confirmText={t('users.ban')}
 cancelText={t('common:actions.cancel')}
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
 title={t('users.dialogs.unbanTitle')}
 message={
 <p>
 <Trans
 i18nKey="users.dialogs.unbanMessage"
 ns="admin-access"
 values={{ label: unbanTargets?.label }}
 components={{ bold: <span className="font-semibold" /> }}
 >
 You are about to unban {'{{label}}'}.
 </Trans>
 </p>
 }
 confirmText={t('users.unban')}
 cancelText={t('common:actions.cancel')}
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
 title={t('users.dialogs.deleteTitle')}
 message={
 <div className="space-y-2">
 <p>
 <Trans
 i18nKey="users.dialogs.deleteMessage"
 ns="admin-access"
 values={{ username: deletingUser?.username }}
 components={{ bold: <span className="font-semibold" /> }}
 >
 Are you sure you want to delete {'"{{username}}"'}? This action cannot be undone and all associated data will be removed.
 </Trans>
 </p>
 </div>
 }
 confirmText={t('common:actions.delete')}
 cancelText={t('common:actions.cancel')}
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
 title={t('users.dialogs.wipePasskeysTitle')}
 message={
 <div className="space-y-2">
 <p>
 <Trans
 i18nKey="users.dialogs.wipePasskeysMessage"
 ns="admin-access"
 count={wipePasskeyTarget?.count ?? 0}
 values={{ username: wipePasskeyTarget?.username }}
 components={{ bold: <span className="font-semibold" /> }}
 >
 Remove all {'{{count}}'} passkeys from {'{{username}}'}?
 </Trans>
 </p>
 <p className="text-xs text-muted-foreground">
 {t('users.dialogs.wipePasskeysWarning')}
 </p>
 </div>
 }
 confirmText={t('users.dialogs.wipePasskeysConfirm')}
 cancelText={t('common:actions.cancel')}
 variant="danger"
 loading={wipePasskeysMutation.isPending}
 onConfirm={() => wipePasskeyTarget && wipePasskeysMutation.mutate(wipePasskeyTarget.id)}
 onCancel={() => setWipePasskeyTarget(null)}
 />

 {/* ── Wipe 2FA Confirmation Dialog ── */}
 <ConfirmDialog
 open={!!wipe2faTarget}
 title={t('users.dialogs.wipeTwoFactorTitle')}
 message={
 <div className="space-y-2">
 <p>
 <Trans
 i18nKey="users.dialogs.wipeTwoFactorMessage"
 ns="admin-access"
 values={{ username: wipe2faTarget?.username }}
 components={{ bold: <span className="font-semibold" /> }}
 >
 Remove two-factor authentication from {'{{username}}'}?
 </Trans>
 </p>
 <p className="text-xs text-muted-foreground">
 {t('users.dialogs.wipeTwoFactorWarning')}
 </p>
 </div>
 }
 confirmText={t('users.dialogs.wipeTwoFactorConfirm')}
 cancelText={t('common:actions.cancel')}
 variant="danger"
 loading={wipe2faMutation.isPending}
 onConfirm={() => wipe2faTarget && wipe2faMutation.mutate(wipe2faTarget.id)}
 onCancel={() => setWipe2faTarget(null)}
 />

 {/* ── Enforce/Unenforce 2FA Confirmation Dialog ── */}
 <ConfirmDialog
 open={!!enforce2faTarget}
 title={enforce2faTarget?.enforce ? t('users.dialogs.enforceTitle') : t('users.dialogs.disableEnforcementTitle')}
 message={
 <div className="space-y-2">
 <p>
 {enforce2faTarget?.enforce
 ? <Trans
 i18nKey="users.dialogs.enforceMessage"
 ns="admin-access"
 values={{ username: enforce2faTarget?.username }}
 components={{ bold: <span className="font-semibold" /> }}
 >
 Enforce 2FA for {'{{username}}'}?
 </Trans>
 : <Trans
 i18nKey="users.dialogs.disableEnforcementMessage"
 ns="admin-access"
 values={{ username: enforce2faTarget?.username }}
 components={{ bold: <span className="font-semibold" /> }}
 >
 Disable 2FA enforcement for {'{{username}}'}?
 </Trans>}
 </p>
 <p className="text-xs text-muted-foreground">
 {enforce2faTarget?.enforce
 ? t('users.dialogs.enforceWarning')
 : t('users.dialogs.disableEnforcementWarning')}
 </p>
 </div>
 }
 confirmText={enforce2faTarget?.enforce ? t('users.dialogs.enforceConfirm') : t('users.dialogs.disableConfirm')}
 cancelText={t('common:actions.cancel')}
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
 title={t('users.dialogs.unlinkTitle')}
 message={
 <div className="space-y-2">
 <p>
 <Trans
 i18nKey="users.dialogs.unlinkMessage"
 ns="admin-access"
 values={{ provider: unlinkTarget?.providerId, username: unlinkTarget?.username }}
 components={{ bold: <span className="font-semibold" /> }}
 >
 Unlink {'{{provider}}'} from {'{{username}}'}?
 </Trans>
 </p>
 <p className="text-xs text-muted-foreground">
 {t('users.dialogs.unlinkWarning')}
 </p>
 </div>
 }
 confirmText={t('users.dialogs.unlinkConfirm')}
 cancelText={t('common:actions.cancel')}
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
