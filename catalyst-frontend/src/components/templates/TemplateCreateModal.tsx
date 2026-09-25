import { useMemo, useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
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
import Combobox from '../../components/ui/combobox';
import type { TemplateImageOption, TemplateVariable } from '../../types/template';
import { templatesApi, type BatchImportResult } from '../../services/api/templates';
import { nestsApi } from '../../services/api/nests';
import { notifyError, notifySuccess } from '../../utils/notify';
import { normalizeTemplateImport, parseEggContent } from '../../utils/pterodactylImport';
import TemplateProviderEditor, { extractProviderIds } from './TemplateProviderEditor';
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
import { Input } from '@/components/ui/input';
import { reportSystemError } from '../../services/api/systemErrors';
import { describeError } from '../../utils/errors';
import { BracketLabel } from '../../components/deck/primitives';
import { cn } from '@/lib/utils';

type VariableDraft = {
 id: string;
 name: string;
 description: string;
 defaultValue: string;
 required: boolean;
 input: TemplateVariable['input'];
 rules: string;
};

type ImageOptionDraft = TemplateImageOption & { id: string };

const createDraftId = () =>
 crypto.randomUUID?.() ?? `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const createVariableDraft = (): VariableDraft => ({
 id: createDraftId(),
 name: '',
 description: '',
 defaultValue: '',
 required: false,
 input: 'text',
 rules: '',
});

const createImageOptionDraft = (option?: Partial<TemplateImageOption>): ImageOptionDraft => ({
 id: createDraftId(),
 name: option?.name ?? '',
 label: option?.label ?? '',
 image: option?.image ?? '',
});

function TemplateCreateModal() {
 const { t } = useTranslation('templates');
 const [open, setOpen] = useState(false);
 const importFileRef = useRef<HTMLInputElement | null>(null);
 const [name, setName] = useState('');
 const [description, setDescription] = useState('');
 const [author, setAuthor] = useState('');
 const [version, setVersion] = useState('');
 const [image, setImage] = useState('');
 const [installImage, setInstallImage] = useState('');
 const [imageOptions, setImageOptions] = useState<ImageOptionDraft[]>([]);
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
 images: imageOptions
  .filter((option) => option.name && option.image)
  .map(({ name, label, image }) => ({ name, label, image })),
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
 notifySuccess(t('create.success'));
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
 onError: (error: unknown) => {
  notifyError(error, 'templates:create.error');
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.templates() });
 queryClient.invalidateQueries({ queryKey: qk.nests() });
 },
 });

 const applyTemplateImport = (raw: unknown) => {
 if (!raw || typeof raw !== 'object') {
 setImportError(t('create.invalidJson'));
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
 ? (payload.images as Record<string, unknown>[]).map((option) =>
 createImageOptionDraft({
 name: String(option?.name ?? ''),
 label: option?.label ? String(option.label) : undefined,
 image: String(option?.image ?? ''),
 }),
 )
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
 id: createDraftId(),
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
 setImportError(t('create.parseFailed'));
 return;
 }
 applyTemplateImport(parsed);
 } catch (error) {
 reportSystemError({
 level: 'error',
 component: 'TemplateCreateModal',
 message: describeError(error),
 stack: error instanceof Error ? error.stack : undefined,
 metadata: { context: 'parse import file' },
 });
 setImportError(t('create.parseFailed'));
 }
 };
 reader.onerror = () => {
 setImportError(t('create.readFailed'));
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
 message: describeError(error),
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
 notifySuccess(t('create.importedTemplates', { count: successCount }));
 queryClient.invalidateQueries({ queryKey: qk.templates() });
 queryClient.invalidateQueries({ queryKey: qk.nests() });
 }
 if (failureCount) {
 notifyError(t('create.failedTemplates', { count: failureCount }));
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
 setImportUrlError(t('create.invalidUrl'));
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
 message: describeError(error),
 stack: error instanceof Error ? error.stack : undefined,
 metadata: { context: 'fetch import URL' },
 });
 setImportUrlError(error?.message || t('create.fetchFailed'));
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
 notifyError(error, 'templates:create.batchError');
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
 if (!name) missing.push(t('missing.name'));
 if (!author) missing.push(t('missing.author'));
 if (!version) missing.push(t('missing.version'));
 if (!image) missing.push(t('missing.image'));
 if (!startup) missing.push(t('missing.startup'));
 // Stop command is only required when NOT using signal-based stop
 if (!stopCommand.trim() && !isSignalStop) missing.push(t('missing.stopCommand'));
 if (!parsedPorts.length) missing.push(t('missing.ports'));
 if (!Number(allocatedMemoryMb)) missing.push(t('missing.memory'));
 if (!Number(allocatedCpuCores)) missing.push(t('missing.cpu'));
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
  t,
]);

 return (
 <div>
 <div className="flex flex-wrap gap-2">
 <button
 className="h-8 rounded-sm bg-primary px-3 text-mini font-medium text-primary-foreground transition-colors hover:bg-primary/90"
 onClick={() => {
 setImportError('');
 setStep(1);
 setOpen(true);
 }}
 >
 {t('create.newTemplate')}
 </button>
 <button
 className="h-8 rounded-sm border border-border/60 px-3 text-mini font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
 onClick={() => {
 setImportUrl('');
 setImportUrlError('');
 setImportModalOpen(true);
 }}
 >
 {t('form.import')}
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
 <Dialog
 open={open}
 onOpenChange={(next) => {
 setOpen(next);
 if (!next) {
 setImportError('');
 setStep(1);
 }
 }}
 >
 <DialogContent size="2xl">
 <DialogHeader icon={<FolderOpen className="h-4 w-4" />}>
 <DialogTitle>{step === 1 ? t('create.titleStep1') : t('create.titleStep2')}</DialogTitle>
 <DialogDescription>
 {step === 1
   ? t('create.descriptionStep1')
   : t('create.descriptionStep2')}
 </DialogDescription>
 </DialogHeader>
 <DialogToolbar>
 <div className="flex items-center gap-0.5">
 {[
 { n: 1, label: t('create.stepNest'), active: step === 1 },
 { n: 2, label: t('create.stepDetails'), active: step === 2 },
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
 {/* ── Step 1: Nest Selection ── */}
 {step === 1 && (
 <div className="flex flex-col items-center py-6 text-center">
 <h3 className="font-display text-lg font-semibold leading-none tracking-tight text-foreground">
 {t('create.assignTitle')}
 </h3>
 <p className="type-meta mt-2 max-w-md leading-relaxed">
   {t('create.nestsHint')}
 </p>

 {nests.length > 0 ? (
 <div className="mt-6 w-full max-w-xs space-y-1.5 text-left">
 <span className="type-overline">{t('create.selectNestLabel')}</span>
 <Combobox
 value={nestId || '__none__'}
 onChange={(v) => setNestId(v === '__none__' ? '' : v)}
 options={[
 { value: '__none__', label: t('create.skipNest'), keywords: [t('create.skipNest')] },
 ...nests.map((nest) => ({
 value: nest.id,
 label: (
 <span className="flex items-center gap-2">
 {nest.icon ? (
 <img
 src={nest.icon}
 alt=""
 className="h-4 w-4 rounded-sm object-cover"
 />
 ) : (
 <span className="flex h-4 w-4 items-center justify-center rounded-sm bg-surface-2 font-display text-micro font-semibold text-muted-foreground">
 {nest.name.slice(0, 2)}
 </span>
 )}
 {nest.name}
 </span>
 ),
 keywords: [nest.name],
 })),
 ]}
 placeholder={t('create.skipNest')}
 searchPlaceholder={t('create.searchNests')}
 emptyMessage={t('create.noNestsFound')}
 />
 </div>
 ) : (
 <div className="mt-6 rounded-sm border border-dashed border-border/50 px-4 py-3">
 <p className="type-meta">
 {t('create.noNests')}{' '}
 <button
 type="button"
 className="inline-flex items-center gap-1 font-medium text-primary hover:text-primary"
 onClick={() => {
 setOpen(false);
 setStep(1);
 window.dispatchEvent(new CustomEvent('catalyst:open-nests-modal', { detail: { returnTo: 'template-create' } }));
 }}
 >
 {t('create.createNest')}
 </button>{' '}
   {t('create.noNestsSuffix')}
 </p>
 </div>
 )}

 </div>
 )}

 {/* ── Step 2: Template Form ── */}
 {step === 2 && (
 <div className="space-y-6">
 {importError ? (
 <p className="rounded-sm border border-danger/30 bg-danger/5 px-3 py-2 text-mini text-danger">
 {importError}
 </p>
 ) : null}
 {/* Validation summary lives in the form body, not between the footer actions. */}
 {missingFields.length > 0 ? (
 <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-sm border border-warning/30 bg-warning/5 px-3 py-2">
 <span className="type-overline">{t('form.missingFields')}</span>
 <span className="text-micro font-medium text-warning">{missingFields.join(', ')}</span>
 </div>
 ) : (
 <p className="text-micro text-muted-foreground">{t('create.availableNow')}</p>
 )}
 <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
 <label className="block space-y-1">
 <span className="type-overline">{t('form.name')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={name}
 onChange={(event) => setName(event.target.value)}
 placeholder="Minecraft Paper"
 />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.author')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={author}
 onChange={(event) => setAuthor(event.target.value)}
 placeholder="Catalyst Maintainers"
 />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.version')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={version}
 onChange={(event) => setVersion(event.target.value)}
 placeholder="1.20.4"
 />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.iconUrl')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={iconUrl}
 onChange={(event) => setIconUrl(event.target.value)}
 placeholder="https://example.com/icon.png"
 />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('create.importTemplateLabel')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors file:mr-3 file:h-6 file:rounded-sm file:border-0 file:bg-surface-2 file:px-2.5 file:text-mini file:font-medium file:text-muted-foreground hover:file:bg-surface-3"
 type="file"
 accept="application/json,.json,application/x-yaml,.yaml,.yml"
 onChange={handleImportFile}
 />
 {importError ? (
 <p className="text-mini text-danger">{importError}</p>
 ) : null}
 </label>
 </div>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.description')}</span>
 <textarea
 className="min-h-[4rem] w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 rows={2}
 value={description}
 onChange={(event) => setDescription(event.target.value)}
 placeholder={t('form.descriptionPlaceholder')}
 />
 </label>
 <div className="space-y-3">
 <BracketLabel tone="muted">{t('form.runtimeImages')}</BracketLabel>
 <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
 <label className="block space-y-1">
 <span className="type-overline">{t('form.containerImage')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={image}
 onChange={(event) => setImage(event.target.value)}
 placeholder="itzg/minecraft-server:latest"
 />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.defaultImage')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={defaultImage}
 onChange={(event) => setDefaultImage(event.target.value)}
 placeholder="eclipse-temurin:21-jre"
 />
 </label>
 <label className="block space-y-1 md:col-span-2">
 <span className="type-overline">{t('form.installImage')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={installImage}
 onChange={(event) => setInstallImage(event.target.value)}
 placeholder="alpine:3.19"
 />
 </label>
 </div>
 <div className="space-y-2">
 <div className="flex flex-wrap items-center justify-between gap-2">
 <BracketLabel tone="muted">{t('form.imageVariants')}</BracketLabel>
 <button
 className="h-7 rounded-sm border border-border/60 px-2.5 text-mini font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
 onClick={() => setImageOptions((prev) => [...prev, createImageOptionDraft()])}
 type="button"
 >
 {t('form.addImage')}
 </button>
 </div>
 {imageOptions.length ? (
 <div className="space-y-2">
 {imageOptions.map((option, index) => (
 <div
 key={option.id}
 className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end"
 >
 <label className="block space-y-1">
 <span className="type-overline">{t('form.name')}</span>
 <input
 className="h-7 w-full rounded-sm border border-border/60 bg-background/40 px-2 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
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
 <span className="type-overline">{t('form.variantLabel')}</span>
 <input
 className="h-7 w-full rounded-sm border border-border/60 bg-background/40 px-2 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
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
 <span className="type-overline">{t('form.variantImage')}</span>
 <input
 className="h-7 w-full rounded-sm border border-border/60 bg-background/40 px-2 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
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
 className="h-7 rounded-sm border border-danger/30 px-2.5 text-mini font-medium text-danger transition-colors hover:border-danger/60"
 onClick={() =>
 setImageOptions((prev) =>
 prev.filter((_, itemIndex) => itemIndex !== index),
 )
 }
 type="button"
 >
 {t('common:actions.remove')}
 </button>
 </div>
 ))}
 </div>
 ) : (
 <p className="type-meta">
 {t('form.variantsHint')}
 </p>
 )}
 </div>
 </div>
 <div className="space-y-3">
 <BracketLabel tone="muted">{t('form.commandsConfig')}</BracketLabel>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.configFile')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={configFile}
 onChange={(event) => setConfigFile(event.target.value)}
 placeholder="/config/server.properties"
 />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.configFiles')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
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
 <span className="type-overline">{t('form.startupCommand')}</span>
 <textarea
 className="min-h-[4rem] w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 rows={2}
 value={startup}
 onChange={(event) => setStartup(event.target.value)}
 placeholder="java -Xmx{{MEMORY}}M -jar server.jar"
 />
 </label>
 <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
 <label className="block space-y-1 md:col-span-2">
 <span className="type-overline">{t('form.stopCommand')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={stopCommand}
 onChange={(event) => setStopCommand(event.target.value)}
 placeholder="stop"
 />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.signal')}</span>
 <select
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
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
 <span className="type-overline">{t('form.installScript')}</span>
 <textarea
 className="min-h-[7rem] w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 rows={5}
 value={installScript}
 onChange={(event) => setInstallScript(event.target.value)}
 placeholder="#!/bin/sh"
 />
 </label>
 </div>
 <div className="space-y-3">
 <BracketLabel tone="muted">{t('form.resourcesPorts')}</BracketLabel>
 <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
 <label className="block space-y-1">
 <span className="type-overline">{t('form.ports')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={supportedPorts}
 onChange={(event) => setSupportedPorts(event.target.value)}
 placeholder="25565, 25566"
 />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.allocatedMemory')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 type="number"
 min={128}
 value={allocatedMemoryMb}
 onChange={(event) => setAllocatedMemoryMb(event.target.value)}
 />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.allocatedCpu')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 type="number"
 min={1}
 step={1}
 value={allocatedCpuCores}
 onChange={(event) => setAllocatedCpuCores(event.target.value)}
 />
 </label>
 </div>
 </div>
 <div className="space-y-3">
 <div className="flex flex-wrap items-center justify-between gap-2">
 <BracketLabel tone="muted">{t('form.variables')}</BracketLabel>
 <button
 className="h-7 rounded-sm border border-border/60 px-2.5 text-mini font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
 onClick={() => setVariables((prev) => [...prev, createVariableDraft()])}
 type="button"
 >
 {t('form.addVariable')}
 </button>
 </div>
 {variables.map((variable, index) => (
 <div
 key={variable.id}
 className="border-b border-border/50 pb-3 last:border-b-0 last:pb-0"
 >
 <div className="flex items-center justify-between gap-2">
 <div className="type-overline">
   {t('form.variableIndex', { index: index + 1 })}
 </div>
 {variables.length > 1 ? (
 <button
 className="text-mini text-danger transition-colors hover:text-danger/80"
 onClick={() =>
 setVariables((prev) =>
 prev.filter((_, itemIndex) => itemIndex !== index),
 )
 }
 type="button"
 >
 {t('common:actions.remove')}
 </button>
 ) : null}
 </div>
 <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
 <label className="block space-y-1">
 <span className="type-overline">{t('form.name')}</span>
 <input
 className="h-7 w-full rounded-sm border border-border/60 bg-background/40 px-2 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
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
 <span className="type-overline">{t('form.default')}</span>
 <input
 className="h-7 w-full rounded-sm border border-border/60 bg-background/40 px-2 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
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
 <span className="type-overline">{t('form.description')}</span>
 <input
 className="h-7 w-full rounded-sm border border-border/60 bg-background/40 px-2 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
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
 <label className="flex items-center gap-2 text-mini text-muted-foreground">
 <input
 type="checkbox"
 className="rounded-sm border-border/60 text-primary focus:ring-primary"
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
 {t('form.required')}
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.inputType')}</span>
 <select
 className="h-7 w-full rounded-sm border border-border/60 bg-background/40 px-2 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
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
 <option value="text">{t('form.inputText')}</option>
 <option value="number">{t('form.inputNumber')}</option>
 <option value="password">{t('form.inputPassword')}</option>
 <option value="select">{t('form.inputSelect')}</option>
 <option value="checkbox">{t('form.inputCheckbox')}</option>
 <option value="textarea">{t('form.inputTextarea')}</option>
 </select>
 </label>
 <label className="block space-y-1 md:col-span-2">
 <span className="type-overline">{t('form.rules')}</span>
 <input
 className="h-7 w-full rounded-sm border border-border/60 bg-background/40 px-2 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
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
 <div className="space-y-3">
 <BracketLabel tone="muted">{t('form.advancedFeatures')}</BracketLabel>
 <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
 <label className="flex items-center gap-2 text-mini text-muted-foreground">
 <input
 type="checkbox"
 className="rounded-sm border-border/60 text-primary focus:ring-primary"
 checked={restartOnExit}
 onChange={(event) => setRestartOnExit(event.target.checked)}
 />
 {t('form.restartOnExit')}
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.maxInstances')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 type="number"
 min={1}
 value={maxInstances}
 onChange={(event) => setMaxInstances(event.target.value)}
 placeholder={t('form.maxInstancesPlaceholder')}
 />
 </label>
 <label className="flex items-center gap-2 text-mini text-muted-foreground">
 <input
 type="checkbox"
 className="rounded-sm border-border/60 text-primary focus:ring-primary"
 checked={fileEditorEnabled}
 onChange={(event) => setFileEditorEnabled(event.target.checked)}
 />
 {t('form.enableFileEditor')}
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.fileEditorRestrictedPaths')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={fileEditorRestrictedPaths}
 onChange={(event) => setFileEditorRestrictedPaths(event.target.value)}
 placeholder="/sensitive, /config"
 />
 </label>
 </div>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.backupPaths')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
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
 )}
 </DialogBody>
 <DialogFooter className="sm:justify-between">
 <div className="flex items-center gap-2">
 {step === 2 && (
 <Button variant="outline" size="sm" className="h-8 px-3 text-mini" onClick={() => setStep(1)}>
 {t('common:actions.back')}
 </Button>
 )}
 </div>
 <div className="flex gap-2">
 <Button
 variant="outline"
 size="sm"
 className="h-8 px-3 text-mini"
 onClick={() => {
 setOpen(false);
 setImportError('');
 setStep(1);
 }}
 >
 {t('common:actions.cancel')}
 </Button>
 {step === 1 && (
 <Button variant="outline" size="sm" className="h-8 px-3 text-mini" onClick={() => setStep(2)}>
 <SkipForward className="h-3.5 w-3.5" />
 {t('create.skip')}
 </Button>
 )}
 {step === 1 && nests.length > 0 && (
 <Button size="sm" className="h-8 px-3 text-mini" onClick={() => setStep(2)}>
 {t('create.continue')}
 <ArrowRight className="h-3.5 w-3.5" />
 </Button>
 )}
 {step === 2 && (
 <Button size="sm" className="h-8 px-3 text-mini" onClick={() => mutation.mutate()} disabled={disableSubmit}>
 {mutation.isPending ? t('create.creating') : t('create.submit')}
 </Button>
 )}
 </div>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 {/* ── Import Modal ── */}
 <Dialog
 open={importModalOpen}
 onOpenChange={(next) => {
 setImportModalOpen(next);
 if (!next) {
 setBatchImportLoading(false);
 setBatchImportResult(null);
 }
 }}
 >
 <DialogContent size="lg">
 <DialogHeader icon={<Download className="h-4 w-4" />}>
 <DialogTitle>{t('create.importTitle')}</DialogTitle>
 <DialogDescription>
 {t('create.importDescription')}
 </DialogDescription>
 </DialogHeader>
 <DialogBody className="space-y-5">
 {/* URL Import */}
 <div className="space-y-2">
 <div className="flex items-center gap-2">
 <LinkIcon className="h-4 w-4 text-primary" />
 <span className="text-mini font-semibold text-foreground">
 {t('create.fromUrl')}
 </span>
 </div>
 <p className="type-meta">
 {t('create.fromUrlHint')}
 </p>
 <div className="flex gap-2">
 <Input
 className="h-8 flex-1 rounded-sm border-border/60 bg-background/40 px-2.5 text-mini"
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
 <Button
 size="sm"
 className="h-8 px-3 text-mini"
 onClick={handleImportUrl}
 disabled={!importUrl.trim() || importUrlLoading}
 >
 {importUrlLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
 {importUrlLoading ? t('create.fetching') : t('form.import')}
 </Button>
 </div>
 {importUrlError && (
 <p className="text-mini text-danger">{importUrlError}</p>
 )}
 </div>

 {/* Divider */}
 <div className="flex items-center justify-center">
 <span className="type-overline">{t('create.or')}</span>
 </div>

 {/* Local Upload */}
 <div className="space-y-2">
 <div className="flex items-center gap-2">
 <Upload className="h-4 w-4 text-primary" />
 <span className="text-mini font-semibold text-foreground">
 {t('create.fromLocalFile')}
 </span>
 </div>
 <p className="type-meta">
 {t('create.fromLocalFileHint')}
 </p>
 <button
 className="flex w-full items-center justify-center gap-2 rounded-sm border border-dashed border-border/50 px-4 py-4 text-mini font-medium text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
 onClick={() => importFileRef.current?.click()}
 >
 <Upload className="h-4 w-4" />
 {t('create.chooseFile')}{''}
 <span className="text-micro opacity-60">(.json, .yaml, .yml)</span>
 </button>
 </div>

 {/* Divider */}
 <div className="flex items-center justify-center">
 <span className="type-overline">{t('create.or')}</span>
 </div>

 {/* Pterodactyl Batch Import */}
 <div className="space-y-2">
 <div className="flex items-center gap-2">
 <Download className="h-4 w-4 text-primary" />
 <span className="text-mini font-semibold text-foreground">
 {t('create.importAllEggs')}
 </span>
 </div>
 <p className="type-meta">
 {t('create.importAllEggsHint')}
 </p>
 {batchImportResult ? (
 <div className="space-y-2 rounded-sm border border-border/50 px-3 py-2">
 <div className="flex items-center gap-2 text-mini font-semibold text-foreground">
 <CheckCircle className="h-4 w-4 text-success" />
 {t('create.importComplete')}
 </div>
 <div className="type-meta flex flex-wrap gap-3">
 <span className="text-success font-medium">
 {t('create.importedCount', { total: batchImportResult.imported })}
 </span>
 {batchImportResult.skipped > 0 && (
 <span className="text-warning font-medium">
 {t('create.skippedCount', { total: batchImportResult.skipped })}
 </span>
 )}
 {batchImportResult.errors > 0 && (
 <span className="text-danger font-medium">
 {t('create.failedCount', { total: batchImportResult.errors })}
 </span>
 )}
 </div>
 {batchImportResult.errors > 0 && batchImportResult.errorDetails.length > 0 && (
 <details className="text-micro text-muted-foreground">
 <summary className="cursor-pointer font-medium hover:text-foreground">
 {t('create.errorDetails')}
 </summary>
 <ul className="mt-1 space-y-0.5 pl-3">
 {batchImportResult.errorDetails.slice(0, 10).map((e, i) => (
 <li key={i} className="truncate">
 {e.name}: {e.error}
 </li>
 ))}
 {batchImportResult.errorDetails.length > 10 && (
 <li className="italic">
 {t('create.moreErrors', { total: batchImportResult.errorDetails.length - 10 })}
 </li>
 )}
 </ul>
 </details>
 )}
 </div>
 ) : (
 <button
 className="flex w-full items-center justify-center gap-2 rounded-sm border border-dashed border-primary/40 px-4 py-4 text-mini font-medium text-foreground transition-colors hover:border-primary/60 hover:bg-primary/5"
 onClick={handleBatchImport}
 disabled={batchImportLoading}
 >
 {batchImportLoading ? (
 <>
 <Loader2 className="h-4 w-4 animate-spin" />
 {t('create.importingAll')}
 </>
 ) : (
 <>
 <Download className="h-4 w-4" />
 {t('create.importAllButton')}
 </>
 )}
 </button>
 )}
 {batchImportLoading && (
 <p className="type-meta">
 {t('create.batchHint')}
 </p>
 )}
 </div>
 </DialogBody>
 <DialogFooter>
 <Button
 variant="outline"
 size="sm"
 className="h-8 px-3 text-mini"
 onClick={() => {
 setImportModalOpen(false);
 setBatchImportLoading(false);
 setBatchImportResult(null);
 }}
 >
 {t('common:actions.cancel')}
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 </div>
 );
}

export default TemplateCreateModal;