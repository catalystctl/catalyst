import { useMemo, useRef, useState, useEffect } from 'react';
import type { ChangeEvent } from 'react';
import { useMutation, useQuery } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import {
 FolderOpen,
 ArrowRight,
 SkipForward,
 Upload,
 Link as LinkIcon,
 Loader2,
 Download,
 CheckCircle,
} from 'lucide-react';
import {
 Select,
 SelectContent,
 SelectItem,
 SelectTrigger,
 SelectValue,
} from '../../components/ui/select';
import type { TemplateImageOption, TemplateVariable } from '../../types/template';
import { templatesApi, type BatchImportResult } from '../../services/api/templates';
import { nestsApi } from '../../services/api/nests';
import { notifyError, notifySuccess } from '../../utils/notify';
import { normalizeTemplateImport, parseEggContent } from '../../utils/pterodactylImport';
import TemplateProviderEditor, { extractProviderIds } from './TemplateProviderEditor';
import { ModalPortal } from '@/components/ui/modal-portal';
import { reportSystemError } from '../../services/api/systemErrors';

type VariableDraft = {
 name: string;
 description: string;
 defaultValue: string;
 required: boolean;
 input: TemplateVariable['input'];
 rules: string;
};

const createVariableDraft = (): VariableDraft => ({
 name: '',
 description: '',
 defaultValue: '',
 required: false,
 input: 'text',
 rules: '',
});

