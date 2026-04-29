import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { qk } from '../lib/queryKeys';
import { Link } from 'react-router-dom';
import { motion, type Variants } from 'framer-motion';
import {
  Shield, ShieldCheck, ShieldOff, Key, KeyRound, Fingerprint, Smartphone,
  Globe, Clock, Monitor, Trash2, AlertTriangle, User, Mail, Calendar,
  Copy, CheckCircle2, Loader2, ExternalLink, LogOut, QrCode, RefreshCw,
  Eye, EyeOff, Plus, Camera, Pencil, X, Download, FileText, Activity,
  ChevronRight, History, Settings, Info, Check, Ban, MailCheck,
} from 'lucide-react';
import { useProfile, useProfileSsoAccounts, useSessions, useAuditLog, useProfileApiKeys } from '../hooks/useProfile';
import { useAuthStore } from '../stores/authStore';
import { type Passkey, type UserSession, type AuditLogEntry, type ApiKeySummary, profileApi } from '../services/api/profile';
import { notifyError, notifySuccess } from '../utils/notify';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ModalPortal } from '@/components/ui/modal-portal';
import { useThemeStore } from '../stores/themeStore';

// ── Animation ──
const containerVariants = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.04, delayChildren: 0.05 } } };
const itemVariants: Variants = { hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } } };

