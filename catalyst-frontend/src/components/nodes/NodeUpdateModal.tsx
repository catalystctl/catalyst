import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@/csync';
import { ChevronDown, ChevronRight, MapPin } from 'lucide-react';
import type { NodeInfo } from '../../types/node';
import { nodesApi } from '../../services/api/nodes';
import { locationsApi } from '../../services/api/locations';
import { qk } from '../../lib/queryKeys';
import { queryClient } from '../../lib/queryClient';
import { notifyError, notifySuccess } from '../../utils/notify';
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
 DialogBody,
 DialogContent,
 DialogDescription,
 DialogFooter,
 DialogHeader,
 DialogTitle,
} from '@/components/ui/dialog';

type Props = {
 node: NodeInfo;
 open?: boolean;
 onOpenChange?: (open: boolean) => void;
 /** ID of a newly-created location to auto-select (passed from parent after return-from-locations flow) */
 createdLocationId?: string | null;
};

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
 <DialogContent size="lg">
 <DialogHeader>
 <DialogTitle>{t('update.title')}</DialogTitle>
 <DialogDescription>{t('update.description')}</DialogDescription>
 </DialogHeader>
 <DialogBody className="space-y-3">
 <label className="block space-y-1">
 <span className="type-overline">{t('form.name')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={name}
 onChange={(event) => setName(event.target.value)}
 />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">
 {t('form.description')}
 </span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={description}
 onChange={(event) => setDescription(event.target.value)}
 />
 </label>
 <label className="block space-y-1">
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
 <label className="block space-y-1">
 <span className="type-overline">
 {t('form.serverDataDir')}
 </span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 font-mono text-mini tabular-nums text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={serverDataDir}
 onChange={(event) => setServerDataDir(event.target.value)}
 placeholder="/var/lib/catalyst/servers"
 />
 <p className="type-overline">
 {t('form.serverDataDirHint')}
 </p>
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.hostname')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={hostname}
 onChange={(event) => setHostname(event.target.value)}
 />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">
 {t('form.publicAddress')}
 </span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={publicAddress}
 onChange={(event) => setPublicAddress(event.target.value)}
 placeholder="203.0.113.10 or 2001:db8::1"
 />
 </label>
 <div className="grid grid-cols-2 gap-3">
 <label className="block space-y-1">
 <span className="type-overline">
 {t('form.memoryMb')}
 </span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={memory}
 onChange={(event) => setMemory(event.target.value)}
 type="number"
 min={256}
 />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">
 {t('form.cpuCores')}
 </span>
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
 <div className="grid grid-cols-2 gap-3">
 <label className="block space-y-1">
 <span className="type-overline">
 {t('form.memoryOverallocate')}
 </span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={memoryOverallocate}
 onChange={(event) => setMemoryOverallocate(event.target.value)}
 type="number"
 min={-1}
 />
 <p className="type-overline">
 {t('form.overallocateHint')}
 </p>
 </label>
 <label className="block space-y-1">
 <span className="type-overline">
 {t('form.cpuOverallocate')}
 </span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={cpuOverallocate}
 onChange={(event) => setCpuOverallocate(event.target.value)}
 type="number"
 min={-1}
 />
 <p className="type-overline">
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
 <p className="type-overline">
 {t('update.sftpPortHint')}
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
 <div className="grid grid-cols-2 gap-3">
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
 <div className="grid grid-cols-2 gap-3">
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
 <div className="grid grid-cols-2 gap-3">
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
 <div className="grid grid-cols-2 gap-3">
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
 <p className="type-overline">
 {t('form.advancedPathsHint')}
 </p>
 </div>
 )}
 </div>
 </DialogBody>
 <DialogFooter>
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

export default NodeUpdateModal;
