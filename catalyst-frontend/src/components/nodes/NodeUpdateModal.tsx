import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@/csync';
import { MapPin } from 'lucide-react';
import type { NodeInfo } from '../../types/node';
import { nodesApi } from '../../services/api/nodes';
import { locationsApi } from '../../services/api/locations';
import { qk } from '../../lib/queryKeys';
import { queryClient } from '../../lib/queryClient';
import { notifyError, notifySuccess } from '../../utils/notify';
import { cn } from '../../lib/utils';
import {
 Select,
 SelectContent,
 SelectItem,
 SelectTrigger,
 SelectValue,
} from '../../components/ui/select';
import { Button } from '@/components/ui/button';
import { BracketLabel } from '@/components/deck/primitives';
import {
 Dialog,
 DialogBody,
 DialogContent,
 DialogDescription,
 DialogFooter,
 DialogHeader,
 DialogTitle,
} from '@/components/ui/dialog';
import { FormSection } from '@/components/ui/form-section';

type Props = {
 node: NodeInfo;
 open?: boolean;
 onOpenChange?: (open: boolean) => void;
 /** ID of a newly-created location to auto-select (passed from parent after return-from-locations flow) */
 createdLocationId?: string | null;
};

const INPUT_CLASS =
 'h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40';
const INPUT_MONO_CLASS =
 'h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 font-mono text-mini tabular-nums text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40';

