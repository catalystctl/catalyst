import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@/csync';
import { qk } from '../lib/queryKeys';
import { Link } from 'react-router-dom';
import {
 Shield, ShieldCheck, ShieldOff, Key, KeyRound, Fingerprint, Smartphone,
 Globe, Monitor, Trash2, AlertTriangle, User, Mail, Calendar,
 Copy, Loader2, ExternalLink, LogOut, QrCode, RefreshCw,
 Eye, EyeOff, Plus, Camera, Pencil, X, Download,
 ChevronRight, History, Check, MailCheck,
} from 'lucide-react';

import { useProfile, useProfileSsoAccounts, useSessions, useAuditLog, useProfileApiKeys } from '../hooks/useProfile';
import { useAuthStore } from '../stores/authStore';
import { useThemeStore } from '../stores/themeStore';
import AppearanceSettings from '../components/profile/AppearanceSettings';
import { profileApi } from '../services/api/profile';
import { notifyError, notifySuccess } from '../utils/notify';
import i18n from '@/i18n';
import { formatDate, formatRelativeTime } from '@/i18n/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
 Dialog,
 DialogBody,
 DialogContent,
 DialogDescription,
 DialogFooter,
 DialogHeader,
 DialogTitle,
} from '@/components/ui/dialog';
import TabHeader from '../components/servers/tabs/TabHeader';
import ServerTabCard from '../components/servers/tabs/ServerTabCard';
import SectionHeader from '../components/servers/tabs/SectionHeader';
import TabLoadingState from '../components/servers/tabs/TabLoadingState';
import TabEmptyState from '../components/servers/tabs/TabEmptyState';

// ── Helpers ──
const fmtDate = (d: string | null | undefined) => !d ? i18n.t('notAvailable', { ns: 'profile' }) : formatDate(d);
const fmtRelative = (d: string | null | undefined) => !d ? '' : formatRelativeTime(d);
const parseUA = (ua: string | null | undefined) => {
 const unknown = i18n.t('actions.unknown', { ns: 'common' });
 if (!ua) return { browser: unknown, os: unknown, mobile: false };
 let browser = unknown, os = unknown;
 if (ua.includes('Firefox/')) browser = 'Firefox';
 else if (ua.includes('Edg/')) browser = 'Edge';
 else if (ua.includes('Chrome/')) browser = 'Chrome';
 else if (ua.includes('Safari/') && !ua.includes('Chrome')) browser = 'Safari';
 if (ua.includes('Windows')) os = 'Windows';
 else if (ua.includes('Mac OS')) os = 'macOS';
 else if (ua.includes('Linux')) os = 'Linux';
 else if (ua.includes('Android')) os = 'Android';
 else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
 return { browser, os, mobile: ua.includes('Mobile') };
};

const actionIcons: Record<string, string> = {
 'api_key.create': '🔑', 'api_key.delete': '🗑️', 'api_key.update': '✏️',
 'user.login': '🔓', 'user.logout': '🔒',
 'password.change': '🔑', 'password.reset': '🔄',
 '2fa.enable': '🛡️', '2fa.disable': '🔓', 'backup_codes.generate': '📋',
 'server.create': '🖥️', 'server.delete': '🗑️', 'server.start': '▶️', 'server.stop': '⏹️',
 'passkey.add': '👤', 'passkey.delete': '🗑️',
};

