import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@/csync';
import Combobox from '../../components/ui/combobox';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import type { Template, TemplateImageOption, TemplateVariable } from '../../types/template';
import { templatesApi } from '../../services/api/templates';
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
import { reportSystemError } from '../../services/api/systemErrors';
import { describeError } from '../../utils/errors';

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

const createVariableDraft = (variable?: TemplateVariable): VariableDraft => ({
 id: createDraftId(),
 name: variable?.name ?? '',
 description: variable?.description ?? '',
 defaultValue: variable?.default ?? '',
 required: Boolean(variable?.required),
 input: variable?.input ?? 'text',
 rules: variable?.rules?.join('; ') ?? '',
});

const createImageOptionDraft = (option?: Partial<TemplateImageOption>): ImageOptionDraft => ({
 id: createDraftId(),
 name: option?.name ?? '',
 label: option?.label ?? '',
 image: option?.image ?? '',
});

type EditProps = {
 template: Template;
 open?: boolean;
 onOpenChange?: (open: boolean) => void;
 /** ID of a newly-created nest to auto-select (passed from parent after return-from-nests flow) */
 createdNestId?: string | null;
};

function TemplateEditModal({ template, open: controlledOpen, onOpenChange, createdNestId }: EditProps) {
 const { t } = useTranslation('templates');
 const [internalOpen, setInternalOpen] = useState(false);
 const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
 const setOpen = (value: boolean) => {
 setInternalOpen(value);
 onOpenChange?.(value);
 };
 const importFileRef = useRef<HTMLInputElement | null>(null);
 const [name, setName] = useState(template.name);
 const [description, setDescription] = useState(template.description ?? '');
 const [author, setAuthor] = useState(template.author);
 const [version, setVersion] = useState(template.version);
 const [image, setImage] = useState(template.image);
 const [installImage, setInstallImage] = useState(template.installImage ?? '');
 const [imageOptions, setImageOptions] = useState<ImageOptionDraft[]>(
  (template.images ?? []).map((option) => createImageOptionDraft(option)),
 );
 const [defaultImage, setDefaultImage] = useState(template.defaultImage ?? '');
 const [startup, setStartup] = useState(template.startup);
 const [stopCommand, setStopCommand] = useState(template.stopCommand);
 const [sendSignalTo, setSendSignalTo] = useState<'SIGTERM' | 'SIGINT' | 'SIGKILL'>(
 template.sendSignalTo === 'SIGKILL'
 ? 'SIGKILL'
 : template.sendSignalTo === 'SIGINT'
 ? 'SIGINT'
 : 'SIGTERM',
 );
 const [installScript, setInstallScript] = useState(template.installScript ?? '');
 const [configFile, setConfigFile] = useState(template.features?.configFile ?? '');
 const [configFiles, setConfigFiles] = useState<string[]>(template.features?.configFiles ?? []);
 const [supportedPorts, setSupportedPorts] = useState(
 template.supportedPorts?.length ? template.supportedPorts.join(', ') : '25565',
 );
 const [allocatedMemoryMb, setAllocatedMemoryMb] = useState(String(template.allocatedMemoryMb));
 const [allocatedCpuCores, setAllocatedCpuCores] = useState(String(template.allocatedCpuCores));
 const [iconUrl, setIconUrl] = useState(template.features?.iconUrl ?? '');
 const [restartOnExit, setRestartOnExit] = useState(template.features?.restartOnExit ?? false);
 const [maxInstances, setMaxInstances] = useState(String(template.features?.maxInstances ?? ''));
 const [backupPaths, setBackupPaths] = useState(template.features?.backupPaths?.join(', ') ?? '');
 const [fileEditorEnabled, setFileEditorEnabled] = useState(
 template.features?.fileEditor?.enabled ?? true,
 );
 const [fileEditorRestrictedPaths, setFileEditorRestrictedPaths] = useState(
 template.features?.fileEditor?.restrictedPaths?.join(', ') ?? '',
 );
 const [templateFeatures, setTemplateFeatures] = useState<Record<string, any>>(
 template.features ?? {},
 );
 const [variables, setVariables] = useState<VariableDraft[]>(
 template.variables?.length
 ? template.variables.map((variable) => createVariableDraft(variable))
 : [createVariableDraft()],
 );
 const [importError, setImportError] = useState('');
 const [modManagerEnabled, setModManagerEnabled] = useState(!!template.features?.modManager);
 const [modProviders, setModProviders] = useState<string[]>(
 extractProviderIds(template.features?.modManager?.providers),
 );
 const [pluginManagerEnabled, setPluginManagerEnabled] = useState(
 !!template.features?.pluginManager,
 );
 const [pluginProviders, setPluginProviders] = useState<string[]>(
 extractProviderIds(template.features?.pluginManager?.providers),
 );
 const [nestId, setNestId] = useState(template.nestId || '');
 // Auto-select a newly created nest when returning from the nests manager.
 // Use the"previous prop" pattern to sync state without an effect.
 const [prevCreatedNestId, setPrevCreatedNestId] = useState<string | null | undefined>(undefined);
 if (createdNestId !== prevCreatedNestId && createdNestId) {
 setPrevCreatedNestId(createdNestId);
 setNestId(createdNestId);
 } else if (createdNestId !== prevCreatedNestId) {
 setPrevCreatedNestId(createdNestId);
 }

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

 const resetFromTemplate = () => {
 setImportError('');
 setName(template.name);
 setDescription(template.description ?? '');
 setAuthor(template.author);
 setVersion(template.version);
 setImage(template.image);
 setInstallImage(template.installImage ?? '');
 setImageOptions((template.images ?? []).map((option) => createImageOptionDraft(option)));
 setDefaultImage(template.defaultImage ?? '');
 setStartup(template.startup);
 setStopCommand(template.stopCommand);
 setSendSignalTo(
 template.sendSignalTo === 'SIGKILL'
 ? 'SIGKILL'
 : template.sendSignalTo === 'SIGINT'
 ? 'SIGINT'
 : 'SIGTERM',
 );
 setInstallScript(template.installScript ?? '');
 setConfigFile(template.features?.configFile ?? '');
 setConfigFiles(
 template.features?.configFiles ??
 (template.features?.configFile ? [template.features.configFile] : []),
 );
 setSupportedPorts(
 template.supportedPorts?.length ? template.supportedPorts.join(', ') : '25565',
 );
 setAllocatedMemoryMb(String(template.allocatedMemoryMb));
 setAllocatedCpuCores(String(template.allocatedCpuCores));
 setIconUrl(template.features?.iconUrl ?? '');
 setRestartOnExit(template.features?.restartOnExit ?? false);
 setMaxInstances(String(template.features?.maxInstances ?? ''));
 setBackupPaths(template.features?.backupPaths?.join(', ') ?? '');
 setFileEditorEnabled(template.features?.fileEditor?.enabled ?? true);
 setFileEditorRestrictedPaths(template.features?.fileEditor?.restrictedPaths?.join(', ') ?? '');
 setTemplateFeatures(template.features ?? {});
 setModManagerEnabled(!!template.features?.modManager);
 setModProviders(extractProviderIds(template.features?.modManager?.providers));
 setPluginManagerEnabled(!!template.features?.pluginManager);
 setPluginProviders(extractProviderIds(template.features?.pluginManager?.providers));
 setNestId(template.nestId || '');
 setVariables(
 template.variables?.length
 ? template.variables.map((variable) => createVariableDraft(variable))
 : [createVariableDraft()],
 );
 };

 const applyTemplateImport = (raw: any) => {
 if (!raw || typeof raw !== 'object') {
 setImportError(t('create.invalidJson'));
 return;
 }
 const payload: any = normalizeTemplateImport(raw);
 setImportError('');
 setName(String(payload.name ?? ''));
 setDescription(String(payload.description ?? ''));
 setAuthor(String(payload.author ?? ''));
 setVersion(String(payload.version ?? ''));
 setImage(String(payload.image ?? ''));
 setImageOptions(
 Array.isArray(payload.images)
 ? payload.images.map((option: any) =>
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
 setConfigFile(String(payload.features?.configFile ?? ''));
 setConfigFiles(
 Array.isArray(payload.features?.configFiles)
 ? payload.features.configFiles
 : payload.features?.configFile
 ? [String(payload.features.configFile)]
 : [],
 );
 setSupportedPorts(
 Array.isArray(payload.supportedPorts) ? payload.supportedPorts.join(', ') : '25565',
 );
 setAllocatedMemoryMb(payload.allocatedMemoryMb ? String(payload.allocatedMemoryMb) : '1024');
 setAllocatedCpuCores(payload.allocatedCpuCores ? String(payload.allocatedCpuCores) : '2');
 setIconUrl(String(payload.features?.iconUrl ?? ''));
 setRestartOnExit(Boolean(payload.features?.restartOnExit));
 setMaxInstances(String(payload.features?.maxInstances ?? ''));
 setBackupPaths(
 Array.isArray(payload.features?.backupPaths) ? payload.features.backupPaths.join(', ') : '',
 );
 setFileEditorEnabled(payload.features?.fileEditor?.enabled !== false);
 setFileEditorRestrictedPaths(
 Array.isArray(payload.features?.fileEditor?.restrictedPaths)
 ? payload.features.fileEditor.restrictedPaths.join(', ')
 : '',
 );
 setTemplateFeatures(payload.features ?? {});
 setModManagerEnabled(!!payload.features?.modManager);
 setModProviders(extractProviderIds((payload.features?.modManager as any)?.providers));
 setPluginManagerEnabled(!!payload.features?.pluginManager);
 setPluginProviders(extractProviderIds((payload.features?.pluginManager as any)?.providers));
 const importedVariables = Array.isArray(payload.variables)
 ? payload.variables.map((variable: any) => ({
 id: createDraftId(),
 name: String(variable?.name ?? ''),
 description: String(variable?.description ?? ''),
 defaultValue: String(variable?.default ?? ''),
 required: Boolean(variable?.required),
 input: variable?.input ?? 'text',
 rules: Array.isArray(variable?.rules) ? variable.rules.join('; ') : '',
 }))
 : [];
 setVariables(importedVariables.length ? importedVariables : [createVariableDraft()]);
 };

 const handleImportFile = (event: ChangeEvent<HTMLInputElement>) => {
 const file = event.target.files?.[0];
 if (!file) return;
 setImportError('');
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
 component: 'TemplateEditModal',
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
 reader.readAsText(file);
 event.target.value = '';
 };

 const mutation = useMutation({
 mutationFn: () =>
 templatesApi.update(template.id, {
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
          iconUrl: iconUrl || undefined,
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
 modManager: {
 ...((templateFeatures?.modManager as any)?.targets
 ? { targets: (templateFeatures.modManager as any).targets }
 : {}),
 ...((templateFeatures?.modManager as any)?.paths
 ? { paths: (templateFeatures.modManager as any).paths }
 : {}),
 providers: modProviders,
 },
 }
 : {}),
 ...(pluginManagerEnabled && pluginProviders.length
 ? {
 pluginManager: {
 ...((templateFeatures?.pluginManager as any)?.paths
 ? { paths: (templateFeatures.pluginManager as any).paths }
 : {}),
 providers: pluginProviders,
 },
 }
 : {}),
 },
 nestId: nestId || null,
 }),
 onSuccess: () => {
 notifySuccess(t('edit.updated'));
 setOpen(false);
 },
 onError: (error: unknown) => {
  notifyError(error, 'templates:edit.updateError');
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.templates() });
 queryClient.invalidateQueries({ queryKey: qk.template(template.id) });
 },
 });

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
 <>
 {controlledOpen === undefined && (
 <button
 className="h-8 rounded-sm border border-border/60 px-3 text-mini font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
 onClick={() => {
 resetFromTemplate();
 setOpen(true);
 }}
 >
 {t('edit.button')}
 </button>
 )}
 <Dialog open={open} onOpenChange={setOpen}>
 <DialogContent size="2xl">
 <DialogHeader>
 <DialogTitle>{t('edit.title')}</DialogTitle>
 <DialogDescription>
 {t('edit.description')}
 </DialogDescription>
 </DialogHeader>
 <DialogToolbar>
 <div className="flex flex-wrap items-center gap-2">
 <Button
 variant="outline"
 size="sm"
 className="h-8 px-3 text-mini"
 onClick={() => importFileRef.current?.click()}
 >
 {t('form.import')}
 </Button>
 <input
 ref={importFileRef}
 type="file"
 accept="application/json,.json,application/x-yaml,.yaml,.yml"
 onChange={handleImportFile}
 className="hidden"
 />
 </div>
 </DialogToolbar>
 <DialogBody className="space-y-6">
 {importError ? (
 <p className="rounded-sm border border-danger/30 bg-danger/5 px-3 py-2 text-mini text-danger">
 {importError}
 </p>
 ) : null}
 <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
 <label className="block space-y-1">
 <span className="type-overline">{t('form.name')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={name}
 onChange={(event) => setName(event.target.value)}
 />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.author')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={author}
 onChange={(event) => setAuthor(event.target.value)}
 />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.nestOptional')}</span>
 <Combobox
 value={nestId || '__none__'}
 onChange={(v) => setNestId(v === '__none__' ? '' : v)}
 options={[
 { value: '__none__', label: t('edit.none'), keywords: [t('edit.none')] },
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
 placeholder={t('edit.none')}
 searchPlaceholder={t('create.searchNests')}
 emptyMessage={t('create.noNestsFound')}
 />
 {nests.length === 0 && (
 <p className="type-meta mt-1">
 {t('edit.noNests')}{' '}
 <Link
 to="/admin/templates"
 onClick={(e) => {
 e.preventDefault();
 window.dispatchEvent(new CustomEvent('catalyst:open-nests-modal', { detail: { returnTo: 'template-edit' } }));
 }}
 className="inline-flex items-center gap-0.5 font-medium text-primary hover:text-primary"
 >
 {t('edit.createOne')}
</Link>{' '}
  {t('edit.noNestsSuffix')}
 </p>
 )}
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.version')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={version}
 onChange={(event) => setVersion(event.target.value)}
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
 </div>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.description')}</span>
 <textarea
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 rows={2}
 value={description}
 onChange={(event) => setDescription(event.target.value)}
 />
 </label>
 <div className="space-y-3 border-t border-border/50 pt-3">
 <div className="type-overline">
   {t('form.runtimeImages')}
 </div>
 <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
 <label className="block space-y-1">
 <span className="type-overline">{t('form.containerImage')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={image}
 onChange={(event) => setImage(event.target.value)}
 />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.defaultImage')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={defaultImage}
 onChange={(event) => setDefaultImage(event.target.value)}
 />
 </label>
 <label className="block space-y-1 md:col-span-2">
 <span className="type-overline">{t('form.installImage')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={installImage}
 onChange={(event) => setInstallImage(event.target.value)}
 />
 </label>
 </div>
 <div className="space-y-2 border-t border-border/50 pt-3">
 <div className="flex flex-wrap items-center justify-between gap-2">
 <div className="type-overline">
   {t('form.imageVariants')}
 </div>
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
 <div className="space-y-3 border-t border-border/50 pt-3">
 <div className="type-overline">
   {t('form.commandsConfig')}
 </div>
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
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 rows={2}
 value={startup}
 onChange={(event) => setStartup(event.target.value)}
 />
 </label>
 <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
 <label className="block space-y-1 md:col-span-2">
 <span className="type-overline">{t('form.stopCommand')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={stopCommand}
 onChange={(event) => setStopCommand(event.target.value)}
 />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('form.signal')}</span>
 <select
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={sendSignalTo}
 onChange={(event) =>
 setSendSignalTo(event.target.value as 'SIGTERM' | 'SIGINT' | 'SIGKILL')
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
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 rows={5}
 value={installScript}
 onChange={(event) => setInstallScript(event.target.value)}
 />
 </label>
 </div>
 <div className="space-y-3 border-t border-border/50 pt-3">
 <div className="type-overline">
   {t('form.resourcesPorts')}
 </div>
 <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
 <label className="block space-y-1">
 <span className="type-overline">{t('form.ports')}</span>
 <input
 className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={supportedPorts}
 onChange={(event) => setSupportedPorts(event.target.value)}
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
 <div className="space-y-3 border-t border-border/50 pt-3">
 <div className="flex flex-wrap items-center justify-between gap-2">
 <h3 className="type-overline">
   {t('form.variables')}
 </h3>
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
 <div className="space-y-3 border-t border-border/50 pt-3">
 <div className="type-overline">
   {t('form.advancedFeatures')}
 </div>
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
 </DialogBody>
 <DialogFooter className="sm:justify-between">
 <div className="space-y-1">
 {missingFields.length > 0 ? (
 <div className="text-micro">
 <span className="type-overline">
 {t('form.missingFields')}{' '}
 </span>
 <span className="text-warning font-medium">
 {missingFields.join(', ')}
 </span>
 </div>
 ) : (
 <span className="text-micro text-muted-foreground">
 {t('edit.changesApply')}
 </span>
 )}
 </div>
 <div className="flex gap-2">
 <Button variant="outline" size="sm" className="h-8 px-3 text-mini" onClick={() => setOpen(false)}>
 {t('common:actions.cancel')}
 </Button>
 <Button size="sm" className="h-8 px-3 text-mini" onClick={() => mutation.mutate()} disabled={disableSubmit}>
 {mutation.isPending ? t('edit.saving') : t('edit.save')}
 </Button>
 </div>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 </>
 );
}

export default TemplateEditModal;