function TemplateCreateModal() {
 const [open, setOpen] = useState(false);
 const importFileRef = useRef<HTMLInputElement | null>(null);
 const [name, setName] = useState('');
 const [description, setDescription] = useState('');
 const [author, setAuthor] = useState('');
 const [version, setVersion] = useState('');
 const [image, setImage] = useState('');
 const [installImage, setInstallImage] = useState('');
 const [imageOptions, setImageOptions] = useState<TemplateImageOption[]>([]);
 const [defaultImage, setDefaultImage] = useState('');
 const [startup, setStartup] = useState('');
 const [stopCommand, setStopCommand] = useState('');
 const [sendSignalTo, setSendSignalTo] = useState<'SIGTERM' | 'SIGINT' | 'SIGKILL'>('SIGTERM');
 const [installScript, setInstallScript] = useState('');
 const [configFile, setConfigFile] = useState('');
 const [configFiles, setConfigFiles] = useState<string[]>([]);
 const [supportedPorts, setSupportedPorts] = useState('25565');
 const [allocatedMemoryMb, setAllocatedMemoryMb] = useState('1024');
 const [allocatedCpuCores, setAllocatedCpuCores] = useState('2');
 const [iconUrl, setIconUrl] = useState('');
 const [restartOnExit, setRestartOnExit] = useState(false);
 const [maxInstances, setMaxInstances] = useState('');
 const [backupPaths, setBackupPaths] = useState('');
 const [fileEditorEnabled, setFileEditorEnabled] = useState(true);
 const [fileEditorRestrictedPaths, setFileEditorRestrictedPaths] = useState('');
 const [templateFeatures, setTemplateFeatures] = useState<Record<string, any>>({});
 const [variables, setVariables] = useState<VariableDraft[]>([createVariableDraft()]);
 const [importError, setImportError] = useState('');
 const [modManagerEnabled, setModManagerEnabled] = useState(false);
 const [modProviders, setModProviders] = useState<string[]>([]);
 const [pluginManagerEnabled, setPluginManagerEnabled] = useState(false);
 const [pluginProviders, setPluginProviders] = useState<string[]>([]);
 const [nestId, setNestId] = useState('');
 const [step, setStep] = useState<1 | 2>(1);
 const [importModalOpen, setImportModalOpen] = useState(false);
 const [importUrl, setImportUrl] = useState('');
 const [importUrlLoading, setImportUrlLoading] = useState(false);
 const [importUrlError, setImportUrlError] = useState('');
 const [batchImportLoading, setBatchImportLoading] = useState(false);
 const [batchImportResult, setBatchImportResult] = useState<BatchImportResult | null>(null);

 // Re-open this modal when a nests manager sends the user back after creating a nest
 // If a nest was just created, auto-select it and jump to step 2 (preserves imported data)
 useEffect(() => {
 const handler = (e: Event) => {
 const detail = (e as CustomEvent).detail;
 const createdId = detail?.createdId as string | undefined;
 setOpen(true);
 if (createdId) {
 setNestId(createdId);
 setStep(2);
 } else {
 setStep(1);
 }
 };
 window.addEventListener('catalyst:return-to-template-create', handler);
 return () => window.removeEventListener('catalyst:return-to-template-create', handler);
 }, []);

 const { data: nests = [] } = useQuery({
 queryKey: qk.nests(),
 queryFn: nestsApi.list,
 staleTime: 5 * 60 * 1000,
 });

 const parsedPorts = useMemo(
 () =>
 supportedPorts
 .split(',')
 .map((entry) => Number(entry.trim()))
 .filter((value) => Number.isFinite(value) && value > 0),
 [supportedPorts],
 );

 const buildVariables = () =>
 variables
 .filter((variable) => variable.name.trim())
 .map((variable) => ({
 name: variable.name.trim(),
 description: variable.description.trim() || undefined,
 default: variable.defaultValue,
 required: variable.required,
 input: variable.input,
 rules: variable.rules
 .split(';')
 .map((rule) => rule.trim())
 .filter(Boolean),
 }));

 const buildTemplatePayload = (raw: unknown) => {
 const payload = normalizeTemplateImport(raw);
 const toNumber = (value: unknown, fallback: number) => {
 const parsed = Number(value);
 return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
 };
 const ports = Array.isArray(payload.supportedPorts)
 ? (payload.supportedPorts as unknown[])
 .map((port) => Number(port))
 .filter((value) => Number.isFinite(value) && value > 0)
 : [];
 const variablesPayload = Array.isArray(payload.variables)
 ? (payload.variables as Record<string, unknown>[])
 .map((variable) => ({
 name: String(variable?.name ?? '').trim(),
 description: variable?.description ? String(variable.description) : undefined,
 default: String(variable?.default ?? ''),
 required: Boolean(variable?.required),
 input: (variable?.input as TemplateVariable['input']) ?? 'text',
 rules: Array.isArray(variable?.rules) ? (variable.rules as string[]) : undefined,
 }))
 .filter((variable: TemplateVariable) => variable.name)
 : [];
 const imagesPayload = Array.isArray(payload.images)
 ? (payload.images as Record<string, unknown>[])
 .map((option) => ({
 name: String(option?.name ?? '').trim(),
 label: option?.label ? String(option.label) : undefined,
 image: String(option?.image ?? '').trim(),
 }))
 .filter((option: TemplateImageOption) => option.name && option.image)
 : [];

 return {
 name: String(payload.name ?? ''),
 description: payload.description ? String(payload.description) : undefined,
 author: String(payload.author ?? ''),
 version: String(payload.version ?? ''),
 image: String(payload.image ?? ''),
 images: imagesPayload,
 defaultImage: payload.defaultImage ? String(payload.defaultImage) : undefined,
 installImage: payload.installImage ? String(payload.installImage) : undefined,
 startup: String(payload.startup ?? ''),
 stopCommand: String(payload.stopCommand ?? ''),
 sendSignalTo:
 payload.sendSignalTo === 'SIGKILL'
 ? 'SIGKILL'
 : payload.sendSignalTo === 'SIGINT'
 ? 'SIGINT'
 : 'SIGTERM',
 variables: variablesPayload,
 installScript: payload.installScript ? String(payload.installScript) : undefined,
 supportedPorts: ports.length ? ports : [25565],
 allocatedMemoryMb: toNumber(payload.allocatedMemoryMb, 1024),
 allocatedCpuCores: toNumber(payload.allocatedCpuCores, 2),
 features: (() => {
 const features = (payload.features ?? {}) as Record<string, unknown>;
 return {
 ...templateFeatures,
 ...(payload.features ?? {}),
 ...(features.iconUrl ? { iconUrl: String(features.iconUrl) } : {}),
 ...(features.configFile ? { configFile: String(features.configFile) } : {}),
 ...(Array.isArray(features.configFiles) ? { configFiles: features.configFiles } : {}),
 ...(features.restartOnExit ? { restartOnExit: Boolean(features.restartOnExit) } : {}),
 ...(features.maxInstances ? { maxInstances: Number(features.maxInstances) } : {}),
 ...(Array.isArray(features.backupPaths) ? { backupPaths: features.backupPaths } : {}),
 ...(features.fileEditor
 ? (() => {
 const fe = features.fileEditor as Record<string, unknown>;
 return {
 fileEditor: {
 enabled: Boolean(fe.enabled),
 ...(Array.isArray(fe.restrictedPaths)
 ? { restrictedPaths: fe.restrictedPaths }
 : {}),
 },
 };
 })()
 : {}),
 };
 })(),
 };
 };

 const mutation = useMutation({
 mutationFn: () =>
 templatesApi.create({
 name,
 description: description || undefined,
 author,
 version,
 image,
 images: imageOptions.filter((option) => option.name && option.image),
 defaultImage: defaultImage || undefined,
 installImage: installImage || undefined,
 startup,
 stopCommand,
 sendSignalTo,
 variables: buildVariables(),
 installScript: installScript || undefined,
 supportedPorts: parsedPorts,
 allocatedMemoryMb: Number(allocatedMemoryMb),
 allocatedCpuCores: Number(allocatedCpuCores),
 features: {
 ...templateFeatures,
 ...(iconUrl ? { iconUrl } : {}),
 ...(configFile ? { configFile } : {}),
 ...(configFiles.length ? { configFiles } : {}),
 ...(restartOnExit ? { restartOnExit } : {}),
 ...(maxInstances ? { maxInstances: Number(maxInstances) } : {}),
 ...(backupPaths
 ? {
 backupPaths: backupPaths
 .split(',')
 .map((p) => p.trim())
 .filter(Boolean),
 }
 : {}),
 ...(fileEditorEnabled
 ? {
 fileEditor: {
 enabled: fileEditorEnabled,
 ...(fileEditorRestrictedPaths
 ? {
 restrictedPaths: fileEditorRestrictedPaths
 .split(',')
 .map((p) => p.trim())
 .filter(Boolean),
 }
 : {}),
 },
 }
 : { fileEditor: { enabled: false } }),
 ...(modManagerEnabled && modProviders.length
 ? {
 modManager: { providers: modProviders },
 }
 : {}),
 ...(pluginManagerEnabled && pluginProviders.length
 ? {
 pluginManager: { providers: pluginProviders },
 }
 : {}),
 },
 ...(nestId ? { nestId } : {}),
 }),
 onSuccess: () => {
 notifySuccess('Template created');
 setOpen(false);
 setName('');
 setDescription('');
 setAuthor('');
 setVersion('');
 setImage('');
 setInstallImage('');
 setImageOptions([]);
 setDefaultImage('');
 setStartup('');
 setStopCommand('');
 setSendSignalTo('SIGTERM');
 setInstallScript('');
 setConfigFile('');
 setConfigFiles([]);
 setSupportedPorts('25565');
 setAllocatedMemoryMb('1024');
 setAllocatedCpuCores('2');
 setIconUrl('');
 setRestartOnExit(false);
 setMaxInstances('');
 setBackupPaths('');
 setFileEditorEnabled(true);
 setFileEditorRestrictedPaths('');
 setTemplateFeatures({});
 setModManagerEnabled(false);
 setModProviders([]);
 setPluginManagerEnabled(false);
 setPluginProviders([]);
 setNestId('');
 setVariables([createVariableDraft()]);
 setImportError('');
 },
 onError: (error: any) => {
 const message = error?.response?.data?.error || 'Failed to create template';
 notifyError(message);
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.templates() });
 queryClient.invalidateQueries({ queryKey: qk.nests() });
 },
 });

 const applyTemplateImport = (raw: unknown) => {
 if (!raw || typeof raw !== 'object') {
 setImportError('Invalid template JSON');
 return;
 }
 const payload = normalizeTemplateImport(raw);
 setImportError('');
 setName(String(payload.name ?? ''));
 setDescription(String(payload.description ?? ''));
 setAuthor(String(payload.author ?? ''));
 setVersion(String(payload.version ?? ''));
 setImage(String(payload.image ?? ''));
 setImageOptions(
 Array.isArray(payload.images)
 ? (payload.images as Record<string, unknown>[]).map((option) => ({
 name: String(option?.name ?? ''),
 label: option?.label ? String(option.label) : undefined,
 image: String(option?.image ?? ''),
 }))
 : [],
 );
 setDefaultImage(String(payload.defaultImage ?? ''));
 setInstallImage(String(payload.installImage ?? ''));
 setStartup(String(payload.startup ?? ''));
 setStopCommand(String(payload.stopCommand ?? ''));
 setSendSignalTo(
 payload.sendSignalTo === 'SIGKILL'
 ? 'SIGKILL'
 : payload.sendSignalTo === 'SIGINT'
 ? 'SIGINT'
 : 'SIGTERM',
 );
 setInstallScript(String(payload.installScript ?? ''));
 const features = (payload.features ?? {}) as Record<string, unknown>;
 setConfigFile(String(features.configFile ?? ''));
 setConfigFiles(
 Array.isArray(features.configFiles)
 ? (features.configFiles as unknown[]).map(String)
 : features.configFile
 ? [String(features.configFile)]
 : [],
 );
 setSupportedPorts(
 Array.isArray(payload.supportedPorts)
 ? (payload.supportedPorts as unknown[]).join(', ')
 : '25565',
 );
 setAllocatedMemoryMb(payload.allocatedMemoryMb ? String(payload.allocatedMemoryMb) : '1024');
 setAllocatedCpuCores(payload.allocatedCpuCores ? String(payload.allocatedCpuCores) : '2');
 setIconUrl(String(features.iconUrl ?? ''));
 setRestartOnExit(Boolean(features.restartOnExit));
 setMaxInstances(String(features.maxInstances ?? ''));
 setBackupPaths(
 Array.isArray(features.backupPaths) ? (features.backupPaths as unknown[]).join(', ') : '',
 );
 setFileEditorEnabled(features.fileEditor !== false);
 const fileEditor = features.fileEditor as Record<string, unknown> | undefined;
 setFileEditorRestrictedPaths(
 Array.isArray(fileEditor?.restrictedPaths)
 ? (fileEditor.restrictedPaths as unknown[]).join(', ')
 : '',
 );
 setTemplateFeatures(payload.features ?? {});
 setModManagerEnabled(!!features.modManager);
 setModProviders(extractProviderIds((features.modManager as any)?.providers));
 setPluginManagerEnabled(!!features.pluginManager);
 setPluginProviders(extractProviderIds((features.pluginManager as any)?.providers));
 const importedVariables = Array.isArray(payload.variables)
 ? (payload.variables as Record<string, unknown>[]).map((variable) => ({
 name: String(variable?.name ?? ''),
 description: String(variable?.description ?? ''),
 defaultValue: String(variable?.default ?? ''),
 required: Boolean(variable?.required),
 input: (variable?.input as TemplateVariable['input']) ?? 'text',
 rules: Array.isArray(variable?.rules) ? (variable.rules as string[]).join('; ') : '',
 }))
 : [];
 setVariables(importedVariables.length ? importedVariables : [createVariableDraft()]);
 };

 const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
 const files = Array.from(event.target.files ?? []);
 if (!files.length) return;
 setImportError('');
 if (files.length === 1) {
 setStep(1);
 setOpen(true);
 const reader = new FileReader();
 reader.onload = () => {
 try {
 const content = String(reader.result || '');
 const parsed = parseEggContent(content);
 if (!parsed) {
 setImportError('Failed to parse file (must be JSON or YAML)');
 return;
 }
 applyTemplateImport(parsed);
 } catch (error) {
 reportSystemError({
 level: 'error',
 component: 'TemplateCreateModal',
 message: error instanceof Error ? error.message : String(error),
 stack: error instanceof Error ? error.stack : undefined,
 metadata: { context: 'parse import file' },
 });
 setImportError('Failed to parse file (must be JSON or YAML)');
 }
 };
 reader.onerror = () => {
 setImportError('Unable to read file');
 };
 reader.readAsText(files[0]);
 event.target.value = '';
 return;
 }

 setOpen(false);
 const results = await Promise.all(
 files.map(async (file) => {
 try {
 const text = await file.text();
 const parsed = parseEggContent(text);
 if (!parsed) return { ok: false };
 const payload = buildTemplatePayload(parsed);
 await templatesApi.create(payload);
 return { ok: true };
 } catch (error) {
 reportSystemError({
 level: 'error',
 component: 'TemplateCreateModal',
 message: error instanceof Error ? error.message : String(error),
 stack: error instanceof Error ? error.stack : undefined,
 metadata: { context: 'import template file' },
 });
 return { ok: false };
 }
 }),
 );
 const successCount = results.filter((result) => result.ok).length;
 const failureCount = results.length - successCount;
 if (successCount) {
 notifySuccess(`Imported ${successCount} template${successCount === 1 ? '' : 's'}`);
 queryClient.invalidateQueries({ queryKey: qk.templates() });
 queryClient.invalidateQueries({ queryKey: qk.nests() });
 }
 if (failureCount) {
 notifyError(`${failureCount} template${failureCount === 1 ? '' : 's'} failed to import`);
 }
 event.target.value = '';
 };

 const handleImportUrl = async () => {
 const url = importUrl.trim();
 if (!url) return;
 setImportUrlLoading(true);
 setImportUrlError('');
 try {
 const response = await fetch(url);
 if (!response.ok) {
 reportSystemError({ level: 'error', component: 'TemplateCreateModal', message: `HTTP ${response.status}`, metadata: { context: 'handleImportUrl' } });
 throw new Error(`HTTP ${response.status}`);
 }
 const content = await response.text();
 const parsed = parseEggContent(content);
 if (!parsed) {
 setImportUrlError('Failed to parse — the URL must return valid JSON or YAML.');
 setImportUrlLoading(false);
 return;
 }
 setImportModalOpen(false);
 setImportUrl('');
 setStep(1);
 setOpen(true);
 applyTemplateImport(parsed);
 } catch (error: any) {
 reportSystemError({
 level: 'error',
 component: 'TemplateCreateModal',
 message: error instanceof Error ? error.message : String(error),
 stack: error instanceof Error ? error.stack : undefined,
 metadata: { context: 'fetch import URL' },
 });
 setImportUrlError(error?.message || 'Failed to fetch the URL. Check the link and try again.');
 } finally {
 setImportUrlLoading(false);
 }
 };

 const handleBatchImport = async () => {
 setBatchImportLoading(true);
 setBatchImportResult(null);
 try {
 const result = await templatesApi.importPterodactylBatch();
 setBatchImportResult(result ?? null);
 if (result) {
 queryClient.invalidateQueries({ queryKey: qk.templates() });
 queryClient.invalidateQueries({ queryKey: qk.nests() });
 }
 } catch (error: any) {
 reportSystemError({
 level: 'error',
 component: 'TemplateCreateModal',
 message: error?.message || 'Batch import failed',
 metadata: { context: 'handleBatchImport' },
 });
 notifyError(error?.response?.data?.error || 'Failed to import Pterodactyl eggs');
 } finally {
 setBatchImportLoading(false);
 }
 };

 // Signal-based stops don't require a stop command
 const usingSignalStop = sendSignalTo === 'SIGINT' || sendSignalTo === 'SIGKILL';

 const disableSubmit =
 !name ||
 !author ||
 !version ||
 !image ||
 !startup ||
 (!stopCommand.trim() && !usingSignalStop) ||
 !parsedPorts.length ||
 !Number(allocatedMemoryMb) ||
 !Number(allocatedCpuCores) ||
 mutation.isPending;

 // Compute missing required fields for display
 const missingFields: string[] = useMemo(() => {
 const isSignalStop = sendSignalTo === 'SIGINT' || sendSignalTo === 'SIGKILL';
 const missing: string[] = [];
 if (!name) missing.push('Name');
 if (!author) missing.push('Author');
 if (!version) missing.push('Version');
 if (!image) missing.push('Container image');
 if (!startup) missing.push('Startup command');
 // Stop command is only required when NOT using signal-based stop
 if (!stopCommand.trim() && !isSignalStop) missing.push('Stop command');
 if (!parsedPorts.length) missing.push('Valid ports');
 if (!Number(allocatedMemoryMb)) missing.push('Allocated memory');
 if (!Number(allocatedCpuCores)) missing.push('Allocated CPU cores');
 return missing;
 }, [
 name,
 author,
 version,
 image,
 startup,
 stopCommand,
 sendSignalTo,
 parsedPorts.length,
 allocatedMemoryMb,
 allocatedCpuCores,
 ]);

 return (
 <div>
 <div className="flex flex-wrap gap-2">
 <button
 className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
 onClick={() => {
 setImportError('');
 setStep(1);
 setOpen(true);
 }}
 >
 New Template
 </button>
 <button
 className="rounded-lg border border-border/40 px-4 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
 onClick={() => {
 setImportUrl('');
 setImportUrlError('');
 setImportModalOpen(true);
 }}
 >
 Import
 </button>
 <input
 ref={importFileRef}
 type="file"
 accept="application/json,.json,application/x-yaml,.yaml,.yml"
 onChange={handleImportFile}
 multiple
 className="hidden"
 />
 </div>
 {open ? (
 <ModalPortal>
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 px-4 py-10">
 <div className="flex w-full max-w-4xl max-h-[90vh] flex-col overflow-hidden rounded-2xl border border-border/40 bg-card shadow-sm transition-colors">
 {/* ── Header ── */}
 <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-5">
 <div>
 <h2 className="text-lg font-semibold text-foreground">
 {step === 1 ? 'New Template' : 'Create template'}
 </h2>
 <p className="text-xs text-muted-foreground">
 {step === 1
 ? 'Choose a nest to organize this template.'
 : 'Define runtime images, resources, and startup commands.'}
 </p>
 </div>
 <button
 className="rounded-full border border-border/40 px-3 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary"
 onClick={() => {
 setOpen(false);
 setImportError('');
 setStep(1);
 }}
 >
 Close
 </button>
 </div>

 {/* ── Step indicator ── */}
 <div className="flex items-center gap-2 border-b border-border px-6 py-2.5">
 <div
 className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${step === 1 ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}
 >
 <span
 className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${step === 1 ? 'bg-primary text-primary-foreground' : 'bg-surface-3 text-muted-foreground'}`}
 >
 1
 </span>
 Nest
 </div>
 <div className="h-px flex-1 bg-border" />
 <div
 className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${step === 2 ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}
 >
 <span
 className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${step === 2 ? 'bg-primary text-primary-foreground' : 'bg-surface-3 text-muted-foreground'}`}
 >
 2
 </span>
 Details
 </div>
 </div>

 {/* ── Step 1: Nest Selection ── */}
 {step === 1 && (
 <div className="flex flex-col items-center px-6 py-10 text-center">
 <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-warning/10 to-danger/10">
 <FolderOpen className="h-7 w-7 text-warning" />
 </div>
 <h3 className="text-base font-semibold text-foreground">
 Assign this template to a nest?
 </h3>
 <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
 <span className="font-medium text-foreground">Nests</span>{' '}
 are categories that help you organize templates. For example, you might have a{' '}
 <span className="font-medium">&ldquo;Minecraft&rdquo;</span> nest for all
 Minecraft-related templates, or a{' '}
 <span className="font-medium">&ldquo;Source Engine&rdquo;</span> nest for
 Counter-Strike and Garry&rsquo;s Mod templates.
 </p>

 {nests.length > 0 ? (
 <label className="mt-6 block w-full max-w-xs space-y-1.5">
 <span className="text-xs font-medium text-muted-foreground">
 Select a nest (optional)
 </span>
 <Select
 value={nestId || '__none__'}
 onValueChange={(v) => setNestId(v === '__none__' ? '' : v)}
 >
 <SelectTrigger className="w-full max-w-xs">
 <SelectValue placeholder="Skip — no nest" />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="__none__">Skip — no nest</SelectItem>
 {nests.map((nest) => (
 <SelectItem key={nest.id} value={nest.id}>
 <span className="flex items-center gap-2">
 {nest.icon ? (
 <img
 src={nest.icon}
 alt=""
 className="h-4 w-4 rounded object-cover"
 />
 ) : (
 <span className="flex h-4 w-4 items-center justify-center rounded bg-surface-2 text-[9px] font-bold uppercase text-muted-foreground">
 {nest.name.slice(0, 2)}
 </span>
 )}
 {nest.name}
 </span>
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </label>
 ) : (
 <div className="mt-6 rounded-xl border border-dashed border-border bg-surface-2/50 px-5 py-4">
 <p className="text-sm text-muted-foreground">
 No nests exist yet.{' '}
 <button
 type="button"
 className="inline-flex items-center gap-1 font-medium text-primary hover:text-primary"
 onClick={() => {
 setOpen(false);
 setStep(1);
 window.dispatchEvent(new CustomEvent('catalyst:open-nests-modal', { detail: { returnTo: 'template-create' } }));
 }}
 >
 Create a nest
 </button>{' '}
 first, or skip this step.
 </p>
 </div>
 )}

 <div className="mt-8 flex items-center gap-3">
 <button
 className="flex items-center gap-1.5 rounded-full border border-border/40 px-4 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
 onClick={() => setStep(2)}
 >
 <SkipForward className="h-3.5 w-3.5" />
 Skip
 </button>
 {nests.length > 0 && (
 <button
 className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
 onClick={() => setStep(2)}
 >
 Continue
 <ArrowRight className="h-3.5 w-3.5" />
 </button>
 )}
 </div>
 </div>
 )}

 {/* ── Step 2: Template Form ── */}
 {step === 2 && (
 <>
 <div className="space-y-6 overflow-y-auto px-6 py-5 text-sm text-muted-foreground">
 {importError ? (
 <p className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
 {importError}
 </p>
 ) : null}
 <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
 <label className="block space-y-1">
 <span className="text-muted-foreground">
 Name
 </span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-foreground transition-colors focus:border-primary focus:outline-none hover:border-primary"
 value={name}
 onChange={(event) => setName(event.target.value)}
 placeholder="Minecraft Paper"
 />
 </label>
 <label className="block space-y-1">
 <span className="text-muted-foreground">
 Author
 </span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-foreground transition-colors focus:border-primary focus:outline-none hover:border-primary"
 value={author}
 onChange={(event) => setAuthor(event.target.value)}
 placeholder="Catalyst Maintainers"
 />
 </label>
 <label className="block space-y-1">
 <span className="text-muted-foreground">
 Version
 </span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-foreground transition-colors focus:border-primary focus:outline-none hover:border-primary"
 value={version}
 onChange={(event) => setVersion(event.target.value)}
 placeholder="1.20.4"
 />
 </label>
 <label className="block space-y-1">
 <span className="text-muted-foreground">
 Icon URL (optional)
 </span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-foreground transition-colors focus:border-primary focus:outline-none hover:border-primary"
 value={iconUrl}
 onChange={(event) => setIconUrl(event.target.value)}
 placeholder="https://example.com/icon.png"
 />
 </label>
 <label className="block space-y-1">
 <span className="text-muted-foreground">
 Import template (optional)
 </span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-xs text-foreground transition-colors file:mr-3 file:rounded-md file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-muted-foreground hover:file:bg-surface-3"
 type="file"
 accept="application/json,.json,application/x-yaml,.yaml,.yml"
 onChange={handleImportFile}
 />
 {importError ? (
 <p className="text-xs text-destructive">{importError}</p>
 ) : null}
 </label>
 </div>
 <label className="block space-y-1">
 <span className="text-muted-foreground">
 Description
 </span>
 <textarea
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-foreground transition-colors focus:border-primary focus:outline-none hover:border-primary"
 rows={2}
 value={description}
 onChange={(event) => setDescription(event.target.value)}
 placeholder="Template summary"
 />
 </label>
 <div className="space-y-3 rounded-2xl border border-border/30 bg-surface-2 p-4 transition-colors">
 <div className="text-sm font-semibold text-foreground">
 Runtime images
 </div>
 <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
 <label className="block space-y-1">
 <span className="text-muted-foreground">
 Container image
 </span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-foreground transition-colors focus:border-primary focus:outline-none hover:border-primary"
 value={image}
 onChange={(event) => setImage(event.target.value)}
 placeholder="itzg/minecraft-server:latest"
 />
 </label>
 <label className="block space-y-1">
 <span className="text-muted-foreground">
 Default image (optional)
 </span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-foreground transition-colors focus:border-primary focus:outline-none hover:border-primary"
 value={defaultImage}
 onChange={(event) => setDefaultImage(event.target.value)}
 placeholder="eclipse-temurin:21-jre"
 />
 </label>
 <label className="block space-y-1 md:col-span-2">
 <span className="text-muted-foreground">
 Install image (optional)
 </span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-foreground transition-colors focus:border-primary focus:outline-none hover:border-primary"
 value={installImage}
 onChange={(event) => setInstallImage(event.target.value)}
 placeholder="alpine:3.19"
 />
 </label>
 </div>
 <div className="space-y-3 rounded-lg border border-border/30 bg-card p-3 transition-colors">
 <div className="flex flex-wrap items-center justify-between gap-2">
 <div className="text-xs font-semibold text-muted-foreground">
 Image variants
 </div>
 <button
 className="rounded-full border border-border/40 px-3 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
 onClick={() =>
 setImageOptions((prev) => [
 ...prev,
 { name: '', label: '', image: '' },
 ])
 }
 type="button"
 >
 Add image
 </button>
 </div>
 {imageOptions.length ? (
 <div className="space-y-2">
 {imageOptions.map((option, index) => (
 <div
 key={`${option.name}-${index}`}
 className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end"
 >
 <label className="block space-y-1">
 <span className="text-xs text-muted-foreground">
 Name
 </span>
 <input
 className="w-full rounded-md border border-border/40 bg-card px-2 py-1.5 text-xs text-foreground transition-colors focus:border-primary focus:outline-none"
 value={option.name}
 onChange={(event) =>
 setImageOptions((prev) =>
 prev.map((item, itemIndex) =>
 itemIndex === index
 ? { ...item, name: event.target.value }
 : item,
 ),
 )
 }
 />
 </label>
 <label className="block space-y-1">
 <span className="text-xs text-muted-foreground">
 Label
 </span>
 <input
 className="w-full rounded-md border border-border/40 bg-card px-2 py-1.5 text-xs text-foreground transition-colors focus:border-primary focus:outline-none"
 value={option.label ?? ''}
 onChange={(event) =>
 setImageOptions((prev) =>
 prev.map((item, itemIndex) =>
 itemIndex === index
 ? { ...item, label: event.target.value }
 : item,
 ),
 )
 }
 />
 </label>
 <label className="block space-y-1">
 <span className="text-xs text-muted-foreground">
 Image
 </span>
 <input
 className="w-full rounded-md border border-border/40 bg-card px-2 py-1.5 text-xs text-foreground transition-colors focus:border-primary focus:outline-none"
 value={option.image}
 onChange={(event) =>
 setImageOptions((prev) =>
 prev.map((item, itemIndex) =>
 itemIndex === index
 ? { ...item, image: event.target.value }
 : item,
 ),
 )
 }
 />
 </label>
 <button
 className="rounded-full border border-destructive/20 px-2 py-1 text-xs font-semibold text-destructive transition-colors hover:border-destructive"
 onClick={() =>
 setImageOptions((prev) =>
 prev.filter((_, itemIndex) => itemIndex !== index),
 )
 }
 type="button"
 >
 Remove
 </button>
 </div>
 ))}
 </div>
 ) : (
 <p className="text-xs text-muted-foreground">
 Add optional image variants for selectable runtimes.
 </p>
 )}
 </div>
 </div>
 <div className="space-y-3 rounded-2xl border border-border/30 bg-surface-2 p-4 transition-colors">
 <div className="text-sm font-semibold text-foreground">
 Commands & config
 </div>
 <label className="block space-y-1">
 <span className="text-muted-foreground">
 Config file path (optional)
 </span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-foreground transition-colors focus:border-primary focus:outline-none hover:border-primary"
 value={configFile}
 onChange={(event) => setConfigFile(event.target.value)}
 placeholder="/config/server.properties"
 />
 </label>
 <label className="block space-y-1">
 <span className="text-muted-foreground">
 Config files (optional)
 </span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-foreground transition-colors focus:border-primary focus:outline-none hover:border-primary"
 value={configFiles.join(', ')}
 onChange={(event) => {
 const next = event.target.value
 .split(',')
 .map((entry) => entry.trim())
 .filter(Boolean);
 setConfigFiles(next);
 }}
 placeholder="/config/server.properties, /config/extra.yml"
 />
 </label>
 <label className="block space-y-1">
 <span className="text-muted-foreground">
 Startup command
 </span>
 <textarea
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-foreground transition-colors focus:border-primary focus:outline-none hover:border-primary"
 rows={2}
 value={startup}
 onChange={(event) => setStartup(event.target.value)}
 placeholder="java -Xmx{{MEMORY}}M -jar server.jar"
 />
 </label>
 <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
 <label className="block space-y-1 md:col-span-2">
 <span className="text-muted-foreground">
 Stop command
 </span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-foreground transition-colors focus:border-primary focus:outline-none hover:border-primary"
 value={stopCommand}
 onChange={(event) => setStopCommand(event.target.value)}
 placeholder="stop"
 />
 </label>
 <label className="block space-y-1">
 <span className="text-muted-foreground">
 Signal
 </span>
 <select
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-foreground transition-colors focus:border-primary focus:outline-none hover:border-primary"
 value={sendSignalTo}
 onChange={(event) =>
 setSendSignalTo(
 event.target.value as 'SIGTERM' | 'SIGINT' | 'SIGKILL',
 )
 }
 >
 <option value="SIGTERM">SIGTERM</option>
 <option value="SIGINT">SIGINT</option>
 <option value="SIGKILL">SIGKILL</option>
 </select>
 </label>
 </div>
 <label className="block space-y-1">
 <span className="text-muted-foreground">
 Install script (optional)
 </span>
 <textarea
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-foreground transition-colors focus:border-primary focus:outline-none hover:border-primary"
 rows={5}
 value={installScript}
 onChange={(event) => setInstallScript(event.target.value)}
 placeholder="#!/bin/sh"
 />
 </label>
 </div>
 <div className="space-y-3 rounded-2xl border border-border/30 bg-surface-2 p-4 transition-colors">
 <div className="text-sm font-semibold text-foreground">
 Resources & ports
 </div>
 <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
 <label className="block space-y-1">
 <span className="text-muted-foreground">
 Ports (comma separated)
 </span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-foreground transition-colors focus:border-primary focus:outline-none hover:border-primary"
 value={supportedPorts}
 onChange={(event) => setSupportedPorts(event.target.value)}
 placeholder="25565, 25566"
 />
 </label>
 <label className="block space-y-1">
 <span className="text-muted-foreground">
 Allocated memory (MB)
 </span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-foreground transition-colors focus:border-primary focus:outline-none hover:border-primary"
 type="number"
 min={128}
 value={allocatedMemoryMb}
 onChange={(event) => setAllocatedMemoryMb(event.target.value)}
 />
 </label>
 <label className="block space-y-1">
 <span className="text-muted-foreground">
 Allocated CPU cores
 </span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-foreground transition-colors focus:border-primary focus:outline-none hover:border-primary"
 type="number"
 min={1}
 step={1}
 value={allocatedCpuCores}
 onChange={(event) => setAllocatedCpuCores(event.target.value)}
 />
 </label>
 </div>
 </div>
 <div className="space-y-3 rounded-2xl border border-border/30 bg-surface-2 p-4 transition-colors">
 <div className="flex flex-wrap items-center justify-between gap-2">
 <h3 className="text-sm font-semibold text-foreground">
 Variables
 </h3>
 <button
 className="rounded-full border border-border/40 px-3 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
 onClick={() => setVariables((prev) => [...prev, createVariableDraft()])}
 type="button"
 >
 Add variable
 </button>
 </div>
 {variables.map((variable, index) => (
 <div
 key={`${variable.name}-${index}`}
 className="rounded-xl border border-border/30 bg-card p-3 transition-colors hover:border-primary"
 >
 <div className="flex items-center justify-between gap-2">
 <div className="text-xs font-semibold text-muted-foreground">
 Variable {index + 1}
 </div>
 {variables.length > 1 ? (
 <button
 className="text-xs text-destructive transition-colors hover:text-destructive"
 onClick={() =>
 setVariables((prev) =>
 prev.filter((_, itemIndex) => itemIndex !== index),
 )
 }
 type="button"
 >
 Remove
 </button>
 ) : null}
 </div>
 <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
 <label className="block space-y-1">
 <span className="text-muted-foreground">
 Name
 </span>
 <input
 className="w-full rounded-md border border-border/40 bg-card px-2 py-1.5 text-xs text-foreground transition-colors focus:border-primary focus:outline-none hover:border-primary"
 value={variable.name}
 onChange={(event) =>
 setVariables((prev) =>
 prev.map((item, itemIndex) =>
 itemIndex === index
 ? { ...item, name: event.target.value }
 : item,
 ),
 )
 }
 />
 </label>
 <label className="block space-y-1">
 <span className="text-muted-foreground">
 Default
 </span>
 <input
 className="w-full rounded-md border border-border/40 bg-card px-2 py-1.5 text-xs text-foreground transition-colors focus:border-primary focus:outline-none hover:border-primary"
 value={variable.defaultValue}
 onChange={(event) =>
 setVariables((prev) =>
 prev.map((item, itemIndex) =>
 itemIndex === index
 ? { ...item, defaultValue: event.target.value }
 : item,
 ),
 )
 }
 />
 </label>
 <label className="block space-y-1 md:col-span-2">
 <span className="text-muted-foreground">
 Description
 </span>
 <input
 className="w-full rounded-md border border-border/40 bg-card px-2 py-1.5 text-xs text-foreground transition-colors focus:border-primary focus:outline-none hover:border-primary"
 value={variable.description}
 onChange={(event) =>
 setVariables((prev) =>
 prev.map((item, itemIndex) =>
 itemIndex === index
 ? { ...item, description: event.target.value }
 : item,
 ),
 )
 }
 />
 </label>
 <label className="flex items-center gap-2 text-xs text-muted-foreground">
 <input
 type="checkbox"
 className="rounded border-border bg-card text-primary focus:ring-primary"
 checked={variable.required}
 onChange={(event) =>
 setVariables((prev) =>
 prev.map((item, itemIndex) =>
 itemIndex === index
 ? { ...item, required: event.target.checked }
 : item,
 ),
 )
 }
 />
 Required
 </label>
 <label className="block space-y-1">
 <span className="text-muted-foreground">
 Input type
 </span>
 <select
 className="w-full rounded-md border border-border/40 bg-card px-2 py-1.5 text-xs text-foreground transition-colors focus:border-primary focus:outline-none hover:border-primary"
 value={variable.input}
 onChange={(event) =>
 setVariables((prev) =>
 prev.map((item, itemIndex) =>
 itemIndex === index
 ? {
 ...item,
 input: event.target.value as TemplateVariable['input'],
 }
 : item,
 ),
 )
 }
 >
 <option value="text">Text</option>
 <option value="number">Number</option>
 <option value="password">Password</option>
 <option value="select">Select</option>
 <option value="checkbox">Checkbox</option>
 <option value="textarea">Textarea</option>
 </select>
 </label>
 <label className="block space-y-1 md:col-span-2">
 <span className="text-muted-foreground">
 Rules (semicolon separated)
 </span>
 <input
 className="w-full rounded-md border border-border/40 bg-card px-2 py-1.5 text-xs text-foreground transition-colors focus:border-primary focus:outline-none hover:border-primary"
 value={variable.rules}
 onChange={(event) =>
 setVariables((prev) =>
 prev.map((item, itemIndex) =>
 itemIndex === index
 ? { ...item, rules: event.target.value }
 : item,
 ),
 )
 }
 placeholder="between:512,16384; in:val1,val2"
 />
 </label>
 </div>
 </div>
 ))}
 </div>
 <div className="space-y-3 rounded-2xl border border-border/30 bg-surface-2 p-4 transition-colors">
 <div className="text-sm font-semibold text-foreground">
 Advanced features
 </div>
 <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
 <label className="flex items-center gap-2 text-xs text-muted-foreground">
 <input
 type="checkbox"
 className="rounded border-border bg-card text-primary focus:ring-primary"
 checked={restartOnExit}
 onChange={(event) => setRestartOnExit(event.target.checked)}
 />
 Restart on exit
 </label>
 <label className="block space-y-1">
 <span className="text-muted-foreground">
 Max instances (optional)
 </span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-foreground transition-colors focus:border-primary focus:outline-none hover:border-primary"
 type="number"
 min={1}
 value={maxInstances}
 onChange={(event) => setMaxInstances(event.target.value)}
 placeholder="Unlimited"
 />
 </label>
 <label className="flex items-center gap-2 text-xs text-muted-foreground">
 <input
 type="checkbox"
 className="rounded border-border bg-card text-primary focus:ring-primary"
 checked={fileEditorEnabled}
 onChange={(event) => setFileEditorEnabled(event.target.checked)}
 />
 Enable file editor
 </label>
 <label className="block space-y-1">
 <span className="text-muted-foreground">
 File editor restricted paths (optional)
 </span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-foreground transition-colors focus:border-primary focus:outline-none hover:border-primary"
 value={fileEditorRestrictedPaths}
 onChange={(event) => setFileEditorRestrictedPaths(event.target.value)}
 placeholder="/sensitive, /config"
 />
 </label>
 </div>
 <label className="block space-y-1">
 <span className="text-muted-foreground">
 Backup paths (optional)
 </span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-foreground transition-colors focus:border-primary focus:outline-none hover:border-primary"
 value={backupPaths}
 onChange={(event) => setBackupPaths(event.target.value)}
 placeholder="/world, /plugins, /config"
 />
 </label>
 </div>
 <TemplateProviderEditor
 modManagerEnabled={modManagerEnabled}
 onModManagerEnabledChange={setModManagerEnabled}
 modProviders={modProviders}
 onModProvidersChange={setModProviders}
 pluginManagerEnabled={pluginManagerEnabled}
 onPluginManagerEnabledChange={setPluginManagerEnabled}
 pluginProviders={pluginProviders}
 onPluginProvidersChange={setPluginProviders}
 />
 </div>
 </>
 )}
 <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-4 text-xs">
 <div className="flex items-center gap-3">
 {step === 2 && (
 <button
 className="rounded-full border border-border/40 px-4 py-2 font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
 onClick={() => setStep(1)}
 >
 {'\u2190'} Back
 </button>
 )}
 {step === 2 && (
 <div className="space-y-1">
 {missingFields.length > 0 ? (
 <div className="text-xs">
 <span className="text-muted-foreground">
 Missing required fields:{' '}
 </span>
 <span className="text-warning font-medium">
 {missingFields.join(', ')}
 </span>
 </div>
 ) : (
 <span className="text-xs text-muted-foreground">
 Templates are available immediately after creation.
 </span>
 )}
 </div>
 )}
 </div>
 <div className="flex gap-2">
 <button
 className="rounded-full border border-border/40 px-4 py-2 font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
 onClick={() => {
 setOpen(false);
 setImportError('');
 setStep(1);
 }}
 >
 Cancel
 </button>
 {step === 2 && (
 <button
 className="rounded-full bg-primary px-4 py-2 font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
 onClick={() => mutation.mutate()}
 disabled={disableSubmit}
 >
 {mutation.isPending ? 'Creating...' : 'Create template'}
 </button>
 )}
 </div>
 </div>
 </div>
 </div>
 </ModalPortal>
 ) : null}
 {/* ── Import Modal ── */}
 {importModalOpen && (
 <ModalPortal>
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 px-4 py-10">
 <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border/40 bg-card shadow-sm">
 <div className="flex items-center justify-between border-b border-border px-6 py-4">
 <div>
 <h2 className="text-base font-semibold text-foreground">
 Import Template
 </h2>
 <p className="text-xs text-muted-foreground">
 Import from a URL, upload a local file, or import all Pterodactyl eggs.
 </p>
 </div>
 <button
 className="rounded-full border border-border/40 px-3 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary"
 onClick={() => {
 setImportModalOpen(false);
 setBatchImportLoading(false);
 setBatchImportResult(null);
 }}
 >
 Close
 </button>
 </div>
 <div className="space-y-5 px-6 py-5">
 {/* URL Import */}
 <div className="space-y-2">
 <div className="flex items-center gap-2">
 <LinkIcon className="h-4 w-4 text-primary" />
 <span className="text-sm font-medium text-foreground">
 From URL
 </span>
 </div>
 <p className="text-xs text-muted-foreground">
 Paste a direct link to a .json or .yaml egg file.
 </p>
 <div className="flex gap-2">
 <input
 className="flex-1 rounded-lg border border-border/40 bg-card px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none hover:border-primary"
 value={importUrl}
 onChange={(e) => {
 setImportUrl(e.target.value);
 setImportUrlError('');
 }}
 placeholder="https://raw.githubusercontent.com/.../egg.json"
 onKeyDown={(e) => {
 if (e.key === 'Enter' && !importUrlLoading) handleImportUrl();
 }}
 />
 <button
 className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
 onClick={handleImportUrl}
 disabled={!importUrl.trim() || importUrlLoading}
 >
 {importUrlLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
 {importUrlLoading ? 'Fetching...' : 'Import'}
 </button>
 </div>
 {importUrlError && (
 <p className="text-xs text-destructive">{importUrlError}</p>
 )}
 </div>

 {/* Divider */}
 <div className="flex items-center gap-3">
 <div className="h-px flex-1 bg-border" />
 <span className="text-xs font-medium text-muted-foreground">or</span>
 <div className="h-px flex-1 bg-border" />
 </div>

 {/* Local Upload */}
 <div className="space-y-2">
 <div className="flex items-center gap-2">
 <Upload className="h-4 w-4 text-primary" />
 <span className="text-sm font-medium text-foreground">
 From Local File
 </span>
 </div>
 <p className="text-xs text-muted-foreground">
 Upload a .json or .yaml egg file from your computer.
 </p>
 <button
 className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border px-4 py-4 text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
 onClick={() => importFileRef.current?.click()}
 >
 <Upload className="h-4 w-4" />
 Choose file{''}
 <span className="text-xs opacity-60">(.json, .yaml, .yml)</span>
 </button>
 </div>

 {/* Divider */}
 <div className="flex items-center gap-3">
 <div className="h-px flex-1 bg-border" />
 <span className="text-xs font-medium text-muted-foreground">or</span>
 <div className="h-px flex-1 bg-border" />
 </div>

 {/* Pterodactyl Batch Import */}
 <div className="space-y-2">
 <div className="flex items-center gap-2">
 <Download className="h-4 w-4 text-primary" />
 <span className="text-sm font-medium text-foreground">
 Import All Pterodactyl Eggs
 </span>
 </div>
 <p className="text-xs text-muted-foreground">
 Download and import all templates from the{' '}
 <a
 href="https://github.com/pterodactyl/game-eggs"
 target="_blank"
 rel="noopener noreferrer"
 className="font-medium text-primary hover:text-primary"
 >
 pterodactyl/game-eggs
 </a>{' '}
 repository. Nests are created automatically from egg categories.
 </p>
 {batchImportResult ? (
 <div className="space-y-2 rounded-lg border border-border/30 bg-surface-2/50 px-4 py-3">
 <div className="flex items-center gap-2 text-sm font-medium text-foreground">
 <CheckCircle className="h-4 w-4 text-success" />
 Import complete
 </div>
 <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
 <span className="text-success font-medium">
 {batchImportResult.imported} imported
 </span>
 {batchImportResult.skipped > 0 && (
 <span className="text-warning font-medium">
 {batchImportResult.skipped} skipped (already exist)
 </span>
 )}
 {batchImportResult.errors > 0 && (
 <span className="text-destructive font-medium">
 {batchImportResult.errors} failed
 </span>
 )}
 </div>
 {batchImportResult.errors > 0 && batchImportResult.errorDetails.length > 0 && (
 <details className="text-xs text-muted-foreground">
 <summary className="cursor-pointer font-medium hover:text-foreground">
 Error details
 </summary>
 <ul className="mt-1 space-y-0.5 pl-3">
 {batchImportResult.errorDetails.slice(0, 10).map((e, i) => (
 <li key={i} className="truncate">
 {e.name}: {e.error}
 </li>
 ))}
 {batchImportResult.errorDetails.length > 10 && (
 <li className="italic">
 +{batchImportResult.errorDetails.length - 10} more
 </li>
 )}
 </ul>
 </details>
 )}
 </div>
 ) : (
 <button
 className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 px-4 py-4 text-sm font-medium text-primary transition-colors hover:border-primary/60 hover:bg-primary/10"
 onClick={handleBatchImport}
 disabled={batchImportLoading}
 >
 {batchImportLoading ? (
 <>
 <Loader2 className="h-4 w-4 animate-spin" />
 Importing all eggs…
 </>
 ) : (
 <>
 <Download className="h-4 w-4" />
 Import All (~249 eggs)
 </>
 )}
 </button>
 )}
 {batchImportLoading && (
 <p className="text-xs text-muted-foreground">
 This may take 1–2 minutes. The server is fetching all eggs from GitHub.
 </p>
 )}
 </div>
 </div>
 </div>
 </div>
 </ModalPortal>
 )}
 </div>
 );
}

export default TemplateCreateModal;