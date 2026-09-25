import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/i18n/format';
import { useMutation, useQuery } from '@/csync';
import { MapPin, ArrowRight, CheckCircle, Loader2, Copy, ChevronDown, ChevronRight } from 'lucide-react';
import { nodesApi } from '../../services/api/nodes';
import { locationsApi } from '../../services/api/locations';

import { qk } from '../../lib/queryKeys';
import { queryClient } from '../../lib/queryClient';
import { buildDeployCommand } from '../../lib/deploy-command';
import { notifyError, notifySuccess } from '../../utils/notify';
import { cn } from '@/lib/utils';
import {
 Select,
 SelectContent,
 SelectItem,
 SelectTrigger,
 SelectValue,
} from '../../components/ui/select';
import { Button } from '@/components/ui/button';
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

// no props needed, but the type is kept for consistency
type Props = Record<string, never>;

/**
 * Event types used for inter-modal navigation.
 * NodeCreateModal listens for `catalyst:return-to-node-create` so the
 * LocationsManagerModal can re-open this modal after creating a location.
 */
const RETURN_EVENT = 'catalyst:return-to-node-create' as const;
const OPEN_LOCATIONS_EVENT = 'catalyst:open-locations-modal' as const;

function NodeCreateModal(_props: Props) {
 const { t } = useTranslation('nodes');
 const [open, setOpen] = useState(false);
 const [step, setStep] = useState<1 | 2 | 3>(1);
 const [locationId, setLocationId] = useState('');
 const [name, setName] = useState('');
 const [description, setDescription] = useState('');
 const [hostname, setHostname] = useState('');
 const [publicAddress, setPublicAddress] = useState('');
 const [memory, setMemory] = useState('16384');
 const [cpu, setCpu] = useState('8');
 const [memoryOverallocate, setMemoryOverallocate] = useState('0');
 const [cpuOverallocate, setCpuOverallocate] = useState('0');
 const [serverDataDir, setServerDataDir] = useState('/var/lib/catalyst/servers');
 const [consoleLogDir, setConsoleLogDir] = useState('');
 const [cniDir, setCniDir] = useState('');
 const [cniBinDir, setCniBinDir] = useState('');
 const [cniDataDir, setCniDataDir] = useState('');
 const [cniResultsDir, setCniResultsDir] = useState('');
 const [cniBridgeName, setCniBridgeName] = useState('');
 const [cniBridgeSubnet, setCniBridgeSubnet] = useState('');
 const [systemdOverrideDir, setSystemdOverrideDir] = useState('');
 const [agentConfigPath, setAgentConfigPath] = useState('');
 const [agentReleaseRepo, setAgentReleaseRepo] = useState('');
 const [sftpPort, setSftpPort] = useState('2022');
 const [sftpEnabled, setSftpEnabled] = useState(true);
 const [showAdvanced, setShowAdvanced] = useState(false);
 const [deployInfo, setDeployInfo] = useState<{
 deployUrl: string;
 deploymentToken: string;
 apiKey: string;
 expiresAt: string;
 } | null>(null);
 const [createdNodeId, setCreatedNodeId] = useState<string | null>(null);

 // Re-open this modal when a location manager sends the user back
 // If a location was just created, auto-select it and jump to step 2
 useEffect(() => {
 const handler = (e: Event) => {
 const detail = (e as CustomEvent).detail;
 const createdId = detail?.createdId as string | undefined;
 setOpen(true);
 if (createdId) {
 setLocationId(createdId);
 setStep(2);
 } else {
 setStep(1);
 }
 };
 window.addEventListener(RETURN_EVENT, handler);
 return () => window.removeEventListener(RETURN_EVENT, handler);
 }, []);

 const { data: locations = [] } = useQuery({
 queryKey: qk.locations(),
 queryFn: locationsApi.list,
 staleTime: 5 * 60 * 1000,
 });

 const createMutation = useMutation({
 mutationFn: async () => {
 const created = await nodesApi.create({
 name,
 description: description || undefined,
 locationId,
 hostname,
 publicAddress,
 maxMemoryMb: Number(memory),
 maxCpuCores: Number(cpu),
 memoryOverallocatePercent: Number(memoryOverallocate),
 cpuOverallocatePercent: Number(cpuOverallocate),
 serverDataDir: serverDataDir || undefined,
 consoleLogDir: consoleLogDir || undefined,
 cniDir: cniDir || undefined,
 cniBinDir: cniBinDir || undefined,
 cniDataDir: cniDataDir || undefined,
 cniResultsDir: cniResultsDir || undefined,
 cniBridgeName: cniBridgeName || undefined,
 cniBridgeSubnet: cniBridgeSubnet || undefined,
 systemdOverrideDir: systemdOverrideDir || undefined,
 agentConfigPath: agentConfigPath || undefined,
 agentReleaseRepo: agentReleaseRepo || undefined,
 sftpPort: Number(sftpPort) || undefined,
 sftpEnabled: sftpEnabled || undefined,
 });
 return created;
 },
 onSuccess: (created) => {
 notifySuccess(t('create.success'));
 setCreatedNodeId(created?.id ?? null);
 // Move to step 3 (deploy script) and immediately fetch the deployment token
 setStep(3);
 if (created?.id) {
 deployTokenMutation.mutate(created.id);
 }
 },
 onSettled: () => {
 Promise.all([
 queryClient.invalidateQueries({ queryKey: qk.nodes() }),
 queryClient.invalidateQueries({ queryKey: qk.adminNodes() }),
 ]);
 },
 onError: (error: unknown) => {
   notifyError(error, 'nodes:create.error');
 },
 });

 const deployTokenMutation = useMutation({
 mutationFn: async (nodeId: string) => {
 const info = await nodesApi.deploymentToken(nodeId);
 return info;
 },
 onSuccess: (info) => {
 setDeployInfo(info ?? null);
 },
 onError: () => {
 // Don't show a separate error — step 3 already has a retry button
 setDeployInfo(null);
 },
 });

 const resetForm = () => {
 setStep(1);
 setLocationId('');
 setName('');
 setDescription('');
 setHostname('');
 setPublicAddress('');
 setMemory('16384');
 setCpu('8');
 setMemoryOverallocate('0');
 setCpuOverallocate('0');
 setServerDataDir('/var/lib/catalyst/servers');
 setConsoleLogDir('');
 setCniDir('');
 setCniBinDir('');
 setCniDataDir('');
 setCniResultsDir('');
 setCniBridgeName('');
 setCniBridgeSubnet('');
 setSystemdOverrideDir('');
 setAgentConfigPath('');
 setAgentReleaseRepo('');
 setSftpPort('2022');
 setSftpEnabled(true);
 setShowAdvanced(false);
 setDeployInfo(null);
 setCreatedNodeId(null);
 createMutation.reset();
 deployTokenMutation.reset();
 };

 const disableSubmit =
 !name ||
 !locationId ||
 !hostname ||
 !publicAddress ||
 !Number(memory) ||
 !Number(cpu) ||
 createMutation.isPending;

 return (
 <div>
 <button
 className="h-8 rounded-sm bg-primary px-3 text-mini font-medium text-primary-foreground transition-colors hover:bg-primary/90"
 onClick={() => {
 setStep(1);
 setOpen(true);
 }}
 >
 {t('create.open')}
 </button>

 {/* ── Main Modal ── */}
 <Dialog
 open={open}
 onOpenChange={(next) => {
 setOpen(next);
 if (!next) resetForm();
 }}
 >
 <DialogContent size="2xl">
 <DialogHeader icon={<MapPin className="h-4 w-4" />}>
 <DialogTitle>
 {step === 1
                ? t('create.step1Title')
                : step === 2
                  ? t('create.step2Title')
                  : t('deploy.title')}
 </DialogTitle>
 <DialogDescription>
 {step === 1
                  ? t('create.step1Description')
                  : step === 2
                    ? t('create.step2Description')
                    : t('create.step3Description')}
 </DialogDescription>
 </DialogHeader>

 {/* ── Step indicator ── */}
 <DialogToolbar>
 <div className="flex items-center gap-0.5">
 {[
 { n: 1, label: t('form.location'), active: step === 1 },
 { n: 2, label: t('create.stepDetails'), active: step === 2 || step === 3 },
 { n: 3, label: t('create.stepDeploy'), active: step === 3 },
 ].map((s) => (
 <div
 key={s.n}
 className={cn(
 'relative flex h-7 items-center gap-1.5 px-2.5 text-mini transition-colors',
 s.active ? 'text-foreground' : 'text-muted-foreground',
 )}
 >
 <span
 className={cn(
 'flex h-4 w-4 items-center justify-center rounded-sm font-mono text-micro tabular-nums',
 s.active ? 'bg-primary text-primary-foreground' : 'bg-surface-3 text-muted-foreground',
 )}
 >
 {s.n}
 </span>
 {s.label}
 {s.active && (
 <span className="absolute inset-x-1 bottom-0 h-[2px] bg-primary" aria-hidden />
 )}
 </div>
 ))}
 </div>
 </DialogToolbar>

 <DialogBody>
 {/* ── Step 1: Location Selection ── */}
 {step === 1 && (
 <div className="flex flex-col items-center px-6 py-10 text-center">
 <h3 className="font-display text-lg font-semibold leading-none tracking-tight text-foreground">
 {t('create.assignTitle')}
 </h3>
 <p className="mt-2 max-w-md type-meta">
   {t('create.locationsHint')}
 </p>

 {locations.length > 0 ? (
 <label className="mt-6 block w-full max-w-xs space-y-1.5">
 <span className="type-overline">
 {t('create.selectLocationLabel')} <span className="text-danger">*</span>
 </span>
 <Select
 value={locationId || '__none__'}
 onValueChange={(v) => setLocationId(v === '__none__' ? '' : v)}
 >
 <SelectTrigger className="h-8 w-full max-w-xs rounded-sm border-border/60 bg-background/40 px-2.5 text-mini">
 <SelectValue placeholder={t('create.chooseLocation')} />
 </SelectTrigger>
 <SelectContent>
 {locations.map((location) => (
 <SelectItem key={location.id} value={location.id}>
 <span className="flex items-center gap-2">
 <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
 {location.name}
 {location.description && (
 <span className="type-overline">
 — {location.description}
 </span>
 )}
 </span>
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </label>
 ) : (
 <div className="mt-6 rounded-sm border border-dashed border-border/50 px-4 py-3">
 <p className="type-meta">
 {t('form.noLocations')}{' '}
 <button
 type="button"
 className="inline-flex items-center gap-1 font-medium text-primary hover:text-primary/80"
 onClick={() => {
 setOpen(false);
 setStep(1);
 window.dispatchEvent(new CustomEvent(OPEN_LOCATIONS_EVENT, { detail: { returnTo: 'node-create' } }));
 }}
 >
 {t('form.createLocation')}
 </button>{' '}
     {t('create.noLocationsSuffix')}
 </p>
 </div>
 )}
 </div>
 )}

 {/* ── Step 2: Node Details Form ── */}
 {step === 2 && (
 <div className="space-y-3">
 {locationId && (
 <div className="flex items-center gap-2 rounded-sm border border-border/50 px-3 py-2">
 <MapPin className="h-4 w-4 text-muted-foreground" />
 <span className="type-overline">
 {t('create.location', { name: locations.find((l) => l.id === locationId)?.name || locationId })}
 </span>
 </div>
 )}
 <label className="block space-y-1">
 <span className="type-overline">{t('form.name')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={name}
 onChange={(event) => setName(event.target.value)}
 placeholder="production-1"
 />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.description')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={description}
 onChange={(event) => setDescription(event.target.value)}
 placeholder={t('form.descriptionPlaceholder')}
 />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.serverDataDir')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 font-mono text-mini tabular-nums text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={serverDataDir}
 onChange={(event) => setServerDataDir(event.target.value)}
 placeholder="/var/lib/catalyst/servers"
 />
 <p className="text-micro text-muted-foreground">
 {t('form.serverDataDirHint')}
 </p>
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.hostname')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={hostname}
 onChange={(event) => setHostname(event.target.value)}
 placeholder="node1.example.com"
 />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.publicAddress')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={publicAddress}
 onChange={(event) => setPublicAddress(event.target.value)}
 placeholder="203.0.113.10 or 2001:db8::1"
 />
 </label>
 <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
 <label className="block space-y-1">
 <span className="type-overline">{t('form.memoryMb')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={memory}
 onChange={(event) => setMemory(event.target.value)}
 type="number"
 min={256}
 />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.cpuCores')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={cpu}
 onChange={(event) => setCpu(event.target.value)}
 type="number"
 min={1}
 step={1}
 />
 </label>
 </div>
 <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
 <label className="block space-y-1">
 <span className="type-overline">{t('form.memoryOverallocate')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={memoryOverallocate}
 onChange={(event) => setMemoryOverallocate(event.target.value)}
 type="number"
 min={-1}
 />
 <p className="text-micro text-muted-foreground">
 {t('form.overallocateHint')}
 </p>
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.cpuOverallocate')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={cpuOverallocate}
 onChange={(event) => setCpuOverallocate(event.target.value)}
 type="number"
 min={-1}
 />
 <p className="text-micro text-muted-foreground">
 {t('form.overallocateHint')}
 </p>
 </label>
 </div>

 {/* SFTP Configuration */}
 <div className="rounded-sm border border-border/50 px-3 py-2.5">
 <div className="flex items-center justify-between">
 <span className="text-mini font-semibold text-foreground">{t('form.sftpAccess')}</span>
 <label className="flex items-center gap-2 text-mini text-muted-foreground">
 <input
 type="checkbox"
 checked={sftpEnabled}
 onChange={(e) => setSftpEnabled(e.target.checked)}
 className="rounded-sm border-border/40 text-primary focus:ring-primary"
 />
 {t('form.enabled')}
 </label>
 </div>
 {sftpEnabled && (
 <div className="mt-2">
 <label className="block space-y-1">
 <span className="type-overline">{t('form.sftpPort')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={sftpPort}
 onChange={(e) => setSftpPort(e.target.value)}
 type="number"
 min={1}
 max={65535}
 placeholder="2022"
 />
 <p className="text-micro text-muted-foreground">
 {t('create.sftpPortHint')}
 </p>
 </label>
 </div>
 )}
 </div>

 {/* Advanced Agent Paths — collapsed by default */}
 <div className="space-y-1">
 <button
 type="button"
 className="flex items-center gap-1.5 type-overline hover:text-foreground"
 onClick={() => setShowAdvanced(!showAdvanced)}
 >
 {showAdvanced ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
 {t('form.advancedPaths')}
 </button>
 {showAdvanced && (
 <div className="space-y-3 rounded-sm border border-border/50 px-3 py-2.5">
 <label className="block space-y-1">
 <span className="type-overline">{t('form.consoleLogDir')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 font-mono text-mini tabular-nums text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={consoleLogDir}
 onChange={(e) => setConsoleLogDir(e.target.value)}
 placeholder={t('form.consoleLogDirPlaceholder')}
 />
 </label>
 <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
 <label className="block space-y-1">
 <span className="type-overline">{t('form.cniConfigDir')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 font-mono text-mini tabular-nums text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={cniDir}
 onChange={(e) => setCniDir(e.target.value)}
 placeholder="/etc/cni/net.d"
 />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.cniBinDir')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 font-mono text-mini tabular-nums text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={cniBinDir}
 onChange={(e) => setCniBinDir(e.target.value)}
 placeholder="/opt/cni/bin"
 />
 </label>
 </div>
 <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
 <label className="block space-y-1">
 <span className="type-overline">{t('form.cniDataDir')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 font-mono text-mini tabular-nums text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={cniDataDir}
 onChange={(e) => setCniDataDir(e.target.value)}
 placeholder="/var/lib/cni/networks"
 />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.cniResultsDir')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 font-mono text-mini tabular-nums text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={cniResultsDir}
 onChange={(e) => setCniResultsDir(e.target.value)}
 placeholder="/var/lib/cni/results"
 />
 </label>
 </div>
 <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
 <label className="block space-y-1">
 <span className="type-overline">{t('form.cniBridgeName')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 font-mono text-mini tabular-nums text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={cniBridgeName}
 onChange={(e) => setCniBridgeName(e.target.value)}
 placeholder="catalyst0"
 />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.cniBridgeSubnet')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 font-mono text-mini tabular-nums text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={cniBridgeSubnet}
 onChange={(e) => setCniBridgeSubnet(e.target.value)}
 placeholder="10.42.0.0/16"
 />
 </label>
 </div>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.systemdOverrideDir')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 font-mono text-mini tabular-nums text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={systemdOverrideDir}
 onChange={(e) => setSystemdOverrideDir(e.target.value)}
 placeholder="/etc/systemd/system/containerd.service.d"
 />
 </label>
 <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
 <label className="block space-y-1">
 <span className="type-overline">{t('form.agentConfigPath')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 font-mono text-mini tabular-nums text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={agentConfigPath}
 onChange={(e) => setAgentConfigPath(e.target.value)}
 placeholder="/opt/catalyst-agent/config.toml"
 />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.agentReleaseRepo')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 font-mono text-mini tabular-nums text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={agentReleaseRepo}
 onChange={(e) => setAgentReleaseRepo(e.target.value)}
 placeholder="catalystctl/catalyst"
 />
 </label>
 </div>
 <p className="text-micro text-muted-foreground">
 {t('form.advancedPathsHint')}
 </p>
 </div>
 )}
 </div>
 </div>
 )}

 {/* ── Step 3: Deploy Script ── */}
 {step === 3 && (
 <div className="flex flex-col items-center py-4 text-center">
 <CheckCircle className="mb-3 h-4 w-4 text-success" />
 <h3 className="font-display text-lg font-semibold leading-none tracking-tight text-foreground">
 {t('create.registered')}
 </h3>
 <p className="mt-2 max-w-md type-meta">
 {t('create.runScript', { hostname })}
 </p>

 {deployTokenMutation.isPending ? (
 <div className="mt-6 flex items-center gap-2 text-mini text-muted-foreground">
 <Loader2 className="h-4 w-4 animate-spin" />
 {t('create.generating')}
 </div>
 ) : deployInfo ? (
 <div className="mt-6 w-full min-w-0 space-y-3 text-left">
 <div className="min-w-0 max-w-full overflow-x-auto rounded-sm border border-border/50 bg-surface-0 px-3 py-2 font-mono text-mini tabular-nums text-foreground">
 <code className="block max-w-full break-all whitespace-pre-wrap">
{buildDeployCommand(deployInfo.deployUrl, deployInfo.apiKey)}
 </code>
 </div>
 <div className="flex items-center justify-between text-micro text-muted-foreground">
 <span className="font-mono tabular-nums">{t('deploy.tokenExpires', { time: formatDateTime(deployInfo.expiresAt) })}</span>
 <button
 className="inline-flex items-center gap-1 font-medium text-primary hover:text-primary/80"
 onClick={() => {
 navigator.clipboard.writeText(
 buildDeployCommand(deployInfo.deployUrl, deployInfo.apiKey)
 );
 notifySuccess(t('deploy.copied'));
 }}
 >
 <Copy className="h-3.5 w-3.5" />
 {t('common:actions.copy')}
 </button>
 </div>
 </div>
 ) : deployTokenMutation.isError ? (
 <div className="mt-6 w-full space-y-3 text-left">
 <div className="rounded-sm border border-warning/30 bg-warning/5 px-3 py-2 text-mini text-warning">
 {t('create.deployFailed')}
 </div>
 <button
 className="h-8 rounded-sm bg-primary px-3 text-mini font-medium text-primary-foreground transition-colors hover:bg-primary/90"
 onClick={() => {
 if (createdNodeId) {
 deployTokenMutation.mutate(createdNodeId);
 }
 }}
 >
 {t('common:actions.retry')}
 </button>
 {createdNodeId && (
 <p className="type-overline">
 {t('create.orGoTo')}{' '}
 <a href={`/admin/nodes/${createdNodeId}`} className="font-medium text-primary hover:text-primary/80">
   {t('create.nodeSettings')}
 </a>{' '}
 {t('create.generateManually')}
 </p>
 )}
 </div>
 ) : null}
 </div>
 )}
 </DialogBody>
 <DialogFooter className={step === 3 ? undefined : 'sm:justify-between'}>
 {step !== 3 ? (
 <div className="flex items-center gap-2">
 <Button
 variant="outline"
 size="sm"
 className="h-8 px-3 text-mini"
 onClick={() => {
 setOpen(false);
 resetForm();
 }}
 >
 {t('common:actions.cancel')}
 </Button>
 {step === 2 ? (
 <Button variant="outline" size="sm" className="h-8 px-3 text-mini" onClick={() => setStep(1)}>
   {t('common:actions.back')}
 </Button>
 ) : null}
 </div>
 ) : null}
 {step === 1 && locations.length > 0 && locationId ? (
 <Button size="sm" className="h-8 px-3 text-mini" onClick={() => setStep(2)}>
 {t('create.continue')}
 <ArrowRight className="h-3.5 w-3.5" />
 </Button>
 ) : null}
 {step === 2 ? (
 <Button size="sm" className="h-8 px-3 text-mini" onClick={() => createMutation.mutate()} disabled={disableSubmit}>
 {createMutation.isPending ? t('create.registering') : t('create.register')}
 </Button>
 ) : null}
 {step === 3 ? (
 <Button
 size="sm"
 className="h-8 px-3 text-mini"
 onClick={() => {
 setOpen(false);
 resetForm();
 }}
 >
 {t('create.done')}
 </Button>
 ) : null}
 </DialogFooter>
 </DialogContent>
 </Dialog>
 </div>
 );
}

export default NodeCreateModal;
