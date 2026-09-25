import { useMemo, useRef, useState, useCallback } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useMutation } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import {
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
import TabEmptyState from '../../components/servers/tabs/TabEmptyState';
import { BracketLabel, Segmented, StatusLed } from '../../components/deck/primitives';
import { cn } from '@/lib/utils';
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
 className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-mini font-medium transition-all duration-200 ${
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
 className={`inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-mini font-medium transition-all duration-150 ${
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
 className={`inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-mini font-medium transition-all duration-150 ${
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
 <div className="flex items-center gap-1.5 rounded-sm border border-border/30 bg-surface-2 px-2.5 py-1.5 text-mini">
 <Globe className="h-3 w-3 text-muted-foreground" />
 <span className="text-muted-foreground">{t('users.lastIpLabel')}</span>
 <span className="font-mono text-foreground">{lastIp}</span>
 </div>
 )}
 {lastLogin && (
 <div className="flex items-center gap-1.5 rounded-sm border border-border/30 bg-surface-2 px-2.5 py-1.5 text-mini">
 <Clock className="h-3 w-3 text-muted-foreground" />
 <span className="text-muted-foreground">{t('users.lastSignIn')}</span>
 <span className="text-foreground">{formatDateTime(lastLogin)}</span>
 </div>
 )}
 </div>
 )}

 {/* 2FA status */}
 <div className="rounded-sm border border-border/30 bg-card p-4">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-3">
 <ShieldCheck className={`h-4 w-4 shrink-0 ${twoFactorEnabled ? 'text-success' : 'text-muted-foreground'}`} />
 <div>
 <div className="text-sm font-medium text-foreground">{t('users.twoFactorAuth')}</div>
 <div className="text-micro text-muted-foreground">
 {has2fa ? (twoFactorEnabled ? t('users.enabledAndEnforced') : t('users.setUpNotEnforced')) : t('users.notSetUp')}
 </div>
 </div>
 </div>
 <div className="flex items-center gap-1.5">
 {has2fa && !twoFactorEnabled && (
 <Button variant="outline" size="sm" className="gap-1 text-mini" disabled={loading} onClick={() => onEnforce2fa(true)}>
 <ShieldCheck className="h-3 w-3" /> {t('users.enforce')}
 </Button>
 )}
 {twoFactorEnabled && has2fa && (
 <Button variant="outline" size="sm" className="gap-1 text-mini" disabled={loading} onClick={() => onEnforce2fa(false)}>
 {t('users.unenforce')}
 </Button>
 )}
 {has2fa && (
 <Button variant="outline" size="sm" className="gap-1 text-mini text-destructive hover:bg-destructive/5 hover:text-destructive hover:border-destructive/20" disabled={loading} onClick={onWipe2fa}>
 <Trash2 className="h-3 w-3" /> {t('users.wipeTwoFactor')}
 </Button>
 )}
 </div>
 </div>
 </div>

 {/* Passkeys */}
 <div className="rounded-sm border border-border/30 bg-card p-4">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-3">
 <Fingerprint className={`h-4 w-4 shrink-0 ${passkeys.length > 0 ? 'text-primary' : 'text-muted-foreground'}`} />
 <div>
 <div className="text-sm font-medium text-foreground">{t('users.passkeys')}</div>
 <div className="text-micro text-muted-foreground">
 {passkeys.length ? t('users.passkeysRegistered', { count: passkeys.length }) : t('users.noPasskeys')}
 </div>
 </div>
 </div>
 {passkeys.length > 0 && (
 <Button variant="outline" size="sm" className="gap-1 text-mini text-destructive hover:bg-destructive/5 hover:text-destructive hover:border-destructive/20" disabled={loading} onClick={onWipePasskeys}>
 <Trash2 className="h-3 w-3" /> {t('users.wipeAll')}
 </Button>
 )}
 </div>
 {passkeys.length > 0 && (
 <div className="mt-3 space-y-1.5">
 {passkeys.map((pk) => (
 <div key={pk.id} className="flex items-center justify-between rounded-sm bg-surface-2/50 px-3 py-2 text-mini">
 <span className="text-muted-foreground">{pk.name || t('users.unnamedPasskey')}</span>
 <span className="text-micro text-muted-foreground/60">{formatDate(pk.createdAt)}</span>
 </div>
 ))}
 </div>
 )}
 </div>

 {/* Linked SSO accounts */}
 <div className="rounded-sm border border-border/30 bg-card p-4">
 <div className="flex items-center gap-2 mb-3">
 <Link2 className="h-4 w-4 text-muted-foreground" />
 <span className="text-sm font-medium text-foreground">{t('users.linkedAccounts')}</span>
 </div>
 {accounts.length === 0 ? (
 <p className="text-mini text-muted-foreground">{t('users.noLinkedAccounts')}</p>
 ) : (
 <div className="space-y-2">
 {accounts.map((account) => {
 const isSSO = account.providerId !== 'credential';
 return (
 <div key={account.id} className="flex items-center justify-between rounded-sm bg-surface-2/50 px-3 py-2 text-mini">
 <div className="flex items-center gap-2">
 <KeyRound className={`h-3.5 w-3.5 ${isSSO ? 'text-primary' : 'text-muted-foreground'}`} />
 <span className="text-foreground">{providerLabel(t, account.providerId)}</span>
 {isSSO && (
 <span className="text-micro font-mono text-muted-foreground/60">
 {account.accountId.slice(0, 12)}…
 </span>
 )}
 </div>
 {isSSO && (
 <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-micro text-destructive hover:bg-destructive/5 hover:text-destructive" disabled={loading} onClick={() => onUnlink(account.id, account.providerId)}>
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
/**
 * One grid template shared by the column header and every row so columns line
 * up. Fixed / minmax(0,1fr) tracks only — never `auto`.
 *   base : identity · actions
 *   md   : identity · role · status · actions
 */
const GRID =
 'grid grid-cols-1 items-center gap-x-3 gap-y-1.5 ' +
 'md:grid-cols-[minmax(0,1fr)_10rem_8rem_9rem]';

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
 <div className="flex min-h-0 flex-1 flex-col gap-3">
 {/* ── Deck header ── */}
 <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
 <div className="flex min-w-0 flex-col gap-1">
 <BracketLabel>{t('layout:sections.accessControl')}</BracketLabel>
 <h1 className="font-display text-lg font-semibold leading-none tracking-tight text-foreground">
 {t('users.title')}
 </h1>
 <p className="text-mini text-muted-foreground">{t('users.description')}</p>
 </div>
 <Button
 size="sm"
 onClick={() => {
 resetCreateForm();
 setIsCreateOpen(true);
 }}
 className="h-8 gap-1.5 rounded-sm px-3 text-mini"
 >
 <UserPlus className="h-3.5 w-3.5" />
 {t('users.createTitle')}
 </Button>
 </header>

 {/* ── The deck: controls, columns, rows and totals in one frame ── */}
 <div className="deck-panel flex min-h-0 flex-col overflow-hidden">
 {/* Control strip */}
 <div className="flex flex-wrap items-center gap-2 border-b border-border/50 bg-surface-1/40 px-3 py-1.5">
 <label className="relative flex min-w-[12rem] flex-1 items-center">
 <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-muted-foreground" />
 <input
 type="search"
 value={search}
 onChange={(event) => {
 setSearch(event.target.value);
 setPage(1);
 }}
 placeholder={t('users.searchPlaceholder')}
 className="h-7 w-full rounded-sm border border-border/60 bg-background/40 pl-7 pr-2 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 />
 </label>

 <button
 type="button"
 onClick={() => setShowFilters(!showFilters)}
 className={cn(
 'flex h-7 items-center gap-1.5 rounded-sm border border-border/60 px-2.5 text-mini transition-colors',
 hasActiveFilters ? 'border-primary/50 text-foreground' : 'text-muted-foreground hover:text-foreground',
 )}
 >
 <Filter className="h-3 w-3" />
 {t('filters')}
 {hasActiveFilters && (
 <span className="font-mono text-micro tabular-nums text-primary">
 {[roleFilter, statusFilter].filter(Boolean).length}
 </span>
 )}
 </button>

 <Select value={sort} onValueChange={setSort}>
 <SelectTrigger className="h-7 w-40 gap-2 rounded-sm border-border/60 text-mini">
 <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
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

 <span className="ml-auto font-mono text-micro tabular-nums text-muted-foreground">
 {t('users.showing', { shown: filteredUsers.length, total: data?.pagination?.total ?? users.length })}
 </span>
 </div>

 {/* Expandable filter panel */}
 {showFilters && (
 <div className="flex flex-wrap items-end gap-4 border-b border-border/50 bg-surface-1/20 px-3 py-2">
 <label className="flex flex-col gap-1">
 <span className="type-overline">{t('users.roleLabel')}</span>
 <Select
 value={roleFilter || 'all'}
 onValueChange={(value) => {
 setRoleFilter(value === 'all' ? '' : value);
 setPage(1);
 }}
 >
 <SelectTrigger className="h-7 w-44 rounded-sm border-border/60 text-mini">
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
 <label className="flex flex-col gap-1">
 <span className="type-overline">{t('users.statusLabel')}</span>
 <Select
 value={statusFilter || 'all'}
 onValueChange={(value) => {
 setStatusFilter(value === 'all' ? '' : value);
 setPage(1);
 }}
 >
 <SelectTrigger className="h-7 w-44 rounded-sm border-border/60 text-mini">
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
 <button
 type="button"
 onClick={clearFilters}
 className="flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-mini text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
 >
 <X className="h-3 w-3" />
 {t('users.clearAll')}
 </button>
 )}
 </div>
 )}

 {/* Bulk actions strip */}
 {selectedIds.length > 0 && (
 <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 bg-primary/5 px-3 py-1.5">
 <div className="flex items-center gap-3">
 <span className="text-mini text-foreground">
 {t('users.selectedCount', { count: selectedIds.length })}
 </span>
 <button
 type="button"
 onClick={() => setSelectedIds([])}
 className="text-micro text-muted-foreground transition-colors hover:text-foreground"
 >
 {t('users.clearSelection')}
 </button>
 </div>
 <div className="flex flex-wrap items-center gap-1.5">
 <Button variant="outline" size="sm" onClick={() => handleBulkBan(selectedIds, t('users.userCount', { count: selectedIds.length }))} disabled={banMutation.isPending || unbanMutation.isPending || bulkDeleteMutation.isPending} className="h-7 gap-1.5 rounded-sm px-2.5 text-mini text-destructive hover:border-destructive/20 hover:bg-destructive/5 hover:text-destructive">
 <Ban className="h-3 w-3" /> {t('users.ban')}
 </Button>
 <Button variant="outline" size="sm" onClick={() => handleBulkUnban(selectedIds, t('users.userCount', { count: selectedIds.length }))} disabled={banMutation.isPending || unbanMutation.isPending || bulkDeleteMutation.isPending} className="h-7 gap-1.5 rounded-sm px-2.5 text-mini text-success hover:border-success/20 hover:bg-success/5 hover:text-success">
 <CheckCircle className="h-3 w-3" /> {t('users.unban')}
 </Button>
 {selectedIds.some((id) => !users.find((u) => u.id === id)?.emailVerified) && (
 <Button variant="outline" size="sm" onClick={() => handleBulkVerifyEmails(selectedIds)} disabled={verifyEmailMutation.isPending} className="h-7 gap-1.5 rounded-sm px-2.5 text-mini text-success hover:border-success/20 hover:bg-success/5 hover:text-success">
 <MailCheck className="h-3 w-3" /> {t('users.verifyEmails')}
 </Button>
 )}
 <span className="mx-1 h-4 w-px bg-border" aria-hidden />
 <Button variant="destructive" size="sm" onClick={() => handleBulkDelete(selectedIds, t('users.userCount', { count: selectedIds.length }))} disabled={banMutation.isPending || unbanMutation.isPending || bulkDeleteMutation.isPending} className="h-7 gap-1.5 rounded-sm px-2.5 text-mini">
 <Trash2 className="h-3 w-3" /> {t('common:actions.delete')}
 </Button>
 </div>
 </div>
 )}

 {/* Column header — same grid as the rows, so columns always line up */}
 <div
 className={cn(
 GRID,
 'sticky top-0 z-10 hidden border-b border-border/50 bg-surface-1 py-1.5 pl-3 pr-3 text-muted-foreground/70 md:grid',
 )}
 >
 <span className="flex items-center gap-2">
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
 aria-label={t('users.selectAll')}
 className="h-3.5 w-3.5 shrink-0 rounded-sm border-border bg-card text-primary"
 />
 <span className="type-overline">{t('users.title')}</span>
 </span>
 <span className="type-overline hidden justify-self-end md:inline-flex">{t('users.roleLabel')}</span>
 <span className="type-overline hidden justify-self-end md:inline-flex">{t('users.statusLabel')}</span>
 <span className="type-overline justify-self-end">{t('users.more')}</span>
 </div>

 {/* Rows */}
 <div className="max-h-[calc(100dvh-20rem)] min-w-0 overflow-y-auto bg-background/25">
 {isLoading ? (
 <div>
 {Array.from({ length: 6 }).map((_, index) => (
 <div key={index} className={cn(GRID, 'border-t border-border/40 py-2 pl-3 pr-3')}>
 <div className="flex items-center gap-2">
 <div className="h-2 w-2 animate-pulse rounded-full bg-surface-3" />
 <div className="h-3.5 w-40 animate-pulse bg-surface-3" />
 </div>
 </div>
 ))}
 </div>
 ) : filteredUsers.length > 0 ? (
 filteredUsers.map((user: AdminUser) => {
 const isSelected = selectedIds.includes(user.id);
 const isActiveView = viewingUser?.id === user.id;
 const roleNames = user.roles.length > 0
 ? user.roles.map((role) => roleLabel(t, role.name)).join(', ')
 : '—';
 const statusLabel = user.banned
 ? t('users.statusBanned')
 : user.emailVerified
 ? t('users.statusActive')
 : t('users.statusUnverified');
 const statusClass = user.banned
 ? 'text-danger'
 : user.emailVerified
 ? 'text-success'
 : 'text-warning';

 return (
 <div
 key={user.id}
 role="row"
 onClick={() => startView(user)}
 className={cn(
 GRID,
 'group cursor-pointer py-1.5 pl-3 pr-3 transition-colors hover:bg-surface-1/40',
 (isSelected || isActiveView) && 'bg-primary/5',
 )}
 >
 {/* identity */}
 <div className="flex min-w-0 items-center gap-2">
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
 className="h-3.5 w-3.5 shrink-0 rounded-sm border-border bg-card text-primary"
 />
 <StatusLed
 tone={user.banned ? 'alarm' : user.emailVerified ? 'go' : 'hazard'}
 pulse={!user.banned && user.emailVerified}
 />
 <div className="flex min-w-0 flex-col leading-tight">
 <span
 className="truncate font-display text-data font-semibold tracking-tight text-foreground"
 title={user.username}
 >
 {user.username}
 </span>
 <span className="flex min-w-0 items-center gap-2 text-micro text-muted-foreground">
 <Mail className="h-3 w-3 shrink-0" />
 <span className="truncate" title={user.email}>{user.email}</span>
 <span className="hidden truncate font-mono opacity-60 sm:inline" title={user.id}>{user.id}</span>
 <span className="hidden shrink-0 sm:inline">
 {t('users.createdOn', { date: formatDate(user.createdAt) })}
 </span>
 {user.twoFactorEnabled && (
 <span className="hidden shrink-0 items-center gap-1 lg:flex">
 <ShieldCheck className="h-3 w-3 text-success" />
 {t('users.twoFactorShort')}
 </span>
 )}
 {(user.passkeys?.length ?? 0) > 0 && (
 <span className="hidden shrink-0 items-center gap-1 lg:flex">
 <Fingerprint className="h-3 w-3 text-success" />
 {t('users.keyCount', { count: user.passkeys?.length ?? 0 })}
 </span>
 )}
 <span className={cn('shrink-0 uppercase md:hidden', statusClass)}>{statusLabel}</span>
 </span>
 </div>
 </div>

 {/* role */}
 <span className="hidden min-w-0 justify-self-end md:flex">
 {user.roles.length > 0 ? (
 <span className="flex min-w-0 items-center gap-1 text-micro text-muted-foreground" title={roleNames}>
 <Shield className="h-3 w-3 shrink-0" />
 <span className="truncate">{roleNames}</span>
 </span>
 ) : (
 <span className="text-micro text-muted-foreground/40">—</span>
 )}
 </span>

 {/* status */}
 <span className="hidden min-w-0 justify-self-end md:flex">
 <span className={cn('truncate text-micro uppercase', statusClass)}>{statusLabel}</span>
 </span>

 {/* actions */}
 <span className="col-span-full flex shrink-0 items-center justify-start gap-1 md:col-auto md:justify-end">
 {user.banned ? (
 <button
 className="flex h-7 w-7 items-center justify-center rounded-sm border border-border/60 text-muted-foreground transition-colors hover:border-success/50 hover:text-success disabled:pointer-events-none disabled:opacity-30"
 onClick={() => handleBulkUnban([user.id], user.username)}
 disabled={banMutation.isPending || unbanMutation.isPending}
 title={t('users.unban')}
 >
 <CheckCircle className="h-3.5 w-3.5" />
 </button>
 ) : (
 <button
 className="flex h-7 w-7 items-center justify-center rounded-sm border border-border/60 text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
 onClick={() => handleBulkBan([user.id], user.username)}
 disabled={banMutation.isPending || unbanMutation.isPending}
 title={t('users.ban')}
 >
 <Ban className="h-3.5 w-3.5" />
 </button>
 )}
 {!user.emailVerified && (
 <button
 className="flex h-7 w-7 items-center justify-center rounded-sm border border-border/60 text-muted-foreground transition-colors hover:border-success/50 hover:text-success disabled:pointer-events-none disabled:opacity-30"
 onClick={() => verifyEmailMutation.mutate(user.id)}
 disabled={verifyEmailMutation.isPending}
 title={t('users.verifyEmailAction')}
 >
 <MailCheck className="h-3.5 w-3.5" />
 </button>
 )}

 <button
 className="flex h-7 w-7 items-center justify-center rounded-sm border border-border/60 text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
 onClick={(e) => { e.stopPropagation(); startView(user); }}
 title={t('users.viewDetails')}
 >
 <Eye className="h-3.5 w-3.5" />
 </button>
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <button
 className="flex h-7 w-7 items-center justify-center rounded-sm border border-border/60 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
 title={t('users.more')}
 onClick={(e) => e.stopPropagation()}
 >
 <MoreHorizontal className="h-3.5 w-3.5" />
 </button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end">
 <DropdownMenuItem onClick={() => startView(user)} className="gap-2 text-mini">
 <Eye className="h-3.5 w-3.5" />
 {t('users.view')}
 </DropdownMenuItem>
 <DropdownMenuItem
 onClick={() => handleEditUser(user)}
 disabled={updateMutation.isPending}
 className="gap-2 text-mini"
 >
 <Pencil className="h-3.5 w-3.5" />
 {t('common:actions.edit')}
 </DropdownMenuItem>
 <DropdownMenuSeparator />
 {user.banned ? (
 <DropdownMenuItem
 onClick={() => handleBulkUnban([user.id], user.username)}
 disabled={banMutation.isPending || unbanMutation.isPending}
 className="gap-2 text-mini text-success"
 >
 <CheckCircle className="h-3.5 w-3.5" />
 {t('users.unban')}
 </DropdownMenuItem>
 ) : (
 <DropdownMenuItem
 onClick={() => handleBulkBan([user.id], user.username)}
 disabled={banMutation.isPending || unbanMutation.isPending}
 className="gap-2 text-mini text-destructive"
 >
 <Ban className="h-3.5 w-3.5" />
 {t('users.ban')}
 </DropdownMenuItem>
 )}
 {!user.emailVerified && (
 <DropdownMenuItem
 onClick={() => verifyEmailMutation.mutate(user.id)}
 disabled={verifyEmailMutation.isPending}
 className="gap-2 text-mini text-success"
 >
 <MailCheck className="h-3.5 w-3.5" />
 {t('users.verifyEmailMenuItem')}
 </DropdownMenuItem>
 )}
 <DropdownMenuSeparator />
 <DropdownMenuItem
 onClick={() => setDeletingUser({ id: user.id, username: user.username })}
 disabled={deleteMutation.isPending}
 className="gap-2 text-mini text-destructive"
 >
 <Trash2 className="h-3.5 w-3.5" />
 {t('common:actions.delete')}
 </DropdownMenuItem>
 </DropdownMenuContent>
 </DropdownMenu>
 </span>
 </div>
 );
 })
 ) : (
 <div className="p-3">
 <TabEmptyState
 title={search.trim() || hasActiveFilters ? t('users.emptyFilteredTitle') : t('users.emptyTitle')}
 description={search.trim() || hasActiveFilters ? t('users.emptyFilteredDescription') : t('users.emptyDescription')}
 action={
 hasActiveFilters ? (
 <Button variant="outline" size="sm" className="h-7 rounded-sm px-2.5 text-mini" onClick={clearFilters}>
 <X className="mr-1.5 h-3.5 w-3.5" />
 {t('users.clearFilters')}
 </Button>
 ) : (
 <Button size="sm" className="h-7 gap-1.5 rounded-sm px-2.5 text-mini" onClick={() => { resetCreateForm(); setIsCreateOpen(true); }}>
 <UserPlus className="h-3.5 w-3.5" />
 {t('users.createTitle')}
 </Button>
 )
 }
 />
 </div>
 )}
 </div>

 {/* Pagination */}
 {pagination && pagination.totalPages > 1 ? (
 <div className="border-t border-border/50 px-3 py-2">
 <Pagination
 page={pagination.page}
 totalPages={pagination.totalPages}
 onPageChange={setPage}
 />
 </div>
 ) : null}

 {/* Footer strip — directory totals */}
 <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/50 bg-surface-1/40 px-3 py-1.5">
 <span className="flex items-center gap-1.5">
 <StatusLed tone="idle" />
 <Segmented muted className="text-micro">
 {t('users.count', { count: data?.pagination?.total ?? 0 })}
 </Segmented>
 </span>
 {roles.length > 0 && (
 <span className="flex items-center gap-1.5">
 <Shield className="h-3 w-3 text-muted-foreground" />
 <Segmented muted className="text-micro">{t('users.roleCount', { count: roles.length })}</Segmented>
 </span>
 )}
 {bannedCount > 0 && (
 <span className="flex items-center gap-1.5">
 <StatusLed tone="alarm" />
 <Segmented muted className="text-micro">{t('users.bannedCount', { count: bannedCount })}</Segmented>
 </span>
 )}
 {unverifiedCount > 0 && (
 <span className="flex items-center gap-1.5">
 <StatusLed tone="hazard" />
 <Segmented muted className="text-micro">{t('users.unverifiedCount', { count: unverifiedCount })}</Segmented>
 </span>
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
 <div className="text-mini font-semibold uppercase tracking-wide text-muted-foreground">
 {t('users.accountCredentials')}
 </div>
 <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
 <label className="block space-y-1.5">
 <span className="text-mini font-medium text-muted-foreground">
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
 <span className="text-mini font-medium text-muted-foreground">
 {t('users.usernameLabel')} <span className="text-destructive">*</span>
 </span>
 <Input
 value={editingUserId ? editUsername : createUsername}
 onChange={(e) => editingUserId ? setEditUsername(e.target.value) : setCreateUsername(e.target.value)}
 placeholder="username"
 />
 </label>
 <label className="block space-y-1.5">
 <span className="text-mini font-medium text-muted-foreground">
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
 <div className={`flex items-center gap-1.5 rounded-sm px-2 py-1 text-micro ${createEmail.trim() ? 'text-success bg-success/5' : 'text-muted-foreground bg-surface-2'}`}>
 {createEmail.trim() ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
 {t('users.emailSet')}
 </div>
 <div className={`flex items-center gap-1.5 rounded-sm px-2 py-1 text-micro ${createUsername.trim() ? 'text-success bg-success/5' : 'text-muted-foreground bg-surface-2'}`}>
 {createUsername.trim() ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
 {t('users.usernameSet')}
 </div>
 <div className={`flex items-center gap-1.5 rounded-sm px-2 py-1 text-micro ${createPassword.trim().length >= 8 ? 'text-success bg-success/5' : 'text-muted-foreground bg-surface-2'}`}>
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
 <Badge variant="default" className="tabular-nums text-micro">
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
 className="h-8 pl-8 text-mini"
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
 <span className="text-mini text-muted-foreground italic">{t('users.noRolesMatch')}</span>
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
 <Badge className="tabular-nums text-micro border-primary/30 bg-primary/10 text-primary">
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
 className="h-8 pl-8 text-mini"
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
 <span className="text-mini text-muted-foreground italic">{t('users.noServersMatch')}</span>
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
 <div className="text-mini text-muted-foreground">
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
 <Badge variant="destructive" className="gap-1 text-micro">
 <Ban className="h-2.5 w-2.5" />
 {t('users.statusBanned')}
 </Badge>
 ) : (
 <Badge variant="success" className="gap-1 text-micro">
 <CheckCircle className="h-2.5 w-2.5" /> {t('users.statusActive')}
 </Badge>
 )}
 </div>

 <div className="flex flex-wrap gap-2 md:gap-3">
 <div className="flex items-center gap-1.5 rounded-sm border border-border/30 bg-card/80 px-3 py-1.5 text-mini">
 <Shield className="h-3 w-3 text-primary" />
 <span className="text-muted-foreground">{t('users.rolesHeading')}</span>
 <span className="font-semibold tabular-nums text-foreground">{viewingUser.roles.length}</span>
 </div>
 {viewingUser.twoFactorEnabled && (
 <div className="flex items-center gap-1.5 rounded-sm border border-border/30 bg-card/80 px-3 py-1.5 text-mini">
 <ShieldCheck className="h-3 w-3 text-success" />
 <span className="text-success">{t('users.twoFactorEnabled')}</span>
 </div>
 )}
 {(viewingUser.passkeys?.length ?? 0) > 0 && (
 <div className="flex items-center gap-1.5 rounded-sm border border-border/30 bg-card/80 px-3 py-1.5 text-mini">
 <Fingerprint className="h-3 w-3 text-primary" />
 <span className="text-muted-foreground">{t('users.passkeys')}</span>
 <span className="font-semibold tabular-nums text-foreground">{viewingUser.passkeys?.length ?? 0}</span>
 </div>
 )}
 <div className="flex items-center gap-1.5 rounded-sm border border-border/30 bg-card/80 px-3 py-1.5 text-mini">
 <Clock className="h-3 w-3 text-muted-foreground" />
 <span className="text-muted-foreground">{t('created')}</span>
 <span className="font-medium text-foreground">{formatDate(viewingUser.createdAt)}</span>
 </div>
 {viewingUser.lastSuccessfulLogin && (
 <div className="flex items-center gap-1.5 rounded-sm border border-border/30 bg-card/80 px-3 py-1.5 text-mini">
 <Clock className="h-3 w-3 text-muted-foreground" />
 <span className="text-muted-foreground">{t('users.lastLogin')}</span>
 <span className="font-medium text-foreground">{formatDate(viewingUser.lastSuccessfulLogin)}</span>
 </div>
 )}
 {viewingUser.lastSignInIp && (
 <div className="flex items-center gap-1.5 rounded-sm border border-border/30 bg-card/80 px-3 py-1.5 text-mini">
 <Globe className="h-3 w-3 text-muted-foreground" />
 <span className="text-muted-foreground">{t('users.lastIp')}</span>
 <span className="font-mono font-medium text-foreground">{viewingUser.lastSignInIp}</span>
 </div>
 )}
 </div>

 {viewingUser.roles.length > 0 && (
 <div className="rounded-sm border border-border/30 p-4">
 <div className="flex items-center gap-2 mb-3">
 <Shield className="h-4 w-4 text-primary" />
 <span className="text-sm font-semibold text-foreground">{t('users.rolesHeading')}</span>
 </div>
 <div className="flex flex-wrap gap-2">
 {viewingUser.roles.map((role) => (
 <span key={role.id} className="inline-flex items-center gap-1.5 rounded-sm border border-primary/20 bg-primary/5 px-3 py-1.5 text-mini font-medium text-primary">
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
 <div className="rounded-sm border border-border/30 p-4 space-y-3">
 <div className="flex items-center gap-2 mb-1">
 <Lock className="h-4 w-4 text-muted-foreground" />
 <span className="text-sm font-semibold text-foreground">{t('users.authentication')}</span>
 </div>

 {has2fa && (
 <div className="flex items-center gap-2 rounded-sm bg-surface-2/50 px-3 py-2 text-mini">
 <ShieldCheck className={`h-4 w-4 ${viewingUser.twoFactorEnabled ? 'text-success' : 'text-muted-foreground'}`} />
 <span className="text-foreground">{t('users.twoFactorAuth')}</span>
 <Badge variant={viewingUser.twoFactorEnabled ? 'success' : 'outline'} className="text-micro ml-auto">
 {viewingUser.twoFactorEnabled ? t('users.enforced') : t('users.configured')}
 </Badge>
 </div>
 )}

 {passkeys.length > 0 && (
 <div className="rounded-sm bg-surface-2/50 px-3 py-2">
 <div className="flex items-center gap-2 text-mini mb-2">
 <Fingerprint className="h-4 w-4 text-primary" />
 <span className="text-foreground">{t('users.passkeyCount', { count: passkeys.length })}</span>
 </div>
 <div className="space-y-1">
 {passkeys.map((pk) => (
 <div key={pk.id} className="flex items-center justify-between text-micro text-muted-foreground pl-6">
 <span>{pk.name || t('users.unnamedPasskey')}</span>
 <span className="text-muted-foreground/60">{formatDate(pk.createdAt)}</span>
 </div>
 ))}
 </div>
 </div>
 )}

 {accounts.length > 0 && (
 <div className="rounded-sm bg-surface-2/50 px-3 py-2">
 <div className="flex items-center gap-2 text-mini mb-2">
 <Link2 className="h-4 w-4 text-muted-foreground" />
 <span className="text-foreground">{t('users.linkedAccountsView')}</span>
 </div>
 <div className="space-y-1">
 {accounts.map((account) => {
 const isSSO = account.providerId !== 'credential';
 return (
 <div key={account.id} className="flex items-center gap-2 text-micro pl-6">
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

 <div className="space-y-1 border-t border-border/50 pt-3 text-micro text-muted-foreground">
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
 <Button variant="outline" size="sm" onClick={() => setBanTargets({ userIds: [viewingUser.id], label: viewingUser.username })} disabled={banMutation.isPending} className="gap-1.5 text-mini text-destructive hover:bg-destructive/5 hover:text-destructive hover:border-destructive/20">
 <Ban className="h-3.5 w-3.5" /> {t('users.ban')}
 </Button>
 ) : (
 <Button variant="outline" size="sm" onClick={() => handleBulkUnban([viewingUser.id], viewingUser.username)} disabled={unbanMutation.isPending} className="gap-1.5 text-mini text-success hover:bg-success/5 hover:text-success hover:border-success/20">
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
 className="w-full rounded-sm border border-border/30 bg-card px-3 py-2 text-sm text-foreground transition-all duration-300 focus:border-primary focus:outline-none"
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
 <p className="text-mini text-muted-foreground">
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
 <p className="text-mini text-muted-foreground">
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
 <p className="text-mini text-muted-foreground">
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
 <p className="text-mini text-muted-foreground">
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