function NodeUpdateModal({ node, open: controlledOpen, onOpenChange, createdLocationId }: Props) {
  const { t } = useTranslation('nodes');
 const [internalOpen, setInternalOpen] = useState(false);
 const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
 const setOpen = (value: boolean) => {
 setInternalOpen(value);
 onOpenChange?.(value);
 };
 const [name, setName] = useState(node.name);
 const [description, setDescription] = useState(node.description ?? '');
 const [locationId, setLocationId] = useState(node.locationId ?? '');
 // Auto-select a newly created location when returning from the locations manager.
 // Use the "previous prop" pattern to sync state without an effect.
 const [prevCreatedLocationId, setPrevCreatedLocationId] = useState<string | null | undefined>(undefined);
 if (createdLocationId !== prevCreatedLocationId && createdLocationId) {
 setPrevCreatedLocationId(createdLocationId);
 setLocationId(createdLocationId);
 } else if (createdLocationId !== prevCreatedLocationId) {
 setPrevCreatedLocationId(createdLocationId);
 }
 const [hostname, setHostname] = useState(node.hostname ?? '');
 const [publicAddress, setPublicAddress] = useState(node.publicAddress ?? '');
 const [memory, setMemory] = useState(String(node.maxMemoryMb ?? 0));
 const [cpu, setCpu] = useState(String(node.maxCpuCores ?? 0));
 const [memoryOverallocate, setMemoryOverallocate] = useState(
 String(node.memoryOverallocatePercent ?? 0),
 );
 const [cpuOverallocate, setCpuOverallocate] = useState(
 String(node.cpuOverallocatePercent ?? 0),
 );
 const [serverDataDir, setServerDataDir] = useState(
 node.serverDataDir ?? '/var/lib/catalyst/servers',
 );
 const [consoleLogDir, setConsoleLogDir] = useState(node.consoleLogDir ?? '');
 const [cniDir, setCniDir] = useState(node.cniDir ?? '');
 const [cniBinDir, setCniBinDir] = useState(node.cniBinDir ?? '');
 const [cniDataDir, setCniDataDir] = useState(node.cniDataDir ?? '');
 const [cniResultsDir, setCniResultsDir] = useState(node.cniResultsDir ?? '');
 const [cniBridgeName, setCniBridgeName] = useState(node.cniBridgeName ?? '');
 const [cniBridgeSubnet, setCniBridgeSubnet] = useState(node.cniBridgeSubnet ?? '');
 const [systemdOverrideDir, setSystemdOverrideDir] = useState(node.systemdOverrideDir ?? '');
 const [agentConfigPath, setAgentConfigPath] = useState(node.agentConfigPath ?? '');
 const [agentReleaseRepo, setAgentReleaseRepo] = useState(node.agentReleaseRepo ?? '');
 const [sftpPort, setSftpPort] = useState(String(node.sftpPort ?? 2022));
 const [sftpEnabled, setSftpEnabled] = useState(node.sftpEnabled ?? true);
 const [showAdvanced, setShowAdvanced] = useState(false);

 const { data: locations = [] } = useQuery({
 queryKey: qk.locations(),
 queryFn: locationsApi.list,
 staleTime: 5 * 60 * 1000,
 });

 const mutation = useMutation({
 mutationFn: () =>
 nodesApi.update(node.id, {
 name: name || undefined,
 description: description || undefined,
 locationId: locationId || undefined,
 hostname: hostname || undefined,
 publicAddress: publicAddress || undefined,
 maxMemoryMb: Number(memory) || undefined,
 maxCpuCores: Number(cpu) || undefined,
 memoryOverallocatePercent:
 memoryOverallocate !== '' ? Number(memoryOverallocate) : undefined,
 cpuOverallocatePercent:
 cpuOverallocate !== '' ? Number(cpuOverallocate) : undefined,
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
 sftpEnabled,
 }),
 onSuccess: () => {
 notifySuccess(t('update.success'));
 setOpen(false);
 },
 onSettled: () => {
 Promise.all([
 queryClient.invalidateQueries({ queryKey: qk.nodes() }),
 queryClient.invalidateQueries({ queryKey: qk.node(node.id) }),
 queryClient.invalidateQueries({ queryKey: qk.adminNodes() }),
 ]);
 },
 onError: (error: unknown) => {
   notifyError(error, 'nodes:update.error');
 },
 });

 const locationName = locations.find((location) => location.id === locationId)?.name ?? '';

 return (
 <>
 {controlledOpen === undefined && (
 <button
 className="h-8 w-full rounded-sm border border-border/60 px-3 text-mini font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
 onClick={() => setOpen(true)}
 >
 {t('update.button')}
 </button>
 )}
 <Dialog open={open} onOpenChange={setOpen}>
 <DialogContent size="full" className="sm:h-[min(90dvh,54rem)]">
 <DialogHeader>
 <DialogTitle>{t('update.title')}</DialogTitle>
 <DialogDescription>{t('update.description')}</DialogDescription>
 </DialogHeader>
 <DialogBody className="min-h-0 p-0">
 <div className="grid min-h-0 grid-cols-1 lg:h-full lg:grid-cols-[minmax(0,1fr)_20rem]">
 {/* ── Editor ── */}
 <div className="min-w-0 space-y-3 overflow-y-auto p-4 lg:pr-5">
 {/* 1 — Identity */}
 <FormSection index={1} title={t('form.name')} eyebrow={t('update.title')}>
 <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
 <label className="block space-y-1">
 <span className="type-overline">{t('form.name')}</span>
 <input
 className={INPUT_CLASS}
 value={name}
 onChange={(event) => setName(event.target.value)}
 />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.description')}</span>
 <input
 className={INPUT_CLASS}
 value={description}
 onChange={(event) => setDescription(event.target.value)}
 />
 </label>
 </div>
 <label className="mt-3 block space-y-1">
 <span className="type-overline">{t('form.location')}</span>
 {locations.length > 0 ? (
 <Select
 value={locationId || '__none__'}
 onValueChange={(v) => setLocationId(v === '__none__' ? '' : v)}
 >
 <SelectTrigger className="h-8 w-full rounded-sm border-border/60 bg-background/40 px-2.5 text-mini">
 <SelectValue placeholder={t('form.selectLocation')} />
 </SelectTrigger>
 <SelectContent>
 {locations.map((location) => (
 <SelectItem key={location.id} value={location.id}>
 <span className="flex items-center gap-2">
 <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
 {location.name}
 </span>
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 ) : (
 <div className="rounded-sm border border-dashed border-border/50 px-3 py-2">
 <p className="type-overline">
 {t('form.noLocations')}{' '}
 <button
 type="button"
 className="inline-flex items-center gap-1 font-medium text-primary hover:text-primary/80"
 onClick={() => {
 setOpen(false);
 window.dispatchEvent(new CustomEvent('catalyst:open-locations-modal', { detail: { returnTo: 'node-update' } }));
 }}
 >
 {t('form.createLocation')}
 </button>
 </p>
 </div>
 )}
 </label>
 </FormSection>

 {/* 2 — Connection */}
 <FormSection index={2} title={t('form.hostname')} eyebrow={t('agent.connection')}>
 <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
 <label className="block space-y-1">
 <span className="type-overline">{t('form.hostname')}</span>
 <input
 className={INPUT_CLASS}
 value={hostname}
 onChange={(event) => setHostname(event.target.value)}
 />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.publicAddress')}</span>
 <input
 className={INPUT_CLASS}
 value={publicAddress}
 onChange={(event) => setPublicAddress(event.target.value)}
 placeholder="203.0.113.10 or 2001:db8::1"
 />
 </label>
 </div>

 {/* SFTP Configuration */}
 <div className="mt-3 rounded-sm border border-border/50 px-3 py-2.5">
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
 className={INPUT_CLASS}
 value={sftpPort}
 onChange={(e) => setSftpPort(e.target.value)}
 type="number"
 min={1}
 max={65535}
 placeholder="2022"
 />
 <p className="type-overline">{t('update.sftpPortHint')}</p>
 </label>
 </div>
 )}
 </div>
 </FormSection>

 {/* 3 — Capacity */}
 <FormSection index={3} title={t('form.memoryMb')} eyebrow={t('agent.capacity')}>
 <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
 <label className="block space-y-1">
 <span className="type-overline">{t('form.memoryMb')}</span>
 <input
 className={INPUT_CLASS}
 value={memory}
 onChange={(event) => setMemory(event.target.value)}
 type="number"
 min={256}
 />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.cpuCores')}</span>
 <input
 className={INPUT_CLASS}
 value={cpu}
 onChange={(event) => setCpu(event.target.value)}
 type="number"
 min={1}
 step={1}
 />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.memoryOverallocate')}</span>
 <input
 className={INPUT_CLASS}
 value={memoryOverallocate}
 onChange={(event) => setMemoryOverallocate(event.target.value)}
 type="number"
 min={-1}
 />
 <p className="type-overline">{t('form.overallocateHint')}</p>
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.cpuOverallocate')}</span>
 <input
 className={INPUT_CLASS}
 value={cpuOverallocate}
 onChange={(event) => setCpuOverallocate(event.target.value)}
 type="number"
 min={-1}
 />
 <p className="type-overline">{t('form.overallocateHint')}</p>
 </label>
 </div>
 <label className="mt-3 block space-y-1">
 <span className="type-overline">{t('form.serverDataDir')}</span>
 <input
 className={INPUT_MONO_CLASS}
 value={serverDataDir}
 onChange={(event) => setServerDataDir(event.target.value)}
 placeholder="/var/lib/catalyst/servers"
 />
 <p className="type-overline">{t('form.serverDataDirHint')}</p>
 </label>
 </FormSection>

 {/* 4 — Advanced agent paths (collapsed by default) */}
 <FormSection index={4} title={t('form.advancedPaths')} eyebrow={t('agent.tabs.config')}>
 <button
 type="button"
 className="flex items-center gap-1.5 type-overline hover:text-foreground"
 onClick={() => setShowAdvanced(!showAdvanced)}
 >
 {showAdvanced ? '▾' : '▸'}
 {t('form.advancedPaths')}
 </button>
 {showAdvanced && (
 <div className="mt-2 space-y-3">
 <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
 <label className="block space-y-1">
 <span className="type-overline">{t('form.consoleLogDir')}</span>
 <input
 className={INPUT_MONO_CLASS}
 value={consoleLogDir}
 onChange={(e) => setConsoleLogDir(e.target.value)}
 placeholder={t('form.consoleLogDirPlaceholder')}
 />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.systemdOverrideDir')}</span>
 <input
 className={INPUT_MONO_CLASS}
 value={systemdOverrideDir}
 onChange={(e) => setSystemdOverrideDir(e.target.value)}
 placeholder="/etc/systemd/system/containerd.service.d"
 />
 </label>
 </div>
 <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
 <label className="block space-y-1">
 <span className="type-overline">{t('form.cniConfigDir')}</span>
 <input
 className={INPUT_MONO_CLASS}
 value={cniDir}
 onChange={(e) => setCniDir(e.target.value)}
 placeholder="/etc/cni/net.d"
 />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.cniBinDir')}</span>
 <input
 className={INPUT_MONO_CLASS}
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
 className={INPUT_MONO_CLASS}
 value={cniDataDir}
 onChange={(e) => setCniDataDir(e.target.value)}
 placeholder="/var/lib/cni/networks"
 />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.cniResultsDir')}</span>
 <input
 className={INPUT_MONO_CLASS}
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
 className={INPUT_MONO_CLASS}
 value={cniBridgeName}
 onChange={(e) => setCniBridgeName(e.target.value)}
 placeholder="catalyst0"
 />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.cniBridgeSubnet')}</span>
 <input
 className={INPUT_MONO_CLASS}
 value={cniBridgeSubnet}
 onChange={(e) => setCniBridgeSubnet(e.target.value)}
 placeholder="10.42.0.0/16"
 />
 </label>
 </div>
 <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
 <label className="block space-y-1">
 <span className="type-overline">{t('form.agentConfigPath')}</span>
 <input
 className={INPUT_MONO_CLASS}
 value={agentConfigPath}
 onChange={(e) => setAgentConfigPath(e.target.value)}
 placeholder="/opt/catalyst-agent/config.toml"
 />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.agentReleaseRepo')}</span>
 <input
 className={INPUT_MONO_CLASS}
 value={agentReleaseRepo}
 onChange={(e) => setAgentReleaseRepo(e.target.value)}
 placeholder="catalystctl/catalyst"
 />
 </label>
 </div>
 <p className="text-micro text-muted-foreground">{t('form.advancedPathsHint')}</p>
 </div>
 )}
 </FormSection>
 </div>

 {/* ── Live summary — mirrors the payload about to be sent ── */}
 <aside className="min-w-0 space-y-3 overflow-y-auto border-t border-border/70 bg-surface-1/40 p-4 lg:border-l lg:border-t-0">
 <BracketLabel tone="muted">{t('create.stepDetails')}</BracketLabel>

 <div className="space-y-1 overflow-hidden rounded-sm border border-border bg-card px-3 py-2.5">
 <SummaryRow label={t('form.name')} value={name.trim()} />
 <SummaryRow label={t('form.hostname')} value={hostname.trim()} />
 <SummaryRow label={t('form.publicAddress')} value={publicAddress.trim()} />
 <SummaryRow label={t('form.location')} value={locationName} />
 <SummaryRow label={t('form.memoryMb')} value={memory} mono />
 <SummaryRow label={t('form.cpuCores')} value={cpu} mono />
 {sftpEnabled && <SummaryRow label={t('form.sftpPort')} value={sftpPort} mono />}
 </div>

 <p className="rounded-sm border border-border/50 bg-surface-1/40 px-2.5 py-2 text-micro leading-relaxed text-muted-foreground">
 {t('update.description')}
 </p>
 </aside>
 </div>
 </DialogBody>
 <DialogFooter className="sm:justify-between">
 <Button variant="outline" size="sm" className="h-8 px-3 text-mini" onClick={() => setOpen(false)}>
 {t('common:actions.cancel')}
 </Button>
 <Button
 size="sm"
 className="h-8 px-3 text-mini"
 onClick={() => mutation.mutate()}
 disabled={mutation.isPending}
 >
 {mutation.isPending ? t('update.saving') : t('update.save')}
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 </>
 );
}

/** One aside line: muted label on the left, live value on the right. */
function SummaryRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
 const { t } = useTranslation('nodes');
 return (
 <div className="flex items-baseline justify-between gap-2">
 <span className="shrink-0 text-micro text-muted-foreground">{label}</span>
 <span
 className={cn(
 'min-w-0 truncate text-right text-mini',
 mono && 'font-mono tabular-nums',
 value ? 'text-foreground' : 'italic text-muted-foreground/70',
 )}
 >
 {value || t('state.notAvailable')}
 </span>
 </div>
 );
}

export default NodeUpdateModal;