// ── Helpers ──
const fmtDate = (d: string | null | undefined) => !d ? 'N/A' : new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const fmtRelative = (d: string | null | undefined) => {
  if (!d) return '';
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return 'Just now'; if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};
const parseUA = (ua: string | null | undefined) => {
  if (!ua) return { browser: 'Unknown', os: 'Unknown', mobile: false };
  let browser = 'Unknown', os = 'Unknown';
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

// ── Components ──

function SectionCard({ title, description, icon: Icon, children, badge }: {
  title: string; description?: string; icon: React.ElementType; children: React.ReactNode; badge?: React.ReactNode;
}) {
  return (
    <motion.div variants={itemVariants} className="rounded-xl border border-border/50 bg-card/80 px-5 py-5 backdrop-blur-sm transition-all duration-300 hover:shadow-md hover:border-primary/20">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-100 dark:bg-primary-900/30">
            <Icon className="h-4 w-4 text-primary-600 dark:text-primary-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground ">{title}</h3>
            {description && <p className="text-[11px] text-muted-foreground">{description}</p>}
          </div>
        </div>
        {badge}
      </div>
      {children}
    </motion.div>
  );
}

function DangerZone() {
  const [step, setStep] = useState(0);
  const [confirmText, setConfirmText] = useState('');
  const deleteMutation = useMutation({
    mutationFn: () => profileApi.deleteAccount(),
    onSuccess: () => { notifySuccess('Account deleted'); useAuthStore.getState().logout(); },
    onError: (e: any) => notifyError(e?.response?.data?.error || e?.message || 'Failed'),
  });

  return (
    <motion.div variants={itemVariants} className="rounded-xl border border-destructive/20 bg-destructive/5/30 px-5 py-5 backdrop-blur-sm dark:border-destructive/10 dark:bg-destructive/5">
      <div className="mb-3 flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-destructive/10 dark:bg-destructive/30">
          <AlertTriangle className="h-4 w-4 text-destructive dark:text-destructive" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-destructive dark:text-destructive">Danger Zone</h3>
          <p className="text-[11px] text-destructive/70 dark:text-destructive/60">Irreversible actions</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => { profileApi.exportData().then(() => notifySuccess('Data exported')).catch(() => notifyError('Export failed')); }} className="gap-1.5 text-xs">
          <Download className="h-3.5 w-3.5" /> Export My Data
        </Button>
        {step === 0 ? (
          <Button variant="destructive" size="sm" onClick={() => setStep(1)} className="gap-1.5 text-xs">
            <Trash2 className="h-3.5 w-3.5" /> Delete Account
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder='Type "DELETE"' className="h-8 w-36 text-xs" />
            <Button variant="destructive" size="sm" disabled={confirmText !== 'DELETE' || deleteMutation.isPending} onClick={() => deleteMutation.mutate()} className="text-xs">
              {deleteMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Confirm'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setStep(0); setConfirmText(''); }} className="text-xs">Cancel</Button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Main Page ──
export default function ProfilePage() {
  const queryClient = useQueryClient();
  const { data: profile, isLoading } = useProfile();
  const { data: ssoAccounts } = useProfileSsoAccounts();
  const { data: sessions, isLoading: sessionsLoading } = useSessions();
  const { data: auditData } = useAuditLog(50, 0);
  const { data: apiKeys } = useProfileApiKeys();
  const authUser = useAuthStore((s) => s.user);

  const authProviders = useThemeStore((s) => s.themeSettings?.authProviders);
  const availableProviders = useMemo(() => (['whmcs', 'paymenter'] as const).filter((p) => authProviders?.[p]), [authProviders]);

  // Edit profile
  const [editingProfile, setEditingProfile] = useState(false);
  const [editUsername, setEditUsername] = useState('');
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');

  // Password
  const [showCurPw, setShowCurPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [setPwVal, setSetPwVal] = useState('');
  const [revokeOthers, setRevokeOthers] = useState(false);

  // 2FA
  const [tfaPw, setTfaPw] = useState('');
  const [tfaModalOpen, setTfaModalOpen] = useState(false);
  const [tfaSetup, setTfaSetup] = useState<{ qrCode?: string; secret?: string; otpAuthUrl?: string; backupCodes?: string[] } | null>(null);

  // Passkeys
  const [pkName, setPkName] = useState('');
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [editPkId, setEditPkId] = useState<string | null>(null);
  const [editPkName, setEditPkName] = useState('');

  // Avatar
  const fileRef = useRef<HTMLInputElement>(null);
  const avatarMutation = useMutation({
    mutationFn: (file: File) => profileApi.uploadAvatar(file),
    onSuccess: () => { notifySuccess('Avatar updated'); queryClient.invalidateQueries({ queryKey: ['profile'] }); useAuthStore.getState().refresh().catch(() => {}); },
    onError: (e: any) => notifyError(e?.message || 'Upload failed'),
  });

  const qrValue = tfaSetup?.qrCode || (tfaSetup?.otpAuthUrl ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(tfaSetup.otpAuthUrl)}` : undefined);

  const refreshPasskeys = useCallback(async () => { try { setPasskeys(await profileApi.listPasskeys()); } catch { setPasskeys([]); } }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { refreshPasskeys().catch(() => {}); }, [profile?.id, refreshPasskeys]);

  // ── Mutations ──
  const updateProfileMutation = useMutation({
    mutationFn: () => profileApi.updateProfile({ username: editUsername, firstName: editFirstName, lastName: editLastName }),
    onSuccess: () => { notifySuccess('Profile updated'); setEditingProfile(false); Promise.all([queryClient.invalidateQueries({ queryKey: ['profile'] }), queryClient.invalidateQueries({ queryKey: ['profile-audit-log'] })]); useAuthStore.getState().refresh().catch(() => {}); },
    onError: (e: any) => notifyError(e?.response?.data?.error || e?.message || 'Failed to update'),
  });
  const changePwMutation = useMutation({
    mutationFn: () => profileApi.changePassword({ currentPassword: curPw, newPassword: newPw, revokeOtherSessions: revokeOthers }),
    onSuccess: () => { notifySuccess('Password updated'); setCurPw(''); setNewPw(''); setRevokeOthers(false); Promise.all([queryClient.invalidateQueries({ queryKey: ['profile'] }), queryClient.invalidateQueries({ queryKey: qk.profileSessions() }), queryClient.invalidateQueries({ queryKey: ['profile-audit-log'] })]); },
    onError: (e: any) => notifyError(e?.response?.data?.error || e?.message || 'Failed'),
  });
  const setPwMutation = useMutation({
    mutationFn: () => profileApi.setPassword({ newPassword: setPwVal }),
    onSuccess: () => { notifySuccess('Password set'); setSetPwVal(''); queryClient.invalidateQueries({ queryKey: ['profile'] }); useAuthStore.getState().refresh().catch(() => {}); },
    onError: (e: any) => notifyError(e?.response?.data?.error || e?.message || 'Failed'),
  });
  const enableTfaMutation = useMutation({
    mutationFn: () => profileApi.enableTwoFactor({ password: tfaPw }),
    onSuccess: (data: any) => {
      const p = data?.data ?? data;
      setTfaSetup({ qrCode: p?.qrCode || p?.qr || p?.qrImage, secret: p?.secret, otpAuthUrl: p?.totpURI || p?.otpAuthUrl || p?.otpauthUrl, backupCodes: p?.backupCodes || [] });
      setTfaModalOpen(true); notifySuccess('2FA enabled'); setTfaPw('');
      Promise.all([queryClient.invalidateQueries({ queryKey: ['profile'] }), queryClient.invalidateQueries({ queryKey: ['profile-audit-log'] })]);
    },
    onError: (e: any) => notifyError(e?.response?.data?.error || e?.message || 'Failed'),
  });
  const disableTfaMutation = useMutation({
    mutationFn: () => profileApi.disableTwoFactor({ password: tfaPw }),
    onSuccess: () => { notifySuccess('2FA disabled'); setTfaPw(''); Promise.all([queryClient.invalidateQueries({ queryKey: ['profile'] }), queryClient.invalidateQueries({ queryKey: ['profile-audit-log'] })]); },
    onError: (e: any) => notifyError(e?.response?.data?.error || e?.message || 'Failed'),
  });
  const genCodesMutation = useMutation({
    mutationFn: () => profileApi.generateBackupCodes({ password: tfaPw }),
    onSuccess: (data: any) => { setTfaSetup((p) => ({ ...p, backupCodes: data?.data?.backupCodes || data?.backupCodes || [] })); notifySuccess('Codes generated'); setTfaPw(''); queryClient.invalidateQueries({ queryKey: ['profile-audit-log'] }); },
    onError: (e: any) => notifyError(e?.response?.data?.error || e?.message || 'Failed'),
  });
  const addPkMutation = useMutation({
    mutationFn: () => profileApi.createPasskey({ name: pkName || undefined }),
    onSuccess: async () => { notifySuccess('Passkey added'); setPkName(''); await refreshPasskeys(); queryClient.invalidateQueries({ queryKey: ['profile-audit-log'] }); },
    onError: (e: any) => notifyError(e?.message || 'Failed'),
  });
  const delPkMutation = useMutation({
    mutationFn: (id: string) => profileApi.deletePasskey(id),
    onSuccess: async () => { notifySuccess('Passkey removed'); await refreshPasskeys(); queryClient.invalidateQueries({ queryKey: ['profile-audit-log'] }); },
    onError: (e: any) => notifyError(e?.message || 'Failed'),
  });
  const updPkMutation = useMutation({
    mutationFn: async () => { if (!editPkId) return; return profileApi.updatePasskey(editPkId, editPkName); },
    onSuccess: async () => { notifySuccess('Passkey updated'); setEditPkId(null); setEditPkName(''); await refreshPasskeys(); queryClient.invalidateQueries({ queryKey: ['profile-audit-log'] }); },
    onError: (e: any) => notifyError(e?.message || 'Failed'),
  });
  const revokeSessionMutation = useMutation({
    mutationFn: (id: string) => profileApi.revokeSession(id),
    onSuccess: () => { notifySuccess('Session revoked'); Promise.all([queryClient.invalidateQueries({ queryKey: qk.profileSessions() }), queryClient.invalidateQueries({ queryKey: ['profile-audit-log'] })]); },
    onError: (e: any) => notifyError(e?.message || 'Failed'),
  });
  const revokeAllMutation = useMutation({
    mutationFn: () => profileApi.revokeAllSessions(),
    onSuccess: (data) => { notifySuccess(`Revoked ${data.revoked} session(s)`); Promise.all([queryClient.invalidateQueries({ queryKey: qk.profileSessions() }), queryClient.invalidateQueries({ queryKey: ['profile-audit-log'] })]); },
    onError: (e: any) => notifyError(e?.message || 'Failed'),
  });
  const resendVerifyMutation = useMutation({
    mutationFn: () => profileApi.resendVerification(),
    onSuccess: () => { notifySuccess('Verification email sent'); queryClient.invalidateQueries({ queryKey: ['profile-audit-log'] }); },
    onError: (e: any) => notifyError(e?.message || 'Failed'),
  });
  const removeAvatarMutation = useMutation({
    mutationFn: () => profileApi.removeAvatar(),
    onSuccess: () => { notifySuccess('Avatar removed'); queryClient.invalidateQueries({ queryKey: ['profile'] }); useAuthStore.getState().refresh().catch(() => {}); },
    onError: () => notifyError('Failed to remove avatar'),
  });

  const startEditProfile = () => {
    setEditUsername(profile?.username || '');
    setEditFirstName(profile?.firstName || '');
    setEditLastName(profile?.lastName || '');
    setEditingProfile(true);
  };

  if (isLoading) {
    return <div className="relative space-y-5"><Skeleton className="h-8 w-48" /><Skeleton className="h-32 w-full rounded-xl" /><div className="grid gap-5 lg:grid-cols-2"><Skeleton className="h-48 rounded-xl" /><Skeleton className="h-48 rounded-xl" /></div></div>;
  }

  const t2fa = profile?.twoFactorEnabled ?? false;
  const hasPw = profile?.hasPassword ?? false;
  const initials = (profile?.username?.slice(0, 2) || profile?.email?.slice(0, 2) || 'U').toUpperCase();

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="relative overflow-hidden">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-gradient-to-br from-violet-500/8 to-blue-500/8 blur-3xl dark:from-violet-500/12 dark:to-blue-500/12" />
        <div className="absolute bottom-0 -left-32 h-80 w-80 rounded-full bg-gradient-to-tr from-emerald-500/8 to-cyan-500/8 blur-3xl dark:from-emerald-500/12 dark:to-cyan-500/12" />
      </div>

      <div className="relative z-10 space-y-5">
        {/* Header */}
        <motion.div variants={itemVariants}>
          <div className="flex items-center gap-3">
            <div className="relative"><div className="absolute -inset-1 rounded-lg bg-gradient-to-r from-violet-500 to-blue-500 opacity-20 blur-sm" /><User className="relative h-7 w-7 text-violet-600 dark:text-violet-400" /></div>
            <h1 className="font-display text-3xl font-bold tracking-tight text-foreground ">Profile</h1>
          </div>
          <p className="ml-10 text-sm text-muted-foreground">Manage your account, security, and preferences.</p>
        </motion.div>

        {/* Profile Card */}
        <motion.div variants={itemVariants} className="rounded-xl border border-border/50 bg-card/80 p-6 backdrop-blur-sm transition-all duration-300 hover:shadow-md hover:border-primary/20">
          <div className="flex flex-wrap items-center gap-5">
            {/* Avatar */}
            <div className="relative group">
              {profile?.image ? (
                <img src={profile.image} alt="" className="h-16 w-16 rounded-2xl object-cover border border-border shadow-sm" />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-gradient-to-br from-primary-100 to-primary-50 text-xl font-bold text-primary-700 shadow-sm dark:from-primary-900/40 dark:to-primary-900/20 dark:text-primary-300">{initials}</div>
              )}
              <button onClick={() => fileRef.current?.click()} className="absolute inset-0 flex items-center justify-center rounded-2xl bg-background/60 opacity-0 transition-opacity group-hover:opacity-100">
                <Camera className="h-5 w-5 text-foreground" />
              </button>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) avatarMutation.mutate(f); e.target.value = ''; }} />
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              {editingProfile ? (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Input value={editUsername} onChange={(e) => setEditUsername(e.target.value)} placeholder="Username" className="h-8 text-xs w-36" />
                    <Input value={editFirstName} onChange={(e) => setEditFirstName(e.target.value)} placeholder="First name" className="h-8 text-xs w-32" />
                    <Input value={editLastName} onChange={(e) => setEditLastName(e.target.value)} placeholder="Last name" className="h-8 text-xs w-32" />
                    <Button size="sm" onClick={() => updateProfileMutation.mutate()} disabled={updateProfileMutation.isPending} className="h-8 text-xs">
                      {updateProfileMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingProfile(false)} className="h-8 text-xs"><X className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-bold text-foreground ">{profile?.username || 'User'}</span>
                    {authUser?.permissions?.includes('*') && <Badge className="border-warning/40 bg-warning/5 text-warning text-[10px] dark:border-warning/30 dark:bg-warning/20 dark:text-warning">Super Admin</Badge>}
                    <button onClick={startEditProfile} className="rounded-md p-1 text-muted-foreground hover:bg-surface-2 hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{profile?.email}</span>
                    {!profile?.emailVerified && (
                      <button onClick={() => resendVerifyMutation.mutate()} disabled={resendVerifyMutation.isPending} className="flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning hover:bg-warning/20 dark:bg-warning/30 dark:text-warning dark:hover:bg-warning/50">
                        {resendVerifyMutation.isPending ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <MailCheck className="h-2.5 w-2.5" />}
                        Verify email
                      </button>
                    )}
                    {profile?.emailVerified && <Badge variant="outline" className="border-success/40 text-success text-[10px] dark:border-success/30 dark:text-success"><Check className="mr-0.5 h-2.5 w-2.5" />Verified</Badge>}
                    <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />Joined {fmtDate(profile?.createdAt)}</span>
                  </div>
                </>
              )}
            </div>

            {/* Status badges */}
            <div className="flex flex-col items-end gap-2">
              <div className="flex gap-2">
                <Badge variant={t2fa ? 'outline' : 'secondary'} className={t2fa ? 'border-success/40 text-success dark:border-success/30 dark:text-success' : ''}>
                  {t2fa ? <ShieldCheck className="mr-1 h-3 w-3" /> : <ShieldOff className="mr-1 h-3 w-3" />}2FA
                </Badge>
                <Badge variant={hasPw ? 'outline' : 'secondary'}><Key className="mr-1 h-3 w-3" />Password {hasPw ? 'set' : 'unset'}</Badge>
              </div>
              {profile?.image && (
                <button onClick={() => removeAvatarMutation.mutate()} className="text-[10px] text-muted-foreground hover:text-destructive">Remove avatar</button>
              )}
            </div>
          </div>
        </motion.div>

        {/* Security Overview */}
        <motion.div variants={itemVariants} className="rounded-xl border border-border/50 bg-card/80 p-5 backdrop-blur-sm">
          <div className="mb-3 flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-info/10 dark:bg-blue-900/30"><Info className="h-3.5 w-3.5 text-info dark:text-info" /></div>
            <h3 className="text-sm font-semibold text-foreground ">Security Overview</h3>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'Last login', value: fmtRelative(profile?.lastSuccessfulLogin), detail: fmtDate(profile?.lastSuccessfulLogin) },
              { label: 'Failed attempts', value: profile?.failedLoginAttempts || 0, detail: profile?.lastFailedLogin ? fmtRelative(profile?.lastFailedLogin) : 'None' },
              { label: 'Active sessions', value: sessions?.length ?? 0, detail: '' },
              { label: 'API keys', value: apiKeys?.length ?? 0, detail: '' },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-border/50 bg-surface-2/30 px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</div>
                <div className="mt-0.5 text-lg font-bold tabular-nums text-foreground ">{s.value}</div>
                {s.detail && <div className="text-[10px] text-muted-foreground">{s.detail}</div>}
              </div>
            ))}
          </div>
        </motion.div>

        {/* Two-column grid */}
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-5">
            {/* Password */}
            <SectionCard title="Password" description={hasPw ? 'Update your password' : 'Set a password'} icon={Key}>
              {hasPw ? (
                <div className="space-y-3">
                  <div className="relative">
                    <Input type={showCurPw ? 'text' : 'password'} value={curPw} onChange={(e) => setCurPw(e.target.value)} placeholder="Current password" className="pr-10" />
                    <button onClick={() => setShowCurPw(!showCurPw)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">{showCurPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                  </div>
                  <div className="relative">
                    <Input type={showNewPw ? 'text' : 'password'} value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="New password" className="pr-10" />
                    <button onClick={() => setShowNewPw(!showNewPw)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">{showNewPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                    <input type="checkbox" checked={revokeOthers} onChange={(e) => setRevokeOthers(e.target.checked)} className="rounded border-border text-primary-600" />
                    Sign out all other devices
                  </label>
                  <Button size="sm" onClick={() => changePwMutation.mutate()} disabled={!curPw || !newPw || changePwMutation.isPending} className="w-full">
                    {changePwMutation.isPending ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Updating…</> : 'Update Password'}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <Input type="password" value={setPwVal} onChange={(e) => setSetPwVal(e.target.value)} placeholder="New password" />
                  <Button size="sm" onClick={() => setPwMutation.mutate()} disabled={!setPwVal || setPwMutation.isPending} className="w-full">
                    {setPwMutation.isPending ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Setting…</> : 'Set Password'}
                  </Button>
                </div>
              )}
            </SectionCard>

            {/* 2FA */}
            <SectionCard title="Two-Factor Authentication" description={t2fa ? 'TOTP is enabled' : 'Add an extra layer of security'} icon={Shield} badge={t2fa ? <Badge variant="outline" className="border-success/40 text-success text-[10px]">Enabled</Badge> : null}>
              <div className="space-y-3">
                <Input type="password" value={tfaPw} onChange={(e) => setTfaPw(e.target.value)} placeholder="Confirm password" />
                <div className="flex flex-wrap gap-2">
                  {!t2fa && <Button size="sm" onClick={() => enableTfaMutation.mutate()} disabled={!tfaPw || enableTfaMutation.isPending}>{enableTfaMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <><QrCode className="mr-1.5 h-3.5 w-3.5" />Enable 2FA</>}</Button>}
                  {t2fa && (<>
                    <Button variant="outline" size="sm" onClick={() => genCodesMutation.mutate()} disabled={!tfaPw || genCodesMutation.isPending}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />New Codes</Button>
                    <Button variant="outline" size="sm" onClick={() => disableTfaMutation.mutate()} disabled={!tfaPw || disableTfaMutation.isPending} className="text-destructive hover:text-destructive hover:bg-destructive/5 dark:text-destructive">Disable</Button>
                  </>)}
                </div>
              </div>
            </SectionCard>

            {/* Passkeys */}
            <SectionCard title="Passkeys" description="Hardware-backed sign-in methods" icon={Fingerprint}>
              <div className="space-y-3">
                <div className="flex gap-2">
                  <Input value={pkName} onChange={(e) => setPkName(e.target.value)} placeholder="Name (optional)" className="flex-1 h-8 text-xs" />
                  <Button size="sm" onClick={() => addPkMutation.mutate()} disabled={addPkMutation.isPending}>{addPkMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Plus className="mr-1 h-3 w-3" />Add</>}</Button>
                </div>
                <div className="space-y-2">
                  {passkeys.length === 0 ? <p className="py-3 text-center text-xs text-muted-foreground">No passkeys registered</p> : passkeys.map((pk) => (
                    <div key={pk.id} className="flex items-center justify-between rounded-lg border border-border/50 bg-surface-2/30 px-3 py-2.5 hover:bg-surface-2/60 dark:bg-surface-1/30">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Smartphone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        {editPkId === pk.id ? (
                          <Input value={editPkName} onChange={(e) => setEditPkName(e.target.value)} className="h-7 w-40 text-xs" autoFocus />
                        ) : (
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-foreground truncate">{pk.name || 'Unnamed'}</div>
                            <div className="text-[10px] text-muted-foreground">{pk.deviceType || 'Passkey'} · {fmtDate(pk.createdAt)}</div>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {editPkId === pk.id ? (
                          <button onClick={() => updPkMutation.mutate()} disabled={!editPkName} className="rounded p-1 text-xs font-medium text-primary-600 hover:bg-primary/10 dark:text-primary-400">Save</button>
                        ) : (
                          <button onClick={() => { setEditPkId(pk.id); setEditPkName(pk.name || ''); }} className="rounded p-1 text-xs text-muted-foreground hover:text-foreground">Rename</button>
                        )}
                        <button onClick={() => delPkMutation.mutate(pk.id)} className="rounded p-1 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/5 dark:hover:text-destructive"><Trash2 className="h-3 w-3" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </SectionCard>

            {/* SSO */}
            {availableProviders.length > 0 && (
              <SectionCard title="Linked Accounts" description="Billing and panel providers" icon={Globe}>
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {availableProviders.map((p) => (
                      <Button key={p} variant="outline" size="sm" onClick={() => profileApi.linkSso(p).then(() => { queryClient.invalidateQueries({ queryKey: ['profile-sso-accounts'] }); queryClient.invalidateQueries({ queryKey: ['profile'] }); })} className="text-xs"><ExternalLink className="mr-1.5 h-3 w-3" />Link {p.toUpperCase()}</Button>
                    ))}
                  </div>
                  {(ssoAccounts ?? []).filter((a) => a.providerId !== 'credential').length === 0 ? <p className="py-2 text-center text-xs text-muted-foreground">No linked accounts</p> : (ssoAccounts ?? []).filter((a) => a.providerId !== 'credential').map((a) => (
                    <div key={a.id} className="flex items-center justify-between rounded-lg border border-border/50 bg-surface-2/30 px-3 py-2.5 dark:bg-surface-1/30">
                      <span className="text-xs font-medium text-foreground">{a.providerId.toUpperCase()}</span>
                      <button onClick={() => profileApi.unlinkSso(a.providerId, a.accountId).then(() => queryClient.invalidateQueries({ queryKey: ['profile-sso-accounts'] }))} className="text-xs text-destructive hover:text-destructive">Unlink</button>
                    </div>
                  ))}
                </div>
              </SectionCard>
            )}
          </div>

          {/* Right column */}
          <div className="space-y-5">
            {/* Sessions */}
            <SectionCard title="Active Sessions" description="Devices signed into your account" icon={Monitor} badge={<Badge variant="outline" className="text-[10px]">{sessions?.length ?? 0}</Badge>}>
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {sessionsLoading ? [1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />) : !sessions?.length ? <p className="py-3 text-center text-xs text-muted-foreground">No active sessions</p> : sessions.map((s) => {
                  const { browser, os, mobile } = parseUA(s.userAgent);
                  return (
                    <div key={s.id} className="flex items-center justify-between rounded-lg border border-border/50 bg-surface-2/30 px-3 py-2 hover:bg-surface-2/60 dark:bg-surface-1/30">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Monitor className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-xs font-medium text-foreground truncate">{browser} on {os}{mobile && <Badge variant="secondary" className="text-[9px] px-1 py-0">{mobile}</Badge>}</div>
                          <div className="text-[10px] text-muted-foreground">{s.ipAddress || 'Unknown IP'} · {fmtRelative(s.updatedAt)}</div>
                        </div>
                      </div>
                      <button onClick={() => revokeSessionMutation.mutate(s.id)} className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-destructive/5 hover:text-destructive dark:hover:bg-destructive/20 dark:hover:text-destructive" title="Revoke"><LogOut className="h-3.5 w-3.5" /></button>
                    </div>
                  );
                })}
              </div>
              {(sessions?.length ?? 0) > 1 && (
                <Button variant="outline" size="sm" onClick={() => revokeAllMutation.mutate()} disabled={revokeAllMutation.isPending} className="w-full mt-2 text-xs gap-1.5">
                  {revokeAllMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><LogOut className="h-3.5 w-3.5" />Sign Out All Other Devices</>}
                </Button>
              )}
            </SectionCard>

            {/* API Keys */}
            <SectionCard title="API Keys" description="Keys you've created" icon={KeyRound} badge={apiKeys && apiKeys.length > 0 ? <Badge variant="outline" className="text-[10px]">{apiKeys.length}</Badge> : null}>
              {apiKeys && apiKeys.length > 0 ? (
                <div className="space-y-2">
                  {apiKeys.slice(0, 5).map((k) => (
                    <Link to="/admin/api-keys" key={k.id} className="flex items-center justify-between rounded-lg border border-border/50 bg-surface-2/30 px-3 py-2.5 hover:bg-surface-2/60 dark:bg-surface-1/30">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                          {k.name || 'Unnamed'}{!k.enabled && <Badge variant="secondary" className="text-[9px] px-1 py-0">Disabled</Badge>}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {k.allPermissions ? 'All permissions' : `${k.permissions.length} permission${k.permissions.length !== 1 ? 's' : ''}`} · {k.requestCount} requests
                        </div>
                      </div>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    </Link>
                  ))}
                  {apiKeys.length > 5 && (
                    <Link to="/admin/api-keys" className="block text-center text-xs text-primary-600 hover:text-primary py-1 dark:text-primary-400">View all {apiKeys.length} keys →</Link>
                  )}
                </div>
              ) : (
                <p className="py-3 text-center text-xs text-muted-foreground">No API keys created</p>
              )}
              <Link to="/admin/api-keys"><Button variant="outline" size="sm" className="w-full mt-2 text-xs gap-1.5"><KeyRound className="h-3.5 w-3.5" />Manage API Keys</Button></Link>
            </SectionCard>

            {/* Activity Log */}
            <SectionCard title="Recent Activity" description="Your account actions" icon={History}>
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {(!auditData?.logs || auditData.logs.length === 0) ? (
                  <p className="py-3 text-center text-xs text-muted-foreground">No activity recorded</p>
                ) : auditData.logs.map((entry) => (
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
                ))}
              </div>
            </SectionCard>
          </div>
        </div>

        {/* Danger Zone */}
        <DangerZone />
      </div>

      {/* 2FA QR Modal */}
      {tfaModalOpen && (
        <ModalPortal>
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 30 }} className="mx-4 w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
              <div className="mb-4 flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-success/10 dark:bg-success/30"><ShieldCheck className="h-4 w-4 text-success dark:text-success" /></div>
                <div><h3 className="text-sm font-semibold text-foreground ">Set Up Authenticator</h3><p className="text-[11px] text-muted-foreground">Scan the QR code</p></div>
              </div>
              {qrValue && <div className="mb-4 flex justify-center"><img src={qrValue} alt="QR" className="rounded-lg border border-border bg-card p-3 dark:bg-surface-1" /></div>}
              {tfaSetup?.otpAuthUrl && <a href={tfaSetup.otpAuthUrl} target="_blank" rel="noopener noreferrer" className="mb-3 flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary"><ExternalLink className="h-3 w-3" /> Open in app</a>}
              {tfaSetup?.secret && (
                <div className="mb-4 rounded-lg border border-border/50 bg-surface-2/50 p-3 text-center">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Manual Key</div>
                  <code className="mt-1 block text-sm font-mono font-semibold text-foreground select-all">{tfaSetup.secret}</code>
                  <button onClick={() => { navigator.clipboard.writeText(tfaSetup.secret); notifySuccess('Copied'); }} className="mt-2 flex items-center gap-1 mx-auto text-[10px] text-muted-foreground hover:text-foreground"><Copy className="h-3 w-3" /> Copy</button>
                </div>
              )}
              {(tfaSetup?.backupCodes?.length ?? 0) > 0 && (
                <div className="mb-4 rounded-lg border border-warning/30/40 bg-warning/5 p-4 dark:border-warning/20 dark:bg-warning/15">
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-warning dark:text-warning"><AlertTriangle className="h-3.5 w-3.5" /> Backup Codes — Save These Now</div>
                  <div className="grid grid-cols-2 gap-1.5">{tfaSetup!.backupCodes!.map((code) => <code key={code} className="rounded bg-card px-2 py-1 text-center text-[11px] font-mono dark:bg-surface-2">{code}</code>)}</div>
                </div>
              )}
              <Button size="sm" onClick={() => { setTfaModalOpen(false); setTfaSetup(null); }} className="w-full">Done</Button>
            </motion.div>
          </div>
        </ModalPortal>
      )}
    </motion.div>
  );
}
