import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@/csync';
import { Download, Loader2, Server, X } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { StatusLed } from '../deck/primitives';
import { nodesApi } from '../../services/api/nodes';
import { templatesApi } from '../../services/api/templates';
import { adminApi } from '../../services/api/admin';
import { qk } from '../../lib/queryKeys';
import { notifyError, notifySuccess } from '../../utils/notify';
import {
 Dialog,
 DialogContent,
 DialogHeader,
 DialogBody,
 DialogFooter,
 DialogTitle,
 DialogDescription,
} from '@/components/ui/dialog';
import Combobox from '@/components/ui/combobox';

export interface UnregisteredContainer {
 containerId: string;
 image: string;
 status: string;
 labels: Record<string, string>;
 networkMode?: string;
 memoryLimitMb?: number;
 cpuCores?: number;
 startupCommand?: string;
 envVarNames?: string[];
 discoveredAt: number;
}

interface ServerImportModalProps {
 open: boolean;
 onClose: () => void;
 nodeId: string;
 containers: UnregisteredContainer[];
}

export default function ServerImportModal({
 open,
 onClose,
 nodeId,
 containers,
}: ServerImportModalProps) {
 const { t } = useTranslation('nodes');
 const queryClient = useQueryClient();
 const [importingId, setImportingId] = useState<string | null>(null);
 const [formState, setFormState] = useState<Record<string, {
 name: string;
 templateId: string;
 ownerId: string;
 allocatedMemoryMb: string;
 allocatedCpuCores: string;
 allocatedDiskMb: string;
 primaryPort: string;
 }>>({});

 // Template suggestions fetched from backend matching
 const [suggestions, setSuggestions] = useState<Record<string, Array<{
 templateId: string;
 templateName: string;
 score: number;
 matchReasons: string[];
 }>>>({});

 // Fetch templates for dropdown
 const { data: templates = [] } = useQuery({
 queryKey: qk.templates(),
 queryFn: () => templatesApi.list(),
 enabled: open,
 staleTime: 5 * 60 * 1000,
 });

 // Fetch users for owner dropdown
 const { data: usersData } = useQuery({
 queryKey: qk.adminUsers(),
 queryFn: () => adminApi.listUsers(),
 enabled: open,
 staleTime: 5 * 60 * 1000,
 });
 const users = usersData?.users ?? [];

 const templateOptions = templates.map((t: any) => ({
 value: t.id,
 label: t.name,
 }));

 const userOptions = users.map((u: any) => ({
 value: u.id,
 label: u.email || u.name || u.id,
 }));

 const importMutation = useMutation({
 mutationFn: async (containerId: string) => {
 const form = formState[containerId];
 if (!form?.name || !form?.templateId || !form?.ownerId) {
 throw new Error(t('import.required'));
 }
 return nodesApi.importServer(nodeId, {
 containerId,
 name: form.name,
 templateId: form.templateId,
 ownerId: form.ownerId,
 allocatedMemoryMb: form.allocatedMemoryMb ? Number(form.allocatedMemoryMb) : undefined,
 allocatedCpuCores: form.allocatedCpuCores ? Number(form.allocatedCpuCores) : undefined,
 allocatedDiskMb: form.allocatedDiskMb ? Number(form.allocatedDiskMb) : undefined,
 primaryPort: form.primaryPort ? Number(form.primaryPort) : undefined,
 });
 },
 onSuccess: () => {
 notifySuccess(t('import.success'));
 setImportingId(null);
 setFormState((prev) => {
 const next = { ...prev };
 delete next[importingId!];
 return next;
 });
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.node(nodeId) });
 queryClient.invalidateQueries({ queryKey: qk.nodeStats(nodeId) });
 queryClient.invalidateQueries({ queryKey: qk.unregisteredContainers(nodeId) });
 queryClient.invalidateQueries({ queryKey: qk.servers() });
 queryClient.invalidateQueries({ queryKey: qk.adminServers() });
 },
 onError: (error: unknown) => {
   notifyError(error, 'nodes:import.error');
 setImportingId(null);
 },
 });


 const fetchSuggestions = async (containerId: string) => {
 try {
 const results = await nodesApi.suggestTemplate(nodeId, containerId);
 setSuggestions((prev) => ({ ...prev, [containerId]: results }));
 // Auto-select top suggestion if no template selected yet
 const form = getForm(containerId);
 if (!form.templateId && results.length > 0) {
 updateForm(containerId, { templateId: results[0].templateId });
 }
 } catch {
 // Silently fail — suggestions are optional
 }
 };

 const getForm = (containerId: string) => {
 const container = containers.find((c) => c.containerId === containerId);
 return (
 formState[containerId] ?? {
 name: '',
 templateId: '',
 ownerId: '',
 allocatedMemoryMb: container?.memoryLimitMb?.toString() ?? '',
 allocatedCpuCores: container?.cpuCores?.toString() ?? '',
 allocatedDiskMb: '10240',
 primaryPort: '25565',
 }
 );
 };

 const updateForm = (containerId: string, updates: Record<string, string>) => {
 setFormState((prev) => ({
 ...prev,
 [containerId]: { ...getForm(containerId), ...updates },
 }));
 };

 return (
 <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
 <DialogContent size="xl">
 <DialogHeader
 icon={<Download className="h-4 w-4" />}
 iconClassName="border-warning/30 bg-warning/10 text-warning"
 >
 <DialogTitle>{t('import.title')}</DialogTitle>
 <DialogDescription>
 {t('import.description')}
 </DialogDescription>
 </DialogHeader>

 <DialogBody>
 <div className="mb-3 type-meta">
 {t('import.found', { total: containers.length })}
 </div>

 {containers.length === 0 ? (
 <div className="py-8 text-center type-meta">
 {t('import.empty')}
 </div>
 ) : (
 <div className="divide-y divide-border/50">
 {containers.map((container) => {
 const isExpanded = importingId === container.containerId;
 const form = getForm(container.containerId);

 return (
 <div
 key={container.containerId}
 className="py-3"
 >
 <div className="flex items-center justify-between gap-3">
 <div className="flex min-w-0 flex-1 items-center gap-2.5">
 <Server className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
 <div className="min-w-0 overflow-hidden">
 <div className="font-mono text-data font-medium tabular-nums text-foreground">
 {container.containerId}
 </div>
 <div className="flex items-center gap-2 text-micro text-muted-foreground">
 <span className="truncate">{container.image || t('import.unknownImage')}</span>
 <span className="flex shrink-0 items-center gap-1.5">
 <StatusLed
 tone={container.status.includes('Up') ? 'go' : 'idle'}
 pulse={container.status.includes('Up')}
 />
 {container.status.includes('Up') ? t('common:status.running') : t('common:status.stopped')}
 </span>
 {container.networkMode && (
 <Badge
 variant={container.networkMode === 'host' ? 'warning' : 'outline'}
 className="shrink-0 text-micro"
 >
 {container.networkMode === 'host' ? t('import.hostNetwork') : t('import.bridge')}
 </Badge>
 )}
 </div>
 {container.startupCommand && (
 <div className="mt-1 truncate font-mono text-micro text-muted-foreground/60" title={container.startupCommand}>
 {container.startupCommand.length > 120 ? container.startupCommand.slice(0, 120) + '…' : container.startupCommand}
 </div>
 )}
 {container.envVarNames && container.envVarNames.length > 0 && (
 <div className="mt-1 flex flex-wrap gap-1">
 {container.envVarNames.slice(0, 8).map((name) => (
 <span key={name} className="rounded-sm border border-border/50 px-1 py-0.5 font-mono text-micro tabular-nums text-muted-foreground">
 {name}
 </span>
 ))}
 {container.envVarNames.length > 8 && (
 <span className="text-micro text-muted-foreground">{t('import.moreEnvVars', { total: container.envVarNames.length - 8 })}</span>
 )}
 </div>
 )}
 </div>
 </div>
 <Button
 size="sm"
 variant={isExpanded ? 'outline' : 'default'}
 onClick={() => {
 if (isExpanded) {
 setImportingId(null);
 } else {
 setImportingId(container.containerId);
 fetchSuggestions(container.containerId);
 }
 }}
 className="h-8 shrink-0 gap-1.5 px-3 text-mini"
 >
 {isExpanded ? (
 <>
 <X className="h-3 w-3" />
 {t('common:actions.cancel')}
 </>
 ) : (
 <>
 <Download className="h-3 w-3" />
 {t('import.button')}
 </>
 )}
 </Button>
 </div>

 {isExpanded && (
 <div className="mt-3 space-y-3 border-t border-border/50 pt-3">
 <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
 <div>
 <label className="mb-1 block type-overline">{t('import.serverName')}</label>
 <input
 type="text"
 value={form.name}
 onChange={(e) =>
 updateForm(container.containerId, { name: e.target.value })
 }
 placeholder={t('import.namePlaceholder')}
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 />
 </div>
 <div>
 <label className="mb-1 block type-overline">{t('import.template')}</label>
 <Combobox
 options={templateOptions}
 value={form.templateId}
 onChange={(val: string) =>
 updateForm(container.containerId, { templateId: val })
 }
 placeholder={t('import.selectTemplate')}
 />
 {suggestions[container.containerId] && suggestions[container.containerId].length > 0 && (
 <div className="mt-1 flex flex-wrap items-center gap-1">
 <span className="type-overline">{t('import.suggested')}</span>
 {suggestions[container.containerId].slice(0, 3).map((s) => (
 <button
 key={s.templateId}
 type="button"
 onClick={() => updateForm(container.containerId, { templateId: s.templateId })}
 className={`rounded-sm border border-border/50 px-1.5 py-0.5 font-mono text-micro tabular-nums transition-colors ${
 form.templateId === s.templateId
 ? 'bg-primary/10 text-foreground'
 : 'text-muted-foreground hover:text-foreground'
 }`}
 title={s.matchReasons.join('; ')}
 >
 {s.templateName} ({s.score})
 </button>
 ))}
 </div>
 )}
 </div>
 <div>
 <label className="mb-1 block type-overline">{t('import.owner')}</label>
 <Combobox
 options={userOptions}
 value={form.ownerId}
 onChange={(val: string) =>
 updateForm(container.containerId, { ownerId: val })
 }
 placeholder={t('import.selectOwner')}
 />
 </div>
 <div>
 <label className="mb-1 block type-overline">{t('import.primaryPort')}</label>
 <input
 type="number"
 value={form.primaryPort}
 onChange={(e) =>
 updateForm(container.containerId, { primaryPort: e.target.value })
 }
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 font-mono text-mini tabular-nums text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/40"
 />
 </div>
 <div>
 <label className="mb-1 block type-overline">{t('import.memoryMb')}</label>
 <input
 type="number"
 value={form.allocatedMemoryMb}
 onChange={(e) =>
 updateForm(container.containerId, {
 allocatedMemoryMb: e.target.value,
 })
 }
 placeholder="1024"
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 />
 </div>
 <div>
 <label className="mb-1 block type-overline">{t('import.cpuCores')}</label>
 <input
 type="number"
 value={form.allocatedCpuCores}
 onChange={(e) =>
 updateForm(container.containerId, {
 allocatedCpuCores: e.target.value,
 })
 }
 placeholder="1"
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 />
 </div>
 </div>

 <div className="flex justify-end gap-2 pt-1">
 <Button
   size="sm"
   variant="outline"
   className="h-8 px-3 text-mini"
   onClick={() => setImportingId(null)}
 >
   {t('common:actions.cancel')}
 </Button>
 <Button
 size="sm"
 onClick={() => importMutation.mutate(container.containerId)}
 disabled={
 !form.name || !form.templateId || !form.ownerId || importMutation.isPending
 }
 className="h-8 gap-1.5 px-3 text-mini"
 >
 {importMutation.isPending ? (
 <Loader2 className="h-3 w-3 animate-spin" />
 ) : (
 <Download className="h-3 w-3" />
 )}
 {t('import.serverButton')}
 </Button>
 </div>
 </div>
 )}
 </div>
 );
 })}
 </div>
 )}
 </DialogBody>

 <DialogFooter>
 <Button variant="outline" size="sm" className="h-8 px-3 text-mini" onClick={onClose}>
   {t('common:actions.cancel')}
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 );
}