// ── Danger Zone ──
function DangerZone() {
 const { t } = useTranslation('profile');
 const [step, setStep] = useState(0);
 const [confirmText, setConfirmText] = useState('');
 const deleteMutation = useMutation({
 mutationFn: () => profileApi.deleteAccount(),
 onSuccess: () => { notifySuccess(t('dangerZone.deleted')); useAuthStore.getState().logout(); },
 onError: (e: any) => notifyError(e),
 });

 return (
 <ServerTabCard className="border-destructive/20 bg-destructive/5">
 <div className="mb-3 flex items-center gap-2.5">
 <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-destructive/10">
 <AlertTriangle className="h-4 w-4 text-destructive" />
 </div>
 <div>
 <h3 className="text-sm font-semibold text-destructive">{t('dangerZone.title')}</h3>
 <p className="text-[11px] text-destructive/70">{t('dangerZone.description')}</p>
 </div>
 </div>
 <div className="flex flex-wrap items-center gap-2">
 <Button variant="outline" size="sm" onClick={() => { profileApi.exportData().then(() => notifySuccess(t('dangerZone.exported'))).catch(() => notifyError(t('dangerZone.exportFailed'))); }} className="gap-1.5 text-xs">
 <Download className="h-3.5 w-3.5" /> {t('dangerZone.export')}
 </Button>
 {step === 0 ? (
 <Button variant="destructive" size="sm" onClick={() => setStep(1)} className="gap-1.5 text-xs">
 <Trash2 className="h-3.5 w-3.5" /> {t('dangerZone.delete')}
 </Button>
 ) : (
 <div className="flex items-center gap-2">
 <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={t('dangerZone.confirmPlaceholder')} className="h-8 w-36 text-xs" />
 <Button variant="destructive" size="sm" disabled={confirmText !== 'DELETE' || deleteMutation.isPending} onClick={() => deleteMutation.mutate()} className="text-xs">
 {deleteMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('common:actions.confirm')}
 </Button>
 <Button variant="ghost" size="sm" onClick={() => { setStep(0); setConfirmText(''); }} className="text-xs">{t('common:actions.cancel')}</Button>
 </div>
 )}
 </div>
 </ServerTabCard>
 );
}

