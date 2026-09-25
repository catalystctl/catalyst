import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import {
 Settings,
 Mail,
 ShieldCheck,
 Lock,
 Key,
 Globe,
 Hash,
 User,
 ArrowUpCircle,
 Languages,
} from 'lucide-react';
import TabHeader from '../../components/servers/tabs/TabHeader';
import { BracketLabel } from '../../components/deck/primitives';

import { useAdminHealth, useAdminStats, useLocalizationSettings, useModManagerSettings, useSmtpSettings } from '../../hooks/useAdmin';
import UpdateSettings from '../../components/admin/UpdateSettings';
import { adminApi } from '../../services/api/admin';
import { notifyError, notifySuccess } from '../../utils/notify';
import { Input } from '../../components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { DEFAULT_LOCALE, isSupportedLocale, SUPPORTED_LOCALES, type SupportedLocale } from '../../i18n/config';


// ── Section Wrapper ──
function Section({
 title,
 subtitle,
 icon,
 children,
 footer,
}: {
 title: string;
 subtitle?: string;
 icon: React.ReactNode;
 children: React.ReactNode;
 footer?: React.ReactNode;
}) {
 return (
 <div className="deck-panel">
 <div className="border-b border-border/50 bg-surface-1/40 px-3 py-1.5">
 <div className="flex items-center gap-2">
 <span className="text-muted-foreground">{icon}</span>
 <BracketLabel>{title}</BracketLabel>
 </div>
 {subtitle && <p className="mt-0.5 text-micro text-muted-foreground">{subtitle}</p>}
 </div>
 <div className="p-3">{children}</div>
 {footer && (
 <div className="flex items-center justify-end border-t border-border/50 bg-surface-1/40 px-3 py-1.5">
 {footer}
 </div>
 )}
 </div>
 );
}

