import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
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
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { serversApi } from '../../services/api/servers';
import { useTemplates } from '../../hooks/useTemplates';
import { useNodes, useAccessibleNodes } from '../../hooks/useNodes';
import { notifyError, notifySuccess } from '../../utils/notify';
import { getLocalizedErrorMessage, getLocalizedFieldErrors } from '../../i18n/api-errors';
import { nodesApi } from '../../services/api/nodes';
import { useAuthStore } from '../../stores/authStore';
import Combobox from '@/components/ui/combobox';
import { cn } from '@/lib/utils';
import { BracketLabel } from '@/components/deck/primitives';

/** Deck field chrome — 4px radius, 32px control height, mini type ramp. */
const fieldClass =
  'h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40';
const monoFieldClass = `${fieldClass} font-mono tabular-nums`;
const textareaClass =
  'w-full resize-none rounded-sm border border-border/60 bg-background/40 px-2.5 py-2 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40';
/** Labelled block on the dialog surface — never a nested rounded card. */
const blockClass = 'rounded-sm border border-border/50 bg-surface-1/40 p-3';

function CreateServerModal() {
 const { t } = useTranslation('servers');
 const user = useAuthStore((s) => s.user);
 const { data: accessibleNodesData } = useAccessibleNodes();
 const accessibleNodes = accessibleNodesData?.nodes || [];
 const hasNodeWildcard = accessibleNodesData?.hasWildcard || false;

 const canCreateServer =
 user?.permissions?.includes('*') ||
 user?.permissions?.includes('admin.write') ||
 user?.permissions?.includes('server.create') ||
 hasNodeWildcard ||
 accessibleNodes.length > 0;

 const [open, setOpen] = useState(false);
 const [name, setName] = useState('');
 const [templateId, setTemplateId] = useState('');
 const [nodeId, setNodeId] = useState('');
 const [description, setDescription] = useState('');
 const [memory, setMemory] = useState('1024');
 const [cpu, setCpu] = useState('1');
 const [disk, setDisk] = useState('10240');
 const [backupAllocationMb, setBackupAllocationMb] = useState('');
 const [databaseAllocation, setDatabaseAllocation] = useState('');
 const [allocatedSwapMb, setAllocatedSwapMb] = useState('');
 const [port, setPort] = useState('25565');
 const [additionalBindings, setAdditionalBindings] = useState<
 Array<{ allocationId: string; containerPort: string }>
 >([]);
 const [environment, setEnvironment] = useState<Record<string, string>>({});
 const [imageVariant, setImageVariant] = useState('');
 const [networkMode, setNetworkMode] = useState('host');
 const [macvlanInterface, setMacvlanInterface] = useState('');
 const [primaryIp, setPrimaryIp] = useState('');
 const [allocationId, setAllocationId] = useState('');
 const [availableAllocations, setAvailableAllocations] = useState<
 Array<{ id: string; ip: string; port: number; alias?: string | null }>
 >([]);
 const [allocLoadError, setAllocLoadError] = useState<string | null>(null);
 const [allocRefreshKey, setAllocRefreshKey] = useState(0);
 const [nodeIpPools, setNodeIpPools] = useState<
 Array<{ id: string; networkName: string; cidr: string; availableCount: number }>
 >([]);
 const [step, setStep] = useState<'details' | 'resources' | 'build' | 'startup'>('details');
 const navigate = useNavigate();
 const queryClient = useQueryClient();

 const { data: templates = [] } = useTemplates();
 const { data: nodes = [] } = useNodes();
 const [availableIps, setAvailableIps] = useState<string[]>([]);
 const [ipLoadError, setIpLoadError] = useState<string | null>(null);

 const isAdmin = user?.permissions?.includes('*') || user?.permissions?.includes('admin.write');
 const availableNodes: Array<{ id: string; name: string; locationId?: string }> =
 isAdmin || hasNodeWildcard ? nodes : accessibleNodes;

 const selectedTemplate = useMemo(
 () => templates.find((t) => t.id === templateId),
 [templates, templateId],
 );

 // Auto-populate primary port from selected allocation in host mode
 const [prevAllocationId, setPrevAllocationId] = useState(allocationId);
 if (allocationId !== prevAllocationId) {
 setPrevAllocationId(allocationId);
 if (networkMode === 'host' && allocationId) {
 const allocation = availableAllocations.find((a) => a.id === allocationId);
 if (allocation) {
 setPort(String(allocation.port));
 }
 }
 }

 // Clear additional bindings when switching away from host mode
 const [prevNetworkMode, setPrevNetworkMode] = useState(networkMode);
 if (networkMode !== prevNetworkMode) {
 setPrevNetworkMode(networkMode);
 if (networkMode !== 'host') {
 setAdditionalBindings([]);
 }
 }

 // Set default port from template when template is selected
 const [prevSelectedTemplate, setPrevSelectedTemplate] = useState(selectedTemplate);
 if (selectedTemplate !== prevSelectedTemplate) {
 setPrevSelectedTemplate(selectedTemplate);
 if (selectedTemplate?.supportedPorts && selectedTemplate.supportedPorts.length > 0) {
 if (networkMode !== 'host' || !allocationId) {
 setPort(String(selectedTemplate.supportedPorts[0]));
 }
 }
 const recommendedDisk = Number(selectedTemplate?.features?.recommendedDiskMb);
 if (Number.isFinite(recommendedDisk) && recommendedDisk > 0) {
 setDisk(String(recommendedDisk));
 }
 if (selectedTemplate?.allocatedMemoryMb) {
 setMemory(String(selectedTemplate.allocatedMemoryMb));
 }
 }

 const templateVariables = useMemo(() => {
 if (!selectedTemplate?.variables) return [];
 return selectedTemplate.variables.filter((v) => v.name !== 'SERVER_DIR');
 }, [selectedTemplate]);

 const selectedNode = useMemo(
 () => availableNodes.find((node) => node.id === nodeId),
 [availableNodes, nodeId],
 );
 const locationId = selectedNode?.locationId || availableNodes[0]?.locationId || '';

 // Load macvlan interfaces (IP pools) for the selected node
 const [prevMacvlanDeps, setPrevMacvlanDeps] = useState({ nodeId, networkMode });
 if (prevMacvlanDeps.nodeId !== nodeId || prevMacvlanDeps.networkMode !== networkMode) {
 setPrevMacvlanDeps({ nodeId, networkMode });
 setMacvlanInterface('');
 setNodeIpPools([]);
 }

 useEffect(() => {
 if (!nodeId || networkMode !== 'macvlan') return;
 let active = true;
 nodesApi
 .ipPools(nodeId)
 .then((pools) => {
 if (!active) return;
 setNodeIpPools(pools);
 if (pools.length === 1) setMacvlanInterface(pools[0].networkName);
 })
 .catch(() => {
 if (!active) return;
 setNodeIpPools([]);
 });
 return () => {
 active = false;
 };
 }, [nodeId, networkMode]);

 // Load available IPs when macvlan interface is selected
 const [prevIpDeps, setPrevIpDeps] = useState({ nodeId, networkMode, macvlanInterface });
 if (
 prevIpDeps.nodeId !== nodeId ||
 prevIpDeps.networkMode !== networkMode ||
 prevIpDeps.macvlanInterface !== macvlanInterface
 ) {
 setPrevIpDeps({ nodeId, networkMode, macvlanInterface });
 setPrimaryIp('');
 if (!nodeId || networkMode !== 'macvlan' || !macvlanInterface) {
 setAvailableIps([]);
 setIpLoadError(null);
 } else {
 setIpLoadError(null);
 }
 }

 useEffect(() => {
 if (!nodeId || networkMode !== 'macvlan' || !macvlanInterface) {
 return;
 }

 let active = true;
 nodesApi
 .availableIps(nodeId, macvlanInterface, 200)
 .then((ips) => {
 if (!active) return;
 setAvailableIps(ips);
 })
 .catch((error: any) => {
 if (!active) return;
 setAvailableIps([]);
 setIpLoadError(getLocalizedErrorMessage(error));
 });

 return () => {
 active = false;
 };
 }, [nodeId, networkMode, macvlanInterface]);

 // Load allocations for host (port mapping) mode
 const [prevAllocDeps, setPrevAllocDeps] = useState({ nodeId, networkMode, allocRefreshKey });
 if (
 prevAllocDeps.nodeId !== nodeId ||
 prevAllocDeps.networkMode !== networkMode ||
 prevAllocDeps.allocRefreshKey !== allocRefreshKey
 ) {
 setPrevAllocDeps({ nodeId, networkMode, allocRefreshKey });
 setAllocationId('');
 if (!nodeId || networkMode !== 'host') {
 setAvailableAllocations([]);
 setAllocLoadError(null);
 } else {
 setAllocLoadError(null);
 }
 }

 useEffect(() => {
 if (!nodeId || networkMode !== 'host') {
 return;
 }
 let active = true;
 nodesApi
 .allocations(nodeId)
 .then((allocations) => {
 if (!active) return;
 setAvailableAllocations(
 allocations
 .filter((allocation) => !allocation.serverId)
 .map((allocation) => ({
 id: allocation.id,
 ip: allocation.ip,
 port: allocation.port,
 alias: allocation.alias,
 })),
 );
 })
 .catch((error: any) => {
 if (!active) return;
 setAvailableAllocations([]);
 setAllocLoadError(getLocalizedErrorMessage(error));
 });
 return () => {
 active = false;
 };
 }, [nodeId, networkMode, allocRefreshKey]);

 // Auto-refresh allocations when user returns from another tab
 useEffect(() => {
 if (!nodeId || networkMode !== 'host') return;
 const onFocus = () => setAllocRefreshKey((k) => k + 1);
 window.addEventListener('focus', onFocus);
 return () => window.removeEventListener('focus', onFocus);
 }, [nodeId, networkMode]);

 const mutation = useMutation({
 mutationFn: async () => {
 const normalizedBindings = additionalBindings.reduce<Record<number, number>>(
 (acc, binding) => {
 const allocation = availableAllocations.find((a) => a.id === binding.allocationId);
 if (!allocation) return acc;
 const containerPort = Number(binding.containerPort);
 const hostPort = allocation.port;
 if (
 Number.isFinite(containerPort) &&
 Number.isFinite(hostPort) &&
 containerPort > 0 &&
 containerPort <= 65535 &&
 hostPort > 0 &&
 hostPort <= 65535
 ) {
 acc[containerPort] = hostPort;
 }
 return acc;
 },
 {},
 );

 const payload: Parameters<typeof serversApi.create>[0] = {
 name,
 description: description.trim() || undefined,
 templateId,
 nodeId,
 locationId,
 allocatedMemoryMb: Number(memory),
 allocatedCpuCores: Number(cpu),
 allocatedDiskMb: Number(disk),
 allocatedSwapMb: parsedSwap,
 backupAllocationMb:
 backupAllocationMb.trim() === '' ? undefined : Number(backupAllocationMb),
 databaseAllocation:
 databaseAllocation.trim() === '' ? undefined : Number(databaseAllocation),
 primaryPort: Number(port),
 portBindings: Object.keys(normalizedBindings).length ? normalizedBindings : undefined,
 networkMode: networkMode as
 | 'bridge'
 | 'macvlan'
 | 'host'
 | 'mc-lan-static'
 | 'mc-lan-dynamic',
 environment: Object.fromEntries(
 Object.entries({
 ...environment,
 ...(imageVariant ? { IMAGE_VARIANT: imageVariant } : {}),
 }).filter(([, v]) => v !== ''),
 ),
 };
 if (networkMode === 'macvlan') {
 payload.primaryIp = primaryIp.trim() || null;
 }
 if (networkMode === 'host' && allocationId) {
 payload.allocationId = allocationId;
 }

 const server = await serversApi.create(payload);

 if (server?.id) {
 await serversApi.install(server.id);
 }

 return server;
 },
 onSuccess: (server) => {
 notifySuccess(t('createServer.created'));
 setOpen(false);
 setName('');
 setDescription('');
 setTemplateId('');
 setNodeId('');
 setEnvironment({});
 setImageVariant('');
 setNetworkMode('host');
 setMacvlanInterface('');
 setPrimaryIp('');
 setAdditionalBindings([]);
 setAllocatedSwapMb('');
 setBackupAllocationMb('');
 setDatabaseAllocation('');
 setStep('details');
 if (server?.id) {
 navigate(`/servers/${server.id}/console`);
 }
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.servers() });
 queryClient.invalidateQueries({ queryKey: qk.adminServers() });
 },
 onError: (error: any) => {
 console.error('Server creation error:', error?.response?.data || error);
 // Field-level details are translated through their validation rule codes;
 // otherwise the error's own code drives the message.
 const fieldErrors = getLocalizedFieldErrors(error);
 notifyError(fieldErrors[0]?.message ?? getLocalizedErrorMessage(error));
 },
 });

 const stepOrder = ['details', 'resources', 'build', 'startup'] as const;
 const stepIndex = stepOrder.indexOf(step);
 const parsedMemory = Number(memory);
 const parsedCpu = Number(cpu);
 const parsedDisk = Number(disk);
 const parsedPort = Number(port);
 const parsedSwap = allocatedSwapMb.trim() === '' ? undefined : Number(allocatedSwapMb);
 const detailsValid =
 Boolean(name.trim()) &&
 /^[a-zA-Z0-9\-_ .()&']+$/.test(name) &&
 Boolean(templateId) &&
 Boolean(nodeId);
 const resourcesValid =
 Number.isFinite(parsedMemory) &&
 parsedMemory >= 256 &&
 Number.isFinite(parsedCpu) &&
 parsedCpu >= 1 &&
 Number.isFinite(parsedDisk) &&
 parsedDisk >= 1024 &&
 (parsedSwap === undefined || (Number.isFinite(parsedSwap) && parsedSwap >= 0));
 const buildValid = Number.isFinite(parsedPort) && parsedPort >= 1 && parsedPort <= 65535;
 const startupValid = !templateVariables.some((variable) => {
 if (!variable.required) return false;
 const value = environment[variable.name];
 return value === undefined || value === null || String(value).trim() === '';
 });
 const stepValidMap = {
 details: detailsValid,
 resources: resourcesValid,
 build: buildValid,
 startup: startupValid,
 } as const;
 const canGoNext = stepValidMap[step];
 const canNavigateTo = (targetIndex: number) =>
 targetIndex <= stepIndex || stepOrder.slice(0, targetIndex).every((key) => stepValidMap[key]);
 const disableSubmit =
 mutation.isPending ||
 !detailsValid ||
 !resourcesValid ||
 !buildValid ||
 !startupValid ||
 (networkMode === 'macvlan' && !macvlanInterface);

 if (!canCreateServer) {
 return null;
 }

 const stepNames: Record<(typeof stepOrder)[number], string> = {
 details: t('createServer.steps.details'),
 resources: t('createServer.steps.resources'),
 build: t('createServer.steps.network'),
 startup: t('createServer.steps.startup'),
 };

 return (
 <>
 {/* Fade-only step transition; the deck avoids lateral motion. */}
 <style>{`
 @keyframes step-enter { from { opacity:0 } to { opacity:1 } }
 .step-content-enter { animation: step-enter .18s cubic-bezier(.4,0,.2,1) forwards }
 `}</style>

 <Button
 size="sm"
 className="h-8 rounded-sm px-3 text-mini shadow-none"
 onClick={() => { setStep('details'); setOpen(true); }}
 >
 <Plus className="h-3.5 w-3.5" />
 {t('createServer.newServer')}
 </Button>

 <Dialog open={open} onOpenChange={setOpen}>
 <DialogContent size="2xl">
 <DialogHeader icon={<Plus className="h-4 w-4" />}>
 <DialogTitle>{t('createServer.title')}</DialogTitle>
 <DialogDescription>{t('createServer.description')}</DialogDescription>
 </DialogHeader>

 {/* Step rail — segmented, square markers, signal underline for the active step */}
 <DialogToolbar>
 <div className="flex items-center gap-1">
 {stepOrder.map((key, index) => {
 const isActive = step === key;
 const isCompleted = stepValidMap[key] && stepIndex > index;
 const canNavigate = canNavigateTo(index);
 return (
 <div key={key} className="flex min-w-0 flex-1 items-center gap-1">
 <button
 type="button"
 disabled={!canNavigate}
 onClick={() => { if (canNavigate) setStep(key); }}
 className={cn(
 'relative flex h-7 min-w-0 items-center gap-1.5 px-1.5 text-mini transition-colors sm:px-2',
 canNavigate ? 'cursor-pointer' : 'cursor-not-allowed opacity-40',
 isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
 )}
 >
 {isActive && (
 <span className="absolute inset-x-1 bottom-0 h-[2px] bg-primary" aria-hidden />
 )}
 <span
 className={cn(
 'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm font-mono text-micro tabular-nums',
 isActive
 ? 'bg-primary text-primary-foreground'
 : isCompleted
 ? 'bg-success/15 text-success'
 : 'border border-border/60 text-muted-foreground',
 )}
 >
 {isCompleted ? (
 <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/></svg>
 ) : (
 index + 1
 )}
 </span>
 <span className="truncate">{stepNames[key]}</span>
 </button>
 {index < stepOrder.length - 1 && (
 <span className="h-4 w-px shrink-0 bg-border/60" aria-hidden />
 )}
 </div>
 );
 })}
 </div>
 </DialogToolbar>

 {/* Content Area */}
 <DialogBody>
 <div key={step} className="step-content-enter">
 <div className="space-y-3">

 {/* --- DETAILS STEP --- */}
 {step === 'details' ? (
 <div className="space-y-3">
 <div className={`${blockClass} space-y-3`}>
 <label className="block space-y-1.5">
 <span className="type-overline">{t('createServer.fields.name')}</span>
 <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="my-awesome-server"/>
 </label>
 <label className="block space-y-1.5">
 <span className="type-overline">{t('createServer.fields.description')} <span className="text-micro font-normal text-muted-foreground">{t('createServer.fields.optional')}</span></span>
 <textarea rows={3} className={textareaClass} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('createServer.fields.descriptionPlaceholder')}/>
 </label>
 </div>
 <div className={`${blockClass} space-y-3`}>
 <div className="grid gap-3 sm:grid-cols-2">
 <div className="space-y-1.5">
 <span className="type-overline">{t('createServer.fields.template')}</span>
 <Combobox value={templateId} onChange={(newTemplateId) => { setTemplateId(newTemplateId); setImageVariant(''); const template = templates.find((t) => t.id === newTemplateId); if (template?.variables) { const defaultEnv: Record<string, string> = {}; template.variables.filter((v) => v.name !== 'SERVER_DIR').forEach((v) => { defaultEnv[v.name] = v.default; }); setEnvironment(defaultEnv); } else { setEnvironment({}); } }} options={templates.map((t) => ({ value: t.id, label: t.name, keywords: [t.name, t.description || ''].filter(Boolean) }))} placeholder={t('createServer.fields.templatePlaceholder')} searchPlaceholder={t('createServer.fields.templateSearchPlaceholder')} className={fieldClass}/>
 </div>
 <div className="space-y-1.5">
 <span className="type-overline">{t('createServer.fields.node')}</span>
 <Combobox value={nodeId} onChange={(newNodeId) => setNodeId(newNodeId)} options={availableNodes.map((n) => ({ value: n.id, label: n.name, keywords: [n.name] }))} placeholder={t('createServer.fields.nodePlaceholder')} searchPlaceholder={t('createServer.fields.nodeSearchPlaceholder')} className={fieldClass}/>
 </div>
 </div>
 {selectedTemplate?.images?.length ? (
 <label className="block space-y-1.5">
 <span className="type-overline">{t('createServer.fields.imageVariant')}</span>
 <select className={fieldClass} value={imageVariant} onChange={(e) => setImageVariant(e.target.value)}>
 <option value="">{t('createServer.fields.useDefaultImage')}</option>
 {selectedTemplate.images.map((option) => (<option key={option.name} value={option.name}>{option.label ?? option.name}</option>))}
 </select>
 </label>
 ) : null}
 </div>
 </div>
 ) : null}

 {/* --- RESOURCES STEP --- */}
 {step === 'resources' ? (
 <div className={`${blockClass} space-y-3`}>
 <BracketLabel>{t('createServer.resources.title')}</BracketLabel>
 <div className="grid gap-3 sm:grid-cols-3">
 <label className="block space-y-1.5">
 <span className="type-overline">{t('fields.memoryMb')}</span>
 <input className={monoFieldClass} value={memory} onChange={(e) => setMemory(e.target.value)} type="number" min={256}/>
 </label>
 <label className="block space-y-1.5">
 <span className="type-overline">{t('fields.cpuCores')}</span>
 <input className={monoFieldClass} value={cpu} onChange={(e) => setCpu(e.target.value)} type="number" min={1} step={1}/>
 </label>
 <label className="block space-y-1.5">
 <span className="type-overline">{t('fields.diskMb')}</span>
 <input className={monoFieldClass} value={disk} onChange={(e) => setDisk(e.target.value)} type="number" min={1024} step={1024}/>
 </label>
 <label className="block space-y-1.5">
 <span className="type-overline">{t('fields.swapMb')}</span>
 <input className={monoFieldClass} value={allocatedSwapMb} onChange={(e) => setAllocatedSwapMb(e.target.value)} type="number" min={0} step={128}/>
 <p className="type-meta">{t('fields.leaveBlankDefaults')}</p>
 </label>
 <label className="block space-y-1.5">
 <span className="type-overline">{t('fields.backupMb')}</span>
 <input className={monoFieldClass} value={backupAllocationMb} onChange={(e) => setBackupAllocationMb(e.target.value)} type="number" min={0} step={128}/>
 <p className="type-meta">{t('fields.leaveBlankDefaults')}</p>
 </label>
 <label className="block space-y-1.5">
 <span className="type-overline">{t('fields.databaseAllocation')}</span>
 <input className={monoFieldClass} value={databaseAllocation} onChange={(e) => setDatabaseAllocation(e.target.value)} type="number" min={0} step={1}/>
 <p className="type-meta">{t('fields.leaveBlankDefaults')}</p>
 </label>
 </div>
 </div>
 ) : null}

 {/* --- NETWORK STEP --- */}
 {step === 'build' ? (
 <div className="space-y-3">
 <div className={`${blockClass} space-y-3`}>
 <label className="block space-y-1.5">
 <span className="type-overline">{t('fields.networkMode')}</span>
 <select className={fieldClass} value={networkMode} onChange={(e) => setNetworkMode(e.target.value)}>
 <option value="host">{t('networkModes.host')}</option>
 <option value="macvlan">{t('networkModes.macvlan')}</option>
 </select>
 </label>
 <div className="border-t border-border/50 pt-3">
 <label className="block space-y-1.5">
 <span className="type-overline">{t('createServer.network.primaryPort')}</span>
 <input className={cn(monoFieldClass, 'disabled:opacity-50')} value={port} onChange={(e) => setPort(e.target.value)} type="number" min={1024} max={65535} readOnly={networkMode === 'host'} disabled={networkMode === 'host'}/>
 <p className="type-meta">{networkMode === 'host' ? t('createServer.network.primaryPortFromAllocation') : t('createServer.network.primaryPortHint')}</p>
 </label>
 </div>
 </div>

 {networkMode === 'macvlan' ? (
 <div className={`${blockClass} space-y-3`}>
 <BracketLabel>{t('createServer.network.macvlanTitle')}</BracketLabel>
 <label className="block space-y-1.5">
 <span className="type-overline">{t('createServer.network.interface')}</span>
 <select className={fieldClass} value={macvlanInterface} onChange={(e) => setMacvlanInterface(e.target.value)}>
 <option value="">{t('createServer.network.selectInterface')}</option>
 {nodeIpPools.map((pool) => (<option key={pool.id} value={pool.networkName}>{t('createServer.network.interfaceOption', { network: pool.networkName, cidr: pool.cidr, count: pool.availableCount })}</option>))}
 </select>
 </label>
 {nodeIpPools.length === 0 && nodeId ? (<p className="type-meta">{t('createServer.network.noInterfaces')}</p>) : null}
 {macvlanInterface ? (
 <label className="block space-y-1.5 border-t border-border/50 pt-3">
 <span className="type-overline">{t('createServer.network.ipAllocation')}</span>
 <select className={cn(fieldClass, 'font-mono')} value={primaryIp} onChange={(e) => setPrimaryIp(e.target.value)}>
 <option value="">{t('fields.autoAssign')}</option>
 {availableIps.map((ip) => (<option key={ip} value={ip}>{ip}</option>))}
 </select>
 {ipLoadError ? (<p className="text-micro text-warning">{ipLoadError}</p>) : null}
 {!ipLoadError && availableIps.length === 0 ? (<p className="type-meta">{t('fields.noIps')}</p>) : null}
 </label>
 ) : null}
 </div>
 ) : null}

 {networkMode === 'host' ? (
 <div className="space-y-3">
 <div className={`${blockClass} space-y-3`}>
 <div>
 <BracketLabel>{t('createServer.network.primaryAllocation')}</BracketLabel>
 <p className="type-meta mt-1">{t('createServer.network.primaryAllocationHint')}</p>
 </div>
 <label className="block space-y-1.5 border-t border-border/50 pt-3">
 <span className="type-overline">{t('createServer.network.allocation')}</span>
 <div className="flex flex-col gap-2 sm:flex-row">
 <select className={cn(fieldClass, 'font-mono sm:flex-1')} value={allocationId} onChange={(event) => setAllocationId(event.target.value)}>
 <option value="">{t('fields.selectAllocation')}</option>
 {availableAllocations.map((allocation) => (<option key={allocation.id} value={allocation.id}>{allocation.ip}:{allocation.port}{allocation.alias ? ` (${allocation.alias})` : ''}</option>))}
 </select>
 <a href={`/admin/nodes/${nodeId}/allocations`} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-sm border border-border/60 px-2.5 text-mini text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground" title={t('createServer.network.createAllocationsHint')}>
 <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg> {t('createServer.network.newAllocation')}
 </a>
 </div>
 </label>
 {allocLoadError ? (<p className="text-micro text-warning">{allocLoadError}</p>) : null}
 {!allocLoadError && availableAllocations.length === 0 ? (
 <p className="type-meta">{t('fields.noAllocations')}{' '}<a href={`/admin/nodes/${nodeId}/allocations`} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">{t('fields.createOne')}</a></p>
 ) : null}
 </div>

 <div className={`${blockClass} space-y-3`}>
 <div>
 <BracketLabel>{t('createServer.network.additionalBindings')}</BracketLabel>
 <p className="type-meta mt-1">{t('createServer.network.additionalBindingsHint')}</p>
 </div>
 <div className="space-y-2 border-t border-border/50 pt-3">
 {additionalBindings.map((binding, index) => (
 <div key={`${binding.allocationId}-${index}`} className="flex flex-col gap-2 sm:flex-row">
 <select className={cn(fieldClass, 'font-mono sm:flex-1')} value={binding.allocationId} onChange={(event) => { const next = [...additionalBindings]; const allocation = availableAllocations.find((a) => a.id === event.target.value); next[index] = { allocationId: event.target.value, containerPort: allocation ? String(allocation.port) : binding.containerPort }; setAdditionalBindings(next); }}>
 <option value="">{t('fields.selectAllocation')}</option>
 {availableAllocations.filter((a) => a.id !== allocationId && !additionalBindings.some((b, i) => i !== index && b.allocationId === a.id)).map((allocation) => (<option key={allocation.id} value={allocation.id}>{allocation.ip}:{allocation.port}{allocation.alias ? ` (${allocation.alias})` : ''}</option>))}
 </select>
 <div className="flex gap-2">
 <input className={cn(monoFieldClass, 'sm:w-24')} type="number" min={1} max={65535} value={binding.containerPort} onChange={(event) => { const next = [...additionalBindings]; next[index] = { ...next[index], containerPort: event.target.value }; setAdditionalBindings(next); }} placeholder={t('createServer.network.portPlaceholder')}/>
 <button type="button" className="h-8 shrink-0 rounded-sm border border-danger/30 px-2.5 text-mini font-medium text-danger transition-colors hover:border-danger/50 hover:bg-danger/10" onClick={() => { setAdditionalBindings(additionalBindings.filter((_, i) => i !== index)); }}>{t('common:actions.remove')}</button>
 </div>
 </div>
 ))}
 <button type="button" className="h-8 rounded-sm border border-dashed border-border/60 px-3 text-mini font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground" onClick={() => setAdditionalBindings([...additionalBindings, { allocationId: '', containerPort: '' }])}>
 {t('createServer.network.addBinding')}
 </button>
 </div>
 </div>
 </div>
 ) : null}
 </div>
 ) : null}

 {/* --- STARTUP STEP --- */}
 {step === 'startup' ? (
 templateVariables.length > 0 ? (
 <div className={`${blockClass} space-y-3`}>
 <BracketLabel>{t('createServer.startup.environmentVariables')}</BracketLabel>
 {templateVariables.map((variable) => (
 <label key={variable.name} className="block space-y-1.5">
 <span className="font-mono text-micro text-muted-foreground">{variable.name}{variable.required ? <span className="ml-1 text-danger">*</span> : null}</span>
 {variable.description ? (<p className="type-meta">{variable.description}</p>) : null}
 {variable.input === 'checkbox' ? (
 <input type="checkbox" className="h-4 w-4 rounded-sm border-border/60 bg-background/40 text-primary focus:ring-1 focus:ring-primary/40 focus:ring-offset-0" checked={environment[variable.name] === 'true' || environment[variable.name] === '1'} onChange={(e) => { const useNumeric = variable.default === '1' || variable.default === '0'; setEnvironment((prev) => ({ ...prev, [variable.name]: e.target.checked ? (useNumeric ? '1' : 'true') : (useNumeric ? '0' : 'false') })); }}/>
 ) : (
 <input className={variable.input === 'number' ? monoFieldClass : fieldClass} type={variable.input === 'number' ? 'number' : 'text'} value={environment[variable.name] || ''} onChange={(e) => setEnvironment((prev) => ({ ...prev, [variable.name]: e.target.value }))} placeholder={variable.default}/>
 )}
 </label>
 ))}
 </div>
 ) : (
 <div className="rounded-sm border border-border/50 bg-surface-1/40 px-3 py-2.5 text-mini text-muted-foreground">{t('createServer.startup.noVariables')}</div>
 )
 ) : null}

 </div>
 </div>
 </DialogBody>

 <DialogFooter className="sm:justify-between">
 <Button variant="outline" size="sm" className="h-8 px-3 text-mini" onClick={() => setOpen(false)}>
 {t('common:actions.cancel')}
 </Button>
 <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
 {stepIndex > 0 ? (
 <Button variant="outline" size="sm" className="h-8 px-3 text-mini" onClick={() => setStep(stepOrder[stepIndex - 1])}>
 {t('common:actions.back')}
 </Button>
 ) : null}
 {stepIndex < stepOrder.length - 1 ? (
 <Button size="sm" className="h-8 px-3 text-mini disabled:bg-surface-3 disabled:text-muted-foreground" onClick={() => setStep(stepOrder[stepIndex + 1])} disabled={!canGoNext}>
 {t('common:actions.next')}
 </Button>
 ) : (
 <Button size="sm" className="h-8 px-3 text-mini disabled:bg-surface-3 disabled:text-muted-foreground" onClick={() => mutation.mutate()} disabled={disableSubmit}>
 {mutation.isPending ? t('createServer.creating') : t('createServer.submit')}
 </Button>
 )}
 </div>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 </>
 );
}

export default CreateServerModal;