// ── Main Page ──
export default function ProfilePage() {
 const { t } = useTranslation('profile');
 const queryClient = useQueryClient();
 const { data: profile, isLoading } = useProfile();
 const { data: ssoAccounts } = useProfileSsoAccounts();
 const { data: sessions, isLoading: sessionsLoading } = useSessions();
 const { data: auditData } = useAuditLog(50, 0);
 const { data: apiKeys } = useProfileApiKeys();
 const authUser = useAuthStore((s) => s.user);

 const authProviders = useThemeStore((s) => s.themeSettings?.authProviders);
 const availableProviders = useMemo(() => (['whmcs', 'paymenter'] as const).filter((p) => authProviders?.[p]), [authProviders]);

 const [editingProfile, setEditingProfile] = useState(false);
 const [editUsername, setEditUsername] = useState('');
 const [editFirstName, setEditFirstName] = useState('');
 const [editLastName, setEditLastName] = useState('');

 const [showCurPw, setShowCurPw] = useState(false);
 const [showNewPw, setShowNewPw] = useState(false);
 const [curPw, setCurPw] = useState('');
 const [newPw, setNewPw] = useState('');
 const [setPwVal, setSetPwVal] = useState('');
 const [revokeOthers, setRevokeOthers] = useState(false);

 const [tfaPw, setTfaPw] = useState('');
 const [tfaModalOpen, setTfaModalOpen] = useState(false);
 const [tfaSetup, setTfaSetup] = useState<{ qrCode?: string; secret?: string; otpAuthUrl?: string; backupCodes?: string[] } | null>(null);

 const [pkName, setPkName] = useState('');
 const { data: passkeys = [], refetch: refetchPasskeys } = useQuery({
 queryKey: ['profile', 'passkeys'],
 queryFn: async () => {
 try { return await profileApi.listPasskeys(); } catch { return []; }
 },
 enabled: Boolean(profile?.id),
 });
 const [editPkId, setEditPkId] = useState<string | null>(null);
 const [editPkName, setEditPkName] = useState('');

 const fileRef = useRef<HTMLInputElement>(null);
 const avatarMutation = useMutation({
 mutationFn: (file: File) => profileApi.uploadAvatar(file),
 onSuccess: () => { notifySuccess(t('toasts.avatarUpdated')); useAuthStore.getState().refresh().catch(() => {}); },
 onSettled: () => { queryClient.invalidateQueries({ queryKey: qk.profile() }); },
 onError: (e: any) => notifyError(e),
 });

 const qrValue = tfaSetup?.qrCode || (tfaSetup?.otpAuthUrl ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(tfaSetup.otpAuthUrl)}` : undefined);

 const updateProfileMutation = useMutation({
 mutationFn: () => profileApi.updateProfile({ username: editUsername, firstName: editFirstName, lastName: editLastName }),
 onSuccess: () => { notifySuccess(t('toasts.profileUpdated')); setEditingProfile(false); useAuthStore.getState().refresh().catch(() => {}); },
 onSettled: () => { queryClient.invalidateQueries({ queryKey: qk.profile() }); queryClient.invalidateQueries({ queryKey: qk.profileAuditLog() }); },
 onError: (e: any) => notifyError(e),
 });
 const changePwMutation = useMutation({
 mutationFn: () => profileApi.changePassword({ currentPassword: curPw, newPassword: newPw, revokeOtherSessions: revokeOthers }),
 onSuccess: () => { notifySuccess(t('toasts.passwordUpdated')); setCurPw(''); setNewPw(''); setRevokeOthers(false); },
 onSettled: () => { queryClient.invalidateQueries({ queryKey: qk.profile() }); queryClient.invalidateQueries({ queryKey: qk.profileSessions() }); queryClient.invalidateQueries({ queryKey: qk.profileAuditLog() }); },
 onError: (e: any) => notifyError(e),
 });
 const setPwMutation = useMutation({
 mutationFn: () => profileApi.setPassword({ newPassword: setPwVal }),
 onSuccess: () => { notifySuccess(t('toasts.passwordSet')); setSetPwVal(''); useAuthStore.getState().refresh().catch(() => {}); },
 onSettled: () => { queryClient.invalidateQueries({ queryKey: qk.profile() }); },
 onError: (e: any) => notifyError(e),
 });
 const enableTfaMutation = useMutation({
 mutationFn: () => profileApi.enableTwoFactor({ password: tfaPw }),
 onSuccess: (data: any) => {
 const p = data?.data ?? data;
 setTfaSetup({ qrCode: p?.qrCode || p?.qr || p?.qrImage, secret: p?.secret, otpAuthUrl: p?.totpURI || p?.otpAuthUrl || p?.otpauthUrl, backupCodes: p?.backupCodes || [] });
 setTfaModalOpen(true); notifySuccess(t('toasts.twoFactorEnabled')); setTfaPw('');
 },
 onSettled: () => { queryClient.invalidateQueries({ queryKey: qk.profile() }); queryClient.invalidateQueries({ queryKey: qk.profileAuditLog() }); },
 onError: (e: any) => notifyError(e),
 });
 const disableTfaMutation = useMutation({
 mutationFn: () => profileApi.disableTwoFactor({ password: tfaPw }),
 onSuccess: () => { notifySuccess(t('toasts.twoFactorDisabled')); setTfaPw(''); },
 onSettled: () => { queryClient.invalidateQueries({ queryKey: qk.profile() }); queryClient.invalidateQueries({ queryKey: qk.profileAuditLog() }); },
 onError: (e: any) => notifyError(e),
 });
 const genCodesMutation = useMutation({
 mutationFn: () => profileApi.generateBackupCodes({ password: tfaPw }),
 onSuccess: (data: any) => { setTfaSetup((p) => ({ ...p, backupCodes: data?.data?.backupCodes || data?.backupCodes || [] })); notifySuccess(t('toasts.codesGenerated')); setTfaPw(''); },
 onSettled: () => { queryClient.invalidateQueries({ queryKey: qk.profileAuditLog() }); },
 onError: (e: any) => notifyError(e),
 });
 const addPkMutation = useMutation({
 mutationFn: () => profileApi.createPasskey({ name: pkName || undefined }),
 onSuccess: async () => { notifySuccess(t('toasts.passkeyAdded')); setPkName(''); await refetchPasskeys(); },
 onSettled: () => { queryClient.invalidateQueries({ queryKey: qk.profileAuditLog() }); },
 onError: (e: any) => notifyError(e),
 });
 const delPkMutation = useMutation({
 mutationFn: (id: string) => profileApi.deletePasskey(id),
 onSuccess: async () => { notifySuccess(t('toasts.passkeyRemoved')); await refetchPasskeys(); },
 onSettled: () => { queryClient.invalidateQueries({ queryKey: qk.profileAuditLog() }); },
 onError: (e: any) => notifyError(e),
 });
 const updPkMutation = useMutation({
 mutationFn: async () => { if (!editPkId) return; return profileApi.updatePasskey(editPkId, editPkName); },
 onSuccess: async () => { notifySuccess(t('toasts.passkeyUpdated')); setEditPkId(null); setEditPkName(''); await refetchPasskeys(); },
 onSettled: () => { queryClient.invalidateQueries({ queryKey: qk.profileAuditLog() }); },
 onError: (e: any) => notifyError(e),
 });
 const revokeSessionMutation = useMutation({
 mutationFn: (id: string) => profileApi.revokeSession(id),
 onSuccess: () => { notifySuccess(t('toasts.sessionRevoked')); },
 onSettled: () => { queryClient.invalidateQueries({ queryKey: qk.profileSessions() }); queryClient.invalidateQueries({ queryKey: qk.profileAuditLog() }); },
 onError: (e: any) => notifyError(e),
 });
 const revokeAllMutation = useMutation({
 mutationFn: () => profileApi.revokeAllSessions(),
 onSuccess: () => { notifySuccess(t('sessions.revoked', { count: sessions?.length ?? 0 })); },
 onSettled: () => { queryClient.invalidateQueries({ queryKey: qk.profileSessions() }); queryClient.invalidateQueries({ queryKey: qk.profileAuditLog() }); },
 onError: (e: any) => notifyError(e),
 });
 const resendVerifyMutation = useMutation({
 mutationFn: () => profileApi.resendVerification(profile?.email ?? ''),
 onSuccess: () => { notifySuccess(t('toasts.verificationSent')); },
 onSettled: () => { queryClient.invalidateQueries({ queryKey: qk.profileAuditLog() }); },
 onError: (e: any) => notifyError(e),
 });
 const removeAvatarMutation = useMutation({
 mutationFn: () => profileApi.removeAvatar(),
 onSuccess: () => { notifySuccess(t('toasts.avatarRemoved')); useAuthStore.getState().refresh().catch(() => {}); },
 onSettled: () => { queryClient.invalidateQueries({ queryKey: qk.profile() }); },
 onError: () => notifyError(t('toasts.avatarRemoveFailed')),
 });

 const startEditProfile = () => {
 setEditUsername(profile?.username || '');
 setEditFirstName(profile?.firstName || '');
 setEditLastName(profile?.lastName || '');
 setEditingProfile(true);
 };

 if (isLoading) {
 return (
 <div className="space-y-5">
 <TabHeader icon={User} title={t('title')} description={t('description')} />
 <TabLoadingState rows={6} />
 </div>
 );
 }

 const t2fa = profile?.twoFactorEnabled ?? false;
 const hasPw = profile?.hasPassword ?? false;
 const initials = (profile?.username?.slice(0, 2) || profile?.email?.slice(0, 2) || 'U').toUpperCase();

 return (
 <div className="space-y-5">
 <TabHeader
 icon={User}
 title={t('title')}
 description={t('description')}
 />

 {/* Profile Card */}
 <ServerTabCard>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative group">
            {profile?.image ? (
              <img src={profile.image} alt="" className="h-8 w-8 rounded-md border border-border object-cover" />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface-2 text-[11px] font-semibold text-primary">{initials}</div>
            )}
            <button onClick={() => fileRef.current?.click()} className="absolute inset-0 flex items-center justify-center rounded-md bg-background/60 opacity-0 transition-opacity group-hover:opacity-100">
              <Camera className="h-3.5 w-3.5 text-foreground" />
            </button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) avatarMutation.mutate(f); e.target.value = ''; }} />
          </div>

          <div className="flex-1 min-w-0">
            {editingProfile ? (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input value={editUsername} onChange={(e) => setEditUsername(e.target.value)} placeholder={t('account.username')} className="h-8 text-xs w-36" />
                  <Input value={editFirstName} onChange={(e) => setEditFirstName(e.target.value)} placeholder={t('account.firstName')} className="h-8 text-xs w-32" />
                  <Input value={editLastName} onChange={(e) => setEditLastName(e.target.value)} placeholder={t('account.lastName')} className="h-8 text-xs w-32" />
                  <Button size="sm" onClick={() => updateProfileMutation.mutate()} disabled={updateProfileMutation.isPending} className="h-8 text-xs">
                    {updateProfileMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingProfile(false)} className="h-8 text-xs"><X className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold tracking-tight text-foreground">{profile?.username || t('account.fallbackName')}</span>
 {authUser?.permissions?.includes('*') && <Badge className="border-warning/40 bg-warning/5 text-warning text-[10px]">{t('account.superAdmin')}</Badge>}
 <button onClick={startEditProfile} className="rounded-md p-1 text-muted-foreground hover:bg-surface-2 hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>
 </div>
 <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
 <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{profile?.email}</span>
 {!profile?.emailVerified && (
 <button onClick={() => resendVerifyMutation.mutate()} disabled={resendVerifyMutation.isPending} className="flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning hover:bg-warning/20">
 {resendVerifyMutation.isPending ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <MailCheck className="h-2.5 w-2.5" />}
 {t('account.verifyEmail')}
 </button>
 )}
 {profile?.emailVerified && <Badge variant="outline" className="border-success/40 text-success text-[10px]"><Check className="mr-0.5 h-2.5 w-2.5" />{t('account.verified')}</Badge>}
 <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{t('account.joined', { date: fmtDate(profile?.createdAt) })}</span>
 </div>
 </>
 )}
 </div>

 <div className="flex flex-col items-end gap-2">
 <div className="flex gap-2">
 <Badge variant={t2fa ? 'outline' : 'secondary'} className={t2fa ? 'border-success/40 text-success' : ''}>
 {t2fa ? <ShieldCheck className="mr-1 h-3 w-3" /> : <ShieldOff className="mr-1 h-3 w-3" />}{t('account.twoFactorBadge')}
 </Badge>
 <Badge variant={hasPw ? 'outline' : 'secondary'}><Key className="mr-1 h-3 w-3" />{hasPw ? t('account.passwordSet') : t('account.passwordUnset')}</Badge>
 </div>
 {profile?.image && (
 <button onClick={() => removeAvatarMutation.mutate()} className="text-[10px] text-muted-foreground hover:text-destructive">{t('account.removeAvatar')}</button>
 )}
 </div>
 </div>
 </ServerTabCard>


 {/* Two-column grid */}
 <div className="grid gap-5 lg:grid-cols-2">
 <div className="space-y-5">
 <AppearanceSettings />
 {/* Password */}
 <ServerTabCard>
 <SectionHeader icon={Key} title={t('password.title')} description={hasPw ? t('password.updateDescription') : t('password.setDescription')} />
 {hasPw ? (
 <div className="space-y-3">
 <div className="relative">
 <Input type={showCurPw ? 'text' : 'password'} autoComplete="current-password" value={curPw} onChange={(e) => setCurPw(e.target.value)} placeholder={t('password.currentPlaceholder')} className="pr-10" />
 <button onClick={() => setShowCurPw(!showCurPw)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">{showCurPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
 </div>
 <div className="relative">
 <Input type={showNewPw ? 'text' : 'password'} autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder={t('password.newPlaceholder')} className="pr-10" />
 <button onClick={() => setShowNewPw(!showNewPw)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">{showNewPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
 </div>
 <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
 <input type="checkbox" checked={revokeOthers} onChange={(e) => setRevokeOthers(e.target.checked)} className="rounded border-border text-primary-600" />
 {t('password.signOutOthers')}
 </label>
 <Button size="sm" onClick={() => changePwMutation.mutate()} disabled={!curPw || !newPw || changePwMutation.isPending} className="w-full">
 {changePwMutation.isPending ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />{t('password.updating')}</> : t('password.update')}
 </Button>
 </div>
 ) : (
 <div className="space-y-3">
 <Input type="password" autoComplete="new-password" value={setPwVal} onChange={(e) => setSetPwVal(e.target.value)} placeholder={t('password.newPlaceholder')} />
 <Button size="sm" onClick={() => setPwMutation.mutate()} disabled={!setPwVal || setPwMutation.isPending} className="w-full">
 {setPwMutation.isPending ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />{t('password.setting')}</> : t('password.set')}
 </Button>
 </div>
 )}
 </ServerTabCard>

 {/* 2FA */}
 <ServerTabCard>
 <div className="mb-3 flex items-center justify-between">
 <SectionHeader icon={Shield} title={t('twoFactor.title')} description={t2fa ? t('twoFactor.enabledDescription') : t('twoFactor.disabledDescription')} />
 {t2fa && <Badge variant="outline" className="border-success/40 text-success text-[10px]">{t('common:actions.enabled')}</Badge>}
 </div>
 <div className="space-y-3">
 {/* autocomplete="current-password" so password managers offer the saved
     login instead of generating a new password for re-auth fields. */}
 <Input type="password" name="current-password" autoComplete="current-password" value={tfaPw} onChange={(e) => setTfaPw(e.target.value)} placeholder={t('twoFactor.confirmPlaceholder')} />
 <div className="flex flex-wrap gap-2">
 {!t2fa && <Button size="sm" onClick={() => enableTfaMutation.mutate()} disabled={!tfaPw || enableTfaMutation.isPending}>{enableTfaMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <><QrCode className="mr-1.5 h-3.5 w-3.5" />{t('twoFactor.enable')}</>}</Button>}
 {t2fa && (<>
 <Button variant="outline" size="sm" onClick={() => genCodesMutation.mutate()} disabled={!tfaPw || genCodesMutation.isPending}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />{t('twoFactor.newCodes')}</Button>
 <Button variant="outline" size="sm" onClick={() => disableTfaMutation.mutate()} disabled={!tfaPw || disableTfaMutation.isPending} className="text-destructive hover:text-destructive hover:bg-destructive/5">{t('common:actions.disable')}</Button>
 </>)}
 </div>
 </div>
 </ServerTabCard>

 {/* Passkeys */}
 <ServerTabCard>
 <SectionHeader icon={Fingerprint} title={t('passkeys.title')} description={t('passkeys.description')} />
 <div className="space-y-3">
 <div className="flex gap-2">
 <Input value={pkName} onChange={(e) => setPkName(e.target.value)} placeholder={t('passkeys.namePlaceholder')} className="flex-1 h-8 text-xs" />
 <Button size="sm" onClick={() => addPkMutation.mutate()} disabled={addPkMutation.isPending}>{addPkMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Plus className="mr-1 h-3 w-3" />{t('passkeys.add')}</>}</Button>
 </div>
 <div className="space-y-2">
 {passkeys.length === 0 ? (
 <TabEmptyState title={t('passkeys.emptyTitle')} description={t('passkeys.emptyDescription')} />
 ) : (
 passkeys.map((pk) => (
 <div key={pk.id} className="flex items-center justify-between rounded-lg border border-border/30 bg-surface-2/30 px-3 py-2.5 hover:bg-surface-2/60">
 <div className="flex items-center gap-2.5 min-w-0">
 <Smartphone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
 {editPkId === pk.id ? (
 <Input value={editPkName} onChange={(e) => setEditPkName(e.target.value)} className="h-7 w-40 text-xs" autoFocus />
 ) : (
 <div className="min-w-0">
 <div className="text-xs font-medium text-foreground truncate">{pk.name || t('unnamed')}</div>
 <div className="text-[10px] text-muted-foreground">{pk.deviceType || t('passkeys.deviceFallback')} · {fmtDate(pk.createdAt)}</div>
 </div>
 )}
 </div>
 <div className="flex items-center gap-1 shrink-0">
 {editPkId === pk.id ? (
 <button onClick={() => updPkMutation.mutate()} disabled={!editPkName} className="rounded p-1 text-xs font-medium text-primary-600 hover:bg-primary/10">{t('common:actions.save')}</button>
 ) : (
 <button onClick={() => { setEditPkId(pk.id); setEditPkName(pk.name || ''); }} className="rounded p-1 text-xs text-muted-foreground hover:text-foreground">{t('passkeys.rename')}</button>
 )}
 <button onClick={() => delPkMutation.mutate(pk.id)} className="rounded p-1 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/5"><Trash2 className="h-3 w-3" /></button>
 </div>
 </div>
 ))
 )}
 </div>
 </div>
 </ServerTabCard>

 {/* SSO */}
 {availableProviders.length > 0 && (
 <ServerTabCard>
 <SectionHeader icon={Globe} title={t('linkedAccounts.title')} description={t('linkedAccounts.description')} />
 <div className="space-y-3">
 <div className="flex flex-wrap gap-2">
 {availableProviders.map((p) => (
 <Button key={p} variant="outline" size="sm" onClick={() => profileApi.linkSso(p).then(() => { queryClient.invalidateQueries({ queryKey: qk.profileSsoAccounts() }); queryClient.invalidateQueries({ queryKey: qk.profile() }); })} className="text-xs"><ExternalLink className="mr-1.5 h-3 w-3" />{t('linkedAccounts.link', { provider: p.toUpperCase() })}</Button>
 ))}
 </div>
 {(ssoAccounts ?? []).filter((a) => a.providerId !== 'credential').length === 0 ? (
 <TabEmptyState title={t('linkedAccounts.emptyTitle')} description={t('linkedAccounts.emptyDescription')} />
 ) : (
 (ssoAccounts ?? []).filter((a) => a.providerId !== 'credential').map((a) => (
 <div key={a.id} className="flex items-center justify-between rounded-lg border border-border/30 bg-surface-2/30 px-3 py-2.5">
 <span className="text-xs font-medium text-foreground">{a.providerId.toUpperCase()}</span>
 <button onClick={() => profileApi.unlinkSso(a.providerId, a.accountId).then(() => queryClient.invalidateQueries({ queryKey: qk.profileSsoAccounts() }))} className="text-xs text-destructive hover:text-destructive">{t('linkedAccounts.unlink')}</button>
 </div>
 ))
 )}
 </div>
 </ServerTabCard>
 )}
 </div>

 <div className="space-y-5">
 {/* Sessions */}
 <ServerTabCard>
 <div className="mb-3 flex items-center justify-between">
 <SectionHeader icon={Monitor} title={t('sessions.title')} description={t('sessions.description')} />
 <Badge variant="outline" className="text-[10px]">{sessions?.length ?? 0}</Badge>
 </div>
 <div className="space-y-2 max-h-72 overflow-y-auto">
 {sessionsLoading ? (
 <TabLoadingState rows={3} />
 ) : !sessions?.length ? (
 <TabEmptyState title={t('sessions.emptyTitle')} description={t('sessions.emptyDescription')} />
 ) : (
 sessions.map((s) => {
 const { browser, os, mobile } = parseUA(s.userAgent);
 return (
 <div key={s.id} className="flex items-center justify-between rounded-lg border border-border/30 bg-surface-2/30 px-3 py-2 hover:bg-surface-2/60">
 <div className="flex items-center gap-2.5 min-w-0">
 <Monitor className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
 <div className="min-w-0">
 <div className="flex items-center gap-1.5 text-xs font-medium text-foreground truncate">{t('sessions.device', { browser, os })}{mobile && <Badge variant="secondary" className="text-[9px] px-1 py-0">{t('sessions.mobile')}</Badge>}</div>
 <div className="text-[10px] text-muted-foreground">{s.ipAddress || t('sessions.unknownIp')} · {fmtRelative(s.updatedAt)}</div>
 </div>
 </div>
 <button onClick={() => revokeSessionMutation.mutate(s.id)} className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-destructive/5 hover:text-destructive" title={t('sessions.revoke')}><LogOut className="h-3.5 w-3.5" /></button>
 </div>
 );
 })
 )}
 </div>
 {(sessions?.length ?? 0) > 1 && (
 <Button variant="outline" size="sm" onClick={() => revokeAllMutation.mutate()} disabled={revokeAllMutation.isPending} className="w-full mt-2 text-xs gap-1.5">
 {revokeAllMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><LogOut className="h-3.5 w-3.5" />{t('sessions.signOutAll')}</>}
 </Button>
 )}
 </ServerTabCard>

 {/* API Keys */}
 <ServerTabCard>
 <div className="mb-3 flex items-center justify-between">
 <SectionHeader icon={KeyRound} title={t('apiKeysCard.title')} description={t('apiKeysCard.description')} />
 {apiKeys && apiKeys.length > 0 ? <Badge variant="outline" className="text-[10px]">{apiKeys.length}</Badge> : null}
 </div>
 {apiKeys && apiKeys.length > 0 ? (
 <div className="space-y-2">
 {apiKeys.slice(0, 5).map((k) => (
 <Link to="/admin/api-keys" key={k.id} className="flex items-center justify-between rounded-lg border border-border/30 bg-surface-2/30 px-3 py-2.5 hover:bg-surface-2/60">
 <div className="min-w-0">
 <div className="flex items-center gap-2 text-xs font-medium text-foreground">
 {k.name || t('unnamed')}{!k.enabled && <Badge variant="secondary" className="text-[9px] px-1 py-0">{t('common:actions.disabled')}</Badge>}
 </div>
 <div className="text-[10px] text-muted-foreground">
 {k.allPermissions ? t('allPermissions') : t('apiKeysCard.permissionCount', { count: k.permissions.length })} · {t('apiKeysCard.requests', { count: k.requestCount })}
 </div>
 </div>
 <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
 </Link>
 ))}
 {apiKeys.length > 5 && (
 <Link to="/admin/api-keys" className="block text-center text-xs text-primary-600 hover:text-primary py-1">{t('apiKeysCard.viewAll', { count: apiKeys.length })}</Link>
 )}
 </div>
 ) : (
 <TabEmptyState title={t('apiKeysCard.emptyTitle')} description={t('apiKeysCard.emptyDescription')} />
 )}
 <Link to="/admin/api-keys"><Button variant="outline" size="sm" className="w-full mt-2 text-xs gap-1.5"><KeyRound className="h-3.5 w-3.5" />{t('apiKeysCard.manage')}</Button></Link>
 </ServerTabCard>

 {/* Activity Log */}
 <ServerTabCard>
 <SectionHeader icon={History} title={t('activity.title')} description={t('activity.description')} />
 <div className="space-y-1.5 max-h-64 overflow-y-auto">
 {(!auditData?.logs || auditData.logs.length === 0) ? (
 <TabEmptyState title={t('activity.emptyTitle')} description={t('activity.emptyDescription')} />
 ) : (
 auditData.logs.map((entry) => (
 <div key={entry.id} className="flex items-start gap-2.5 rounded-lg px-2 py-2 hover:bg-surface-2/50">
 <span className="mt-0.5 text-sm shrink-0">{actionIcons[entry.action] || '📝'}</span>
 <div className="min-w-0 flex-1">
 <div className="flex items-center gap-2">
 <span className="text-xs font-medium text-foreground">{entry.action}</span>
 {entry.resourceId && <code className="text-[10px] text-muted-foreground truncate max-w-[100px]">{entry.resourceId}</code>}
 </div>
 <div className="text-[10px] text-muted-foreground">{fmtRelative(entry.timestamp)}</div>
 </div>
 </div>
 ))
 )}
 </div>
 </ServerTabCard>
 </div>
 </div>

 {/* Danger Zone */}
 <DangerZone />

 {/* 2FA QR Modal */}
 <Dialog
 open={tfaModalOpen}
 onOpenChange={(next) => {
 if (!next) {
 setTfaModalOpen(false);
 setTfaSetup(null);
 }
 }}
 >
 <DialogContent size="md">
 <DialogHeader icon={<ShieldCheck className="h-4 w-4" />} iconClassName="border-success/20 bg-success/10 text-success">
 <DialogTitle>{t('twoFactor.setupTitle')}</DialogTitle>
 <DialogDescription>{t('twoFactor.setupDescription')}</DialogDescription>
 </DialogHeader>
 <DialogBody>
 {qrValue && <div className="mb-4 flex justify-center"><img src={qrValue} alt={t('twoFactor.qrAlt')} className="rounded-lg border border-border bg-card p-3" /></div>}
 {tfaSetup?.otpAuthUrl && <a href={tfaSetup.otpAuthUrl} target="_blank" rel="noopener noreferrer" className="mb-3 flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary"><ExternalLink className="h-3 w-3" /> {t('twoFactor.openInApp')}</a>}
 {tfaSetup?.secret && (
 <div className="mb-4 rounded-lg border border-border/50 bg-surface-2/50 p-3 text-center">
 <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{t('twoFactor.manualKey')}</div>
 <code className="mt-1 block text-sm font-mono font-semibold text-foreground select-all">{tfaSetup.secret}</code>
 <button onClick={() => { navigator.clipboard.writeText(tfaSetup?.secret ?? ''); notifySuccess(t('common:actions.copied')); }} className="mt-2 flex items-center gap-1 mx-auto text-[10px] text-muted-foreground hover:text-foreground"><Copy className="h-3 w-3" /> {t('common:actions.copy')}</button>
 </div>
 )}
 {(tfaSetup?.backupCodes?.length ?? 0) > 0 && (
 <div className="mb-4 rounded-lg border border-warning/30 bg-warning/5 p-4">
 <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-warning"><AlertTriangle className="h-3.5 w-3.5" /> {t('twoFactor.backupCodesWarning')}</div>
 <div className="grid grid-cols-2 gap-1.5">{tfaSetup!.backupCodes!.map((code) => <code key={code} className="rounded bg-card px-2 py-1 text-center text-[11px] font-mono">{code}</code>)}</div>
 </div>
 )}
 </DialogBody>
 <DialogFooter>
 <Button size="sm" onClick={() => { setTfaModalOpen(false); setTfaSetup(null); }}>{t('done')}</Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 </div>
 );
}