// ── Main Page ──
function SystemPage() {
 const { t } = useTranslation('admin-system');
 const { data: stats } = useAdminStats();
 const { data: health } = useAdminHealth();
 const { data: smtpSettings } = useSmtpSettings();
 const { data: modManagerSettings } = useModManagerSettings();
 const { data: localizationSettings } = useLocalizationSettings();

 const [smtpHost, setSmtpHost] = useState('');
 const [smtpPort, setSmtpPort] = useState('587');
 const [smtpUsername, setSmtpUsername] = useState('');
 const [smtpPassword, setSmtpPassword] = useState('');
 const [smtpFrom, setSmtpFrom] = useState('');
 const [smtpReplyTo, setSmtpReplyTo] = useState('');
 const [smtpSecure, setSmtpSecure] = useState(false);
 const [smtpRequireTls, setSmtpRequireTls] = useState(false);
 const [smtpPool, setSmtpPool] = useState(false);
 const [smtpMaxConnections, setSmtpMaxConnections] = useState('');
 const [smtpMaxMessages, setSmtpMaxMessages] = useState('');
 const [curseforgeApiKey, setCurseforgeApiKey] = useState('');
 const [modrinthApiKey, setModrinthApiKey] = useState('');
  const [defaultLocale, setDefaultLocale] = useState<SupportedLocale>(DEFAULT_LOCALE);

 const updateSmtpMutation = useMutation({
 mutationFn: () =>
 adminApi.updateSmtpSettings({
 host: smtpHost.trim() || null,
 port: smtpPort.trim() ? Number(smtpPort) : null,
 username: smtpUsername.trim() || null,
 password: smtpPassword || null,
 from: smtpFrom.trim() || null,
 replyTo: smtpReplyTo.trim() || null,
 secure: smtpSecure,
 requireTls: smtpRequireTls,
 pool: smtpPool,
 maxConnections: smtpMaxConnections.trim() ? Number(smtpMaxConnections) : null,
 maxMessages: smtpMaxMessages.trim() ? Number(smtpMaxMessages) : null,
 }),
 onSuccess: () => notifySuccess(t('system.toastSmtpUpdated')),
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminSmtp() });
 },
 onError: (error: any) => notifyError(error),
 });

 const updateModManagerMutation = useMutation({
 mutationFn: () =>
 adminApi.updateModManagerSettings({
 curseforgeApiKey: curseforgeApiKey.trim() || null,
 modrinthApiKey: modrinthApiKey.trim() || null,
 }),
 onSuccess: () => notifySuccess(t('system.toastModManagerUpdated')),
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminModManager() });
 },
 onError: (error: any) => notifyError(error),
 });

 const updateLocalizationMutation = useMutation({
 mutationFn: () => adminApi.updateLocalizationSettings({ defaultLocale }),
 onSuccess: () => notifySuccess(t('system.toastLanguageUpdated')),
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminLocalizationSettings() });
 },
 onError: (error: any) => notifyError(error),
 });

 const [prevSmtpSettings, setPrevSmtpSettings] = useState(smtpSettings);
 if (smtpSettings !== prevSmtpSettings) {
 setPrevSmtpSettings(smtpSettings);
 if (smtpSettings) {
 setSmtpHost(smtpSettings.host ?? '');
 setSmtpPort(smtpSettings.port ? String(smtpSettings.port) : '587');
 setSmtpUsername(smtpSettings.username ?? '');
 setSmtpPassword(smtpSettings.password ?? '');
 setSmtpFrom(smtpSettings.from ?? '');
 setSmtpReplyTo(smtpSettings.replyTo ?? '');
 setSmtpSecure(Boolean(smtpSettings.secure));
 setSmtpRequireTls(Boolean(smtpSettings.requireTls));
 setSmtpPool(Boolean(smtpSettings.pool));
 setSmtpMaxConnections(
 smtpSettings.maxConnections !== null && smtpSettings.maxConnections !== undefined
 ? String(smtpSettings.maxConnections) : '',
 );
 setSmtpMaxMessages(
 smtpSettings.maxMessages !== null && smtpSettings.maxMessages !== undefined
 ? String(smtpSettings.maxMessages) : '',
 );
 }
 }

 const [prevModManagerSettings, setPrevModManagerSettings] = useState(modManagerSettings);
 if (modManagerSettings !== prevModManagerSettings) {
 setPrevModManagerSettings(modManagerSettings);
 if (modManagerSettings) {
 setCurseforgeApiKey(modManagerSettings.curseforgeApiKey ?? '');
 setModrinthApiKey(modManagerSettings.modrinthApiKey ?? '');
 }
 }

 const [prevLocalizationSettings, setPrevLocalizationSettings] = useState(localizationSettings);
 if (localizationSettings !== prevLocalizationSettings) {
 setPrevLocalizationSettings(localizationSettings);
 // null means the instance was never configured; show what it renders today.
 if (localizationSettings) {
 setDefaultLocale(
 isSupportedLocale(localizationSettings.defaultLocale)
 ? localizationSettings.defaultLocale
 : DEFAULT_LOCALE,
 );
 }
 }

  return (
    <div className="space-y-5">
      <TabHeader
        icon={Settings}
        title={t('system.title')}
 description={t('system.description', {
 status: health?.status ?? t('system.loadingStatus'),
 online: health?.nodes.online ?? 0,
 total: health?.nodes.total ?? 0,
 servers: stats?.servers ?? 0,
 })}
      />


 {/* ── SMTP Configuration ── */}
 <Section
 title={t('system.smtp')}
 subtitle={t('system.smtpDescription')}
 icon={<Mail className="h-3.5 w-3.5 text-destructive" />}
 footer={
 <Button size="sm" className="h-8 px-3 text-mini" disabled={updateSmtpMutation.isPending} onClick={() => updateSmtpMutation.mutate()}>
 {updateSmtpMutation.isPending ? t('saving') : t('system.saveSmtp')}
 </Button>
 }
 >
 <div className="space-y-4">
 <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
 <label className="block space-y-1">
 <span className="type-overline flex items-center gap-1">
 <Globe className="h-3 w-3" /> {t('system.host')}
 </span>
 <Input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.mailserver.com" className="h-8 rounded-sm border-border/40 text-mini" />
 </label>
 <label className="block space-y-1">
 <span className="type-overline flex items-center gap-1">
 <Hash className="h-3 w-3" /> {t('system.port')}
 </span>
 <Input value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} placeholder="587" className="h-8 rounded-sm border-border/40 text-mini" />
 </label>
 <label className="block space-y-1">
 <span className="type-overline flex items-center gap-1">
 <User className="h-3 w-3" /> {t('system.username')}
 </span>
 <Input value={smtpUsername} onChange={(e) => setSmtpUsername(e.target.value)} placeholder="user@example.com" className="h-8 rounded-sm border-border/40 text-mini" />
 </label>
 <label className="block space-y-1">
 <span className="type-overline flex items-center gap-1">
 <Lock className="h-3 w-3" /> {t('system.password')}
 </span>
 <Input type="password" autoComplete="off" value={smtpPassword} onChange={(e) => setSmtpPassword(e.target.value)} placeholder="••••••••" className="h-8 rounded-sm border-border/40 text-mini" />
 </label>
 <label className="block space-y-1">
 <span className="type-overline flex items-center gap-1">
 <Mail className="h-3 w-3" /> {t('system.fromAddress')}
 </span>
 <Input value={smtpFrom} onChange={(e) => setSmtpFrom(e.target.value)} placeholder="no-reply@catalyst.local" className="h-8 rounded-sm border-border/40 text-mini" />
 </label>
 <label className="block space-y-1">
 <span className="type-overline flex items-center gap-1">
 <Mail className="h-3 w-3" /> {t('system.replyTo')}
 </span>
 <Input value={smtpReplyTo} onChange={(e) => setSmtpReplyTo(e.target.value)} placeholder="support@catalyst.local" className="h-8 rounded-sm border-border/40 text-mini" />
 </label>
 </div>

 {/* Pool settings */}
 <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
 <label className="block space-y-1">
 <span className="type-overline">{t('system.maxConnections')}</span>
 <Input value={smtpMaxConnections} onChange={(e) => setSmtpMaxConnections(e.target.value)} placeholder="5" className="h-8 rounded-sm border-border/40 text-mini" />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('system.maxMessages')}</span>
 <Input value={smtpMaxMessages} onChange={(e) => setSmtpMaxMessages(e.target.value)} placeholder="100" className="h-8 rounded-sm border-border/40 text-mini" />
 </label>
 </div>

 {/* Checkboxes */}
 <div className="flex flex-wrap gap-4">
 <label className="flex cursor-pointer items-center gap-2 text-mini text-muted-foreground">
 <input
 type="checkbox"
 checked={smtpSecure}
 onChange={(e) => setSmtpSecure(e.target.checked)}
 className="h-4 w-4 rounded-sm border-border/40 bg-card text-primary"
 />
 {t('system.useSslTls')}
 </label>
 <label className="flex cursor-pointer items-center gap-2 text-mini text-muted-foreground">
 <input
 type="checkbox"
 checked={smtpRequireTls}
 onChange={(e) => setSmtpRequireTls(e.target.checked)}
 className="h-4 w-4 rounded-sm border-border/40 bg-card text-primary"
 />
 {t('system.requireStarttls')}
 </label>
 <label className="flex cursor-pointer items-center gap-2 text-mini text-muted-foreground">
 <input
 type="checkbox"
 checked={smtpPool}
 onChange={(e) => setSmtpPool(e.target.checked)}
 className="h-4 w-4 rounded-sm border-border/40 bg-card text-primary"
 />
 {t('system.useConnectionPool')}
 </label>
 </div>
 </div>
 </Section>

 {/* ── Mod Manager API Keys ── */}
 <Section
 title={t('system.modManagerKeys')}
 subtitle={t('system.modManagerKeysDescription')}
 icon={<Key className="h-3.5 w-3.5 text-warning" />}
 footer={
 <Button size="sm" className="h-8 px-3 text-mini" disabled={updateModManagerMutation.isPending} onClick={() => updateModManagerMutation.mutate()}>
 {updateModManagerMutation.isPending ? t('saving') : t('system.saveModManagerKeys')}
 </Button>
 }
 >
 <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
 <label className="block space-y-1">
 <span className="type-overline flex items-center gap-1">
 <ShieldCheck className="h-3 w-3" /> {t('system.curseforgeApiKey')}
 </span>
 <Input type="password" autoComplete="off" value={curseforgeApiKey} onChange={(e) => setCurseforgeApiKey(e.target.value)} placeholder="••••••••" className="h-8 rounded-sm border-border/40 text-mini" />
 </label>
 <label className="block space-y-1">
 <span className="type-overline flex items-center gap-1">
 <ShieldCheck className="h-3 w-3" /> {t('system.modrinthApiKey')}
 </span>
 <Input type="password" autoComplete="off" value={modrinthApiKey} onChange={(e) => setModrinthApiKey(e.target.value)} placeholder="••••••••" className="h-8 rounded-sm border-border/40 text-mini" />
 </label>
 </div>
 </Section>

 {/* ── Interface Language ── */}
 <Section
 title={t('system.language')}
 subtitle={t('system.languageDescription')}
 icon={<Languages className="h-3.5 w-3.5 text-primary" />}
 footer={
 <Button size="sm" className="h-8 px-3 text-mini" disabled={updateLocalizationMutation.isPending} onClick={() => updateLocalizationMutation.mutate()}>
 {updateLocalizationMutation.isPending ? t('saving') : t('system.saveLanguage')}
 </Button>
 }
 >
 <div className="space-y-3">
 <label className="block space-y-1">
 <span className="type-overline flex items-center gap-1">
 <Languages className="h-3 w-3" /> {t('system.defaultLanguage')}
 </span>
 <Select value={defaultLocale} onValueChange={(next) => setDefaultLocale(next as SupportedLocale)}>
 <SelectTrigger className="h-8 rounded-sm border-border/40 text-mini">
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 {SUPPORTED_LOCALES.map((option) => (
 <SelectItem key={option.code} value={option.code}>
 {option.nativeName}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </label>
 <p className="text-mini text-muted-foreground">{t('system.languageHint')}</p>
 </div>
 </Section>

 {/* ── Auto Updater ── */}
 <Section
 title={t('system.autoUpdater')}
 subtitle={t('system.autoUpdaterDescription')}
 icon={<ArrowUpCircle className="h-3.5 w-3.5 text-success" />}
 >
 <UpdateSettings />
 </Section>
 </div>
 );
}

export default SystemPage;
