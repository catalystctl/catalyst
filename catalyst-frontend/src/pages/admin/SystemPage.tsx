import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import {
 Settings,
 Activity,
 Server,
 Mail,
 ShieldCheck,
 Lock,
 Key,
 Globe,
 Hash,
 User,
 CheckCircle,
 AlertTriangle,
 ArrowUpCircle,
} from 'lucide-react';
import TabHeader from '../../components/servers/tabs/TabHeader';
import StatGrid from '../../components/servers/tabs/StatGrid';
import ServerTabCard from '../../components/servers/tabs/ServerTabCard';

import { useAdminHealth, useAdminStats, useDnsSettings, useModManagerSettings, useSmtpSettings } from '../../hooks/useAdmin';
import UpdateSettings from '../../components/admin/UpdateSettings';
import { adminApi } from '../../services/api/admin';
import { notifyError, notifySuccess } from '../../utils/notify';
import { Input } from '../../components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

// ── Section Wrapper ──
function Section({
 title,
 subtitle,
 icon,
 iconColor,
 children,
 footer,
}: {
 title: string;
 subtitle?: string;
 icon: React.ReactNode;
 iconColor?: string;
 children: React.ReactNode;
 footer?: React.ReactNode;
}) {
 return (
 <ServerTabCard>
 <div className="border-b border-border/30 px-5 py-4">
 <div className="flex items-center gap-2.5">
 <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconColor || 'bg-primary/10'}`}>
 {icon}
 </div>
 <div>
 <h2 className="text-sm font-semibold text-foreground">{title}</h2>
 {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
 </div>
 </div>
 </div>
 <div className="px-5 py-4">{children}</div>
 {footer && (
 <div className="flex items-center justify-end border-t border-border/30 px-5 py-3">
 {footer}
 </div>
 )}
 </ServerTabCard>
 );
}

// ── Main Page ──
function SystemPage() {
 const { data: stats } = useAdminStats();
 const { data: health } = useAdminHealth();
 const { data: smtpSettings } = useSmtpSettings();
 const { data: modManagerSettings } = useModManagerSettings();
 const { data: dnsSettings } = useDnsSettings();

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
 const [dnsEnabled, setDnsEnabled] = useState(false);
 const [dnsProvider, setDnsProvider] = useState('cloudflare');
 const [dnsBaseDomain, setDnsBaseDomain] = useState('');
 const [dnsCloudflareApiToken, setDnsCloudflareApiToken] = useState('');
 const [dnsCloudflareZoneId, setDnsCloudflareZoneId] = useState('');

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
 onSuccess: () => notifySuccess('SMTP settings updated'),
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminSmtp() });
 },
 onError: (error: any) => notifyError(error?.response?.data?.error || 'Failed to update SMTP settings'),
 });

 const updateDnsMutation = useMutation({
 mutationFn: () =>
 adminApi.updateDnsSettings({
 enabled: dnsEnabled,
 provider: dnsProvider.trim() || null,
 baseDomain: dnsBaseDomain.trim() || null,
 cloudflareApiToken: dnsCloudflareApiToken.trim() || null,
 cloudflareZoneId: dnsCloudflareZoneId.trim() || null,
 }),
 onSuccess: () => notifySuccess('DNS settings updated'),
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminDnsSettings() });
 },
 onError: (error: any) => notifyError(error?.response?.data?.error || 'Failed to update DNS settings'),
 });

 const updateModManagerMutation = useMutation({
 mutationFn: () =>
 adminApi.updateModManagerSettings({
 curseforgeApiKey: curseforgeApiKey.trim() || null,
 modrinthApiKey: modrinthApiKey.trim() || null,
 }),
 onSuccess: () => notifySuccess('Mod manager settings updated'),
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminModManager() });
 },
 onError: (error: any) => notifyError(error?.response?.data?.error || 'Failed to update mod manager settings'),
 });

 useEffect(() => {
 if (!smtpSettings) return;
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
 }, [smtpSettings]);

 useEffect(() => {
 if (!modManagerSettings) return;
 setCurseforgeApiKey(modManagerSettings.curseforgeApiKey ?? '');
 setModrinthApiKey(modManagerSettings.modrinthApiKey ?? '');
 }, [modManagerSettings]);

 useEffect(() => {
 if (!dnsSettings) return;
 setDnsEnabled(Boolean(dnsSettings.enabled));
 setDnsProvider(dnsSettings.provider ?? 'cloudflare');
 setDnsBaseDomain(dnsSettings.baseDomain ?? '');
 setDnsCloudflareApiToken(dnsSettings.cloudflareApiToken ?? '');
 setDnsCloudflareZoneId(dnsSettings.cloudflareZoneId ?? '');
 }, [dnsSettings]);

 const healthItems = [
 {
 label: 'Status',
 value: health?.status ?? 'loading',
 },
 {
 label: 'Nodes',
 value: `${health?.nodes.online ?? 0} / ${health?.nodes.total ?? 0}`,
 },
 {
 label: 'System totals',
 value: stats?.servers ?? 0,
 },
 ];

 return (
 <div className="space-y-5">
 <TabHeader
 icon={Settings}
 title="System"
 description="Monitor platform health and manage global integrations."
 actions={
 <div className="flex items-center gap-2">
 <Badge variant="outline" className="text-xs">
 {stats?.users ?? 0} users
 </Badge>
 <Badge variant="outline" className="text-xs">
 {stats?.activeServers ?? 0} active
 </Badge>
 </div>
 }
 variant="default"
 />

 {/* ── Health Stats ── */}
 <StatGrid items={healthItems} columns={3} />

 {/* ── SMTP Configuration ── */}
 <Section
 title="SMTP Configuration"
 subtitle="Configure outbound email for invites, alerts, and notifications."
 icon={<Mail className="h-4 w-4 text-destructive" />}
 iconColor="bg-destructive/10"
 footer={
 <Button size="sm" disabled={updateSmtpMutation.isPending} onClick={() => updateSmtpMutation.mutate()}>
 {updateSmtpMutation.isPending ? 'Saving…' : 'Save SMTP settings'}
 </Button>
 }
 >
 <div className="space-y-4">
 <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
 <label className="block space-y-1">
 <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
 <Globe className="h-3 w-3" /> Host
 </span>
 <Input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.mailserver.com" className="border-border/40" />
 </label>
 <label className="block space-y-1">
 <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
 <Hash className="h-3 w-3" /> Port
 </span>
 <Input value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} placeholder="587" className="border-border/40" />
 </label>
 <label className="block space-y-1">
 <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
 <User className="h-3 w-3" /> Username
 </span>
 <Input value={smtpUsername} onChange={(e) => setSmtpUsername(e.target.value)} placeholder="user@example.com" className="border-border/40" />
 </label>
 <label className="block space-y-1">
 <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
 <Lock className="h-3 w-3" /> Password
 </span>
 <Input type="password" value={smtpPassword} onChange={(e) => setSmtpPassword(e.target.value)} placeholder="••••••••" className="border-border/40" />
 </label>
 <label className="block space-y-1">
 <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
 <Mail className="h-3 w-3" /> From address
 </span>
 <Input value={smtpFrom} onChange={(e) => setSmtpFrom(e.target.value)} placeholder="no-reply@catalyst.local" className="border-border/40" />
 </label>
 <label className="block space-y-1">
 <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
 <Mail className="h-3 w-3" /> Reply-to
 </span>
 <Input value={smtpReplyTo} onChange={(e) => setSmtpReplyTo(e.target.value)} placeholder="support@catalyst.local" className="border-border/40" />
 </label>
 </div>

 {/* Pool settings */}
 <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
 <label className="block space-y-1">
 <span className="text-xs font-medium text-muted-foreground">Max connections</span>
 <Input value={smtpMaxConnections} onChange={(e) => setSmtpMaxConnections(e.target.value)} placeholder="5" className="border-border/40" />
 </label>
 <label className="block space-y-1">
 <span className="text-xs font-medium text-muted-foreground">Max messages</span>
 <Input value={smtpMaxMessages} onChange={(e) => setSmtpMaxMessages(e.target.value)} placeholder="100" className="border-border/40" />
 </label>
 </div>

 {/* Checkboxes */}
 <div className="flex flex-wrap gap-4">
 <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
 <input
 type="checkbox"
 checked={smtpSecure}
 onChange={(e) => setSmtpSecure(e.target.checked)}
 className="h-4 w-4 rounded border-border/40 bg-card text-primary"
 />
 Use SSL/TLS
 </label>
 <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
 <input
 type="checkbox"
 checked={smtpRequireTls}
 onChange={(e) => setSmtpRequireTls(e.target.checked)}
 className="h-4 w-4 rounded border-border/40 bg-card text-primary"
 />
 Require STARTTLS
 </label>
 <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
 <input
 type="checkbox"
 checked={smtpPool}
 onChange={(e) => setSmtpPool(e.target.checked)}
 className="h-4 w-4 rounded border-border/40 bg-card text-primary"
 />
 Use connection pool
 </label>
 </div>
 </div>
 </Section>

 {/* ── Mod Manager API Keys ── */}
 <Section
 title="Mod Manager API Keys"
 subtitle="Provide API keys for CurseForge and Modrinth to enable mod downloads."
 icon={<Key className="h-4 w-4 text-warning" />}
 iconColor="bg-warning/10"
 footer={
 <Button size="sm" disabled={updateModManagerMutation.isPending} onClick={() => updateModManagerMutation.mutate()}>
 {updateModManagerMutation.isPending ? 'Saving…' : 'Save mod manager keys'}
 </Button>
 }
 >
 <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
 <label className="block space-y-1">
 <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
 <ShieldCheck className="h-3 w-3" /> CurseForge API Key
 </span>
 <Input type="password" value={curseforgeApiKey} onChange={(e) => setCurseforgeApiKey(e.target.value)} placeholder="••••••••" className="border-border/40" />
 </label>
 <label className="block space-y-1">
 <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
 <ShieldCheck className="h-3 w-3" /> Modrinth API Key
 </span>
 <Input type="password" value={modrinthApiKey} onChange={(e) => setModrinthApiKey(e.target.value)} placeholder="••••••••" className="border-border/40" />
 </label>
 </div>
 </Section>

 {/* ── DNS Configuration ── */}
 <Section
 title="DNS Configuration"
 subtitle="Configure DNS provider integration for automatic subdomain management."
 icon={<Globe className="h-4 w-4 text-info" />}
 iconColor="bg-info/10"
 footer={
 <Button size="sm" disabled={updateDnsMutation.isPending} onClick={() => updateDnsMutation.mutate()}>
 {updateDnsMutation.isPending ? 'Saving…' : 'Save DNS settings'}
 </Button>
 }
 >
 <div className="space-y-4">
 <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
 <input
 type="checkbox"
 checked={dnsEnabled}
 onChange={(e) => setDnsEnabled(e.target.checked)}
 className="h-4 w-4 rounded border-border/40 bg-card text-primary"
 />
 Enable DNS integration
 </label>
 <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
 <label className="block space-y-1">
 <span className="text-xs font-medium text-muted-foreground">Provider</span>
 <select
 value={dnsProvider}
 onChange={(e) => setDnsProvider(e.target.value)}
 className="w-full rounded-md border border-border/40 bg-card px-3 py-2 text-sm text-foreground"
 >
 <option value="cloudflare">Cloudflare</option>
 </select>
 </label>
 <label className="block space-y-1">
 <span className="text-xs font-medium text-muted-foreground">Base domain</span>
 <Input value={dnsBaseDomain} onChange={(e) => setDnsBaseDomain(e.target.value)} placeholder="servers.example.com" className="border-border/40" />
 </label>
 <label className="block space-y-1">
 <span className="text-xs font-medium text-muted-foreground">Cloudflare API token</span>
 <Input type="password" value={dnsCloudflareApiToken} onChange={(e) => setDnsCloudflareApiToken(e.target.value)} placeholder="••••••••" className="border-border/40" />
 </label>
 <label className="block space-y-1">
 <span className="text-xs font-medium text-muted-foreground">Cloudflare Zone ID</span>
 <Input value={dnsCloudflareZoneId} onChange={(e) => setDnsCloudflareZoneId(e.target.value)} placeholder="zone-id" className="border-border/40" />
 </label>
 </div>
 </div>
 </Section>

 {/* ── Auto Updater ── */}
 <Section
 title="Auto Updater"
 subtitle="Check for new releases and trigger automatic updates."
 icon={<ArrowUpCircle className="h-4 w-4 text-emerald-600" />}
 iconColor="bg-emerald-100"
 >
 <UpdateSettings />
 </Section>
 </div>
 );
}

export default SystemPage;
