import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TemplateImageOption, TemplateVariable } from '../../types/template';
import { templatesApi } from '../../services/api/templates';
import { notifyError, notifySuccess } from '../../utils/notify';
import { normalizeTemplateImport, parseEggContent } from '../../utils/pterodactylImport';
import TemplateProviderEditor, { extractProviderIds } from './TemplateProviderEditor';
import { ModalPortal } from '@/components/ui/modal-portal';

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
  const queryClient = useQueryClient();

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
      sendSignalTo: payload.sendSignalTo === 'SIGKILL' ? 'SIGKILL' : payload.sendSignalTo === 'SIGINT' ? 'SIGINT' : 'SIGTERM',
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
        ...(Array.isArray(features.configFiles)
          ? { configFiles: features.configFiles }
          : {}),
        ...(features.restartOnExit ? { restartOnExit: Boolean(features.restartOnExit) } : {}),
        ...(features.maxInstances ? { maxInstances: Number(features.maxInstances) } : {}),
        ...(Array.isArray(features.backupPaths) ? { backupPaths: features.backupPaths } : {}),
        ...(features.fileEditor ? (() => {
          const fe = features.fileEditor as Record<string, unknown>;
          return {
            fileEditor: {
              enabled: Boolean(fe.enabled),
              ...(Array.isArray(fe.restrictedPaths) ? { restrictedPaths: fe.restrictedPaths } : {}),
            },
          };
        })() : {}),
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
          ...(backupPaths ? { backupPaths: backupPaths.split(',').map(p => p.trim()).filter(Boolean) } : {}),
          ...(fileEditorEnabled ? {
            fileEditor: {
              enabled: fileEditorEnabled,
              ...(fileEditorRestrictedPaths ? { restrictedPaths: fileEditorRestrictedPaths.split(',').map(p => p.trim()).filter(Boolean) } : {}),
            },
          } : { fileEditor: { enabled: false } }),
          ...(modManagerEnabled && modProviders.length ? {
            modManager: { providers: modProviders },
          } : {}),
          ...(pluginManagerEnabled && pluginProviders.length ? {
            pluginManager: { providers: pluginProviders },
          } : {}),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
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
      setVariables([createVariableDraft()]);
      setImportError('');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to create template';
      notifyError(message);
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
      payload.sendSignalTo === 'SIGKILL' ? 'SIGKILL' : payload.sendSignalTo === 'SIGINT' ? 'SIGINT' : 'SIGTERM',
    );
    setInstallScript(String(payload.installScript ?? ''));
    const features = (payload.features ?? {}) as Record<string, unknown>;
    setConfigFile(String(features.configFile ?? ''));
    setConfigFiles(Array.isArray(features.configFiles) ? (features.configFiles as unknown[]).map(String) : features.configFile ? [String(features.configFile)] : []);
    setSupportedPorts(
      Array.isArray(payload.supportedPorts)
        ? (payload.supportedPorts as unknown[]).join(', ')
        : '25565',
    );
    setAllocatedMemoryMb(
      payload.allocatedMemoryMb ? String(payload.allocatedMemoryMb) : '1024',
    );
    setAllocatedCpuCores(
      payload.allocatedCpuCores ? String(payload.allocatedCpuCores) : '2',
    );
    setIconUrl(String(features.iconUrl ?? ''));
    setRestartOnExit(Boolean(features.restartOnExit));
    setMaxInstances(String(features.maxInstances ?? ''));
    setBackupPaths(Array.isArray(features.backupPaths) ? (features.backupPaths as unknown[]).join(', ') : '');
    setFileEditorEnabled(features.fileEditor !== false);
    const fileEditor = features.fileEditor as Record<string, unknown> | undefined;
    setFileEditorRestrictedPaths(Array.isArray(fileEditor?.restrictedPaths) ? (fileEditor.restrictedPaths as unknown[]).join(', ') : '');
    setTemplateFeatures(payload.features ?? {});
    setModManagerEnabled(!!payload.features?.modManager);
    setModProviders(extractProviderIds((payload.features?.modManager as any)?.providers));
    setPluginManagerEnabled(!!payload.features?.pluginManager);
    setPluginProviders(extractProviderIds((payload.features?.pluginManager as any)?.providers));
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
          return { ok: false };
        }
      }),
    );
    const successCount = results.filter((result) => result.ok).length;
    const failureCount = results.length - successCount;
    if (successCount) {
      notifySuccess(`Imported ${successCount} template${successCount === 1 ? '' : 's'}`);
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    }
    if (failureCount) {
      notifyError(`${failureCount} template${failureCount === 1 ? '' : 's'} failed to import`);
    }
    event.target.value = '';
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
  }, [name, author, version, image, startup, stopCommand, sendSignalTo, parsedPorts.length, allocatedMemoryMb, allocatedCpuCores]);

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button
          className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500"
          onClick={() => {
            setImportError('');
            setOpen(true);
          }}
        >
          New Template
        </button>
        <button
          className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground transition-all duration-300 hover:border-primary-500 hover:text-foreground dark:border-border dark:text-zinc-300 dark:hover:border-primary/30"
          onClick={() => importFileRef.current?.click()}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-10 backdrop-blur-sm">
          <div className="flex w-full max-w-4xl max-h-[90vh] flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-2xl transition-all duration-300 dark:border-border dark:bg-surface-1">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-5 dark:border-border">
              <div>
                <h2 className="text-lg font-semibold text-foreground dark:text-white">
                  Create template
                </h2>
                <p className="text-xs text-muted-foreground dark:text-muted-foreground">
                  Define runtime images, resources, and startup commands.
                </p>
              </div>
              <button
                className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-foreground transition-all duration-300 hover:border-primary-500 dark:border-border dark:text-zinc-300 dark:hover:border-primary/30"
                onClick={() => {
                  setOpen(false);
                  setImportError('');
                }}
              >
                Close
              </button>
            </div>
            <div className="space-y-6 overflow-y-auto px-6 py-5 text-sm text-muted-foreground dark:text-zinc-300">
              {importError ? (
                <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-500 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                  {importError}
                </p>
              ) : null}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="block space-y-1">
                  <span className="text-muted-foreground dark:text-muted-foreground">Name</span>
                  <input
                    className="w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Minecraft Paper"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-muted-foreground dark:text-muted-foreground">Author</span>
                  <input
                    className="w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                    value={author}
                    onChange={(event) => setAuthor(event.target.value)}
                    placeholder="Catalyst Maintainers"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-muted-foreground dark:text-muted-foreground">Version</span>
                  <input
                    className="w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                    value={version}
                    onChange={(event) => setVersion(event.target.value)}
                    placeholder="1.20.4"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-muted-foreground dark:text-muted-foreground">Icon URL (optional)</span>
                  <input
                    className="w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                    value={iconUrl}
                    onChange={(event) => setIconUrl(event.target.value)}
                    placeholder="https://example.com/icon.png"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-muted-foreground dark:text-muted-foreground">Import template (optional)</span>
                  <input
                    className="w-full rounded-lg border border-border bg-white px-3 py-2 text-xs text-foreground transition-all duration-300 file:mr-3 file:rounded-md file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-muted-foreground hover:file:bg-surface-3 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:file:bg-surface-2 dark:file:text-muted-foreground dark:text-zinc-200 dark:hover:file:bg-surface-2"
                    type="file"
                    accept="application/json,.json,application/x-yaml,.yaml,.yml"
                    onChange={handleImportFile}
                  />
                  {importError ? <p className="text-xs text-rose-400">{importError}</p> : null}
                </label>
              </div>
              <label className="block space-y-1">
                <span className="text-muted-foreground dark:text-muted-foreground">Description</span>
                <textarea
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                  rows={2}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Template summary"
                />
              </label>
              <div className="space-y-3 rounded-2xl border border-border bg-surface-2 p-4 transition-all duration-300 dark:border-border dark:bg-surface-1/40">
                <div className="text-sm font-semibold text-foreground dark:text-zinc-200">
                  Runtime images
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label className="block space-y-1">
                    <span className="text-muted-foreground dark:text-muted-foreground">Container image</span>
                    <input
                      className="w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                      value={image}
                      onChange={(event) => setImage(event.target.value)}
                      placeholder="itzg/minecraft-server:latest"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-muted-foreground dark:text-muted-foreground">
                      Default image (optional)
                    </span>
                    <input
                      className="w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                      value={defaultImage}
                      onChange={(event) => setDefaultImage(event.target.value)}
                      placeholder="eclipse-temurin:21-jre"
                    />
                  </label>
                  <label className="block space-y-1 md:col-span-2">
                    <span className="text-muted-foreground dark:text-muted-foreground">Install image (optional)</span>
                    <input
                      className="w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                      value={installImage}
                      onChange={(event) => setInstallImage(event.target.value)}
                      placeholder="alpine:3.19"
                    />
                  </label>
                </div>
                <div className="space-y-3 rounded-lg border border-border bg-white p-3 transition-all duration-300 dark:border-border dark:bg-zinc-950/40">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-muted-foreground dark:text-zinc-300">
                      Image variants
                    </div>
                    <button
                      className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-foreground transition-all duration-300 hover:border-primary-500 hover:text-foreground dark:border-border dark:text-zinc-300 dark:hover:border-primary/30"
                      onClick={() =>
                        setImageOptions((prev) => [...prev, { name: '', label: '', image: '' }])
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
                            <span className="text-xs text-muted-foreground dark:text-muted-foreground">Name</span>
                            <input
                              className="w-full rounded-md border border-border bg-white px-2 py-1.5 text-xs text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-border dark:bg-surface-1 dark:text-zinc-200"
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
                            <span className="text-xs text-muted-foreground dark:text-muted-foreground">Label</span>
                            <input
                              className="w-full rounded-md border border-border bg-white px-2 py-1.5 text-xs text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-border dark:bg-surface-1 dark:text-zinc-200"
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
                            <span className="text-xs text-muted-foreground dark:text-muted-foreground">Image</span>
                            <input
                              className="w-full rounded-md border border-border bg-white px-2 py-1.5 text-xs text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-border dark:bg-surface-1 dark:text-zinc-200"
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
                            className="rounded-full border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-600 transition-all duration-300 hover:border-rose-400 dark:border-rose-500/30 dark:text-rose-300"
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
                    <p className="text-xs text-muted-foreground dark:text-muted-foreground">
                      Add optional image variants for selectable runtimes.
                    </p>
                  )}
                </div>
              </div>
              <div className="space-y-3 rounded-2xl border border-border bg-surface-2 p-4 transition-all duration-300 dark:border-border dark:bg-surface-1/40">
                <div className="text-sm font-semibold text-foreground dark:text-zinc-200">
                  Commands & config
                </div>
                <label className="block space-y-1">
                  <span className="text-muted-foreground dark:text-muted-foreground">Config file path (optional)</span>
                  <input
                    className="w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                    value={configFile}
                    onChange={(event) => setConfigFile(event.target.value)}
                    placeholder="/config/server.properties"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-muted-foreground dark:text-muted-foreground">Config files (optional)</span>
                  <input
                    className="w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
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
                  <span className="text-muted-foreground dark:text-muted-foreground">Startup command</span>
                  <textarea
                    className="w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                    rows={2}
                    value={startup}
                    onChange={(event) => setStartup(event.target.value)}
                    placeholder="java -Xmx{{MEMORY}}M -jar server.jar"
                  />
                </label>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <label className="block space-y-1 md:col-span-2">
                    <span className="text-muted-foreground dark:text-muted-foreground">Stop command</span>
                    <input
                      className="w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                      value={stopCommand}
                      onChange={(event) => setStopCommand(event.target.value)}
                      placeholder="stop"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-muted-foreground dark:text-muted-foreground">Signal</span>
                    <select
                      className="w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
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
                  <span className="text-muted-foreground dark:text-muted-foreground">Install script (optional)</span>
                  <textarea
                    className="w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                    rows={5}
                    value={installScript}
                    onChange={(event) => setInstallScript(event.target.value)}
                    placeholder="#!/bin/sh"
                  />
                </label>
              </div>
              <div className="space-y-3 rounded-2xl border border-border bg-surface-2 p-4 transition-all duration-300 dark:border-border dark:bg-surface-1/40">
                <div className="text-sm font-semibold text-foreground dark:text-zinc-200">
                  Resources & ports
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <label className="block space-y-1">
                    <span className="text-muted-foreground dark:text-muted-foreground">Ports (comma separated)</span>
                    <input
                      className="w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                      value={supportedPorts}
                      onChange={(event) => setSupportedPorts(event.target.value)}
                      placeholder="25565, 25566"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-muted-foreground dark:text-muted-foreground">Allocated memory (MB)</span>
                    <input
                      className="w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                      type="number"
                      min={128}
                      value={allocatedMemoryMb}
                      onChange={(event) => setAllocatedMemoryMb(event.target.value)}
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-muted-foreground dark:text-muted-foreground">Allocated CPU cores</span>
                    <input
                      className="w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                      type="number"
                      min={1}
                      step={1}
                      value={allocatedCpuCores}
                      onChange={(event) => setAllocatedCpuCores(event.target.value)}
                    />
                  </label>
                </div>
              </div>
              <div className="space-y-3 rounded-2xl border border-border bg-surface-2 p-4 transition-all duration-300 dark:border-border dark:bg-surface-1/40">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-foreground dark:text-zinc-200">
                    Variables
                  </h3>
                  <button
                    className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-foreground transition-all duration-300 hover:border-primary-500 hover:text-foreground dark:border-border dark:text-zinc-300 dark:hover:border-primary/30"
                    onClick={() => setVariables((prev) => [...prev, createVariableDraft()])}
                    type="button"
                  >
                    Add variable
                  </button>
                </div>
                {variables.map((variable, index) => (
                  <div
                    key={`${variable.name}-${index}`}
                    className="rounded-xl border border-border bg-white p-3 transition-all duration-300 hover:border-primary-500 dark:border-border dark:bg-zinc-950/40 dark:hover:border-primary/30"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold text-muted-foreground dark:text-zinc-300">
                        Variable {index + 1}
                      </div>
                      {variables.length > 1 ? (
                        <button
                          className="text-xs text-rose-500 transition-all duration-300 hover:text-rose-400 dark:text-rose-300"
                          onClick={() =>
                            setVariables((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
                          }
                          type="button"
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                      <label className="block space-y-1">
                        <span className="text-muted-foreground dark:text-muted-foreground">Name</span>
                        <input
                          className="w-full rounded-md border border-border bg-white px-2 py-1.5 text-xs text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                          value={variable.name}
                          onChange={(event) =>
                            setVariables((prev) =>
                              prev.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, name: event.target.value } : item,
                              ),
                            )
                          }
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-muted-foreground dark:text-muted-foreground">Default</span>
                        <input
                          className="w-full rounded-md border border-border bg-white px-2 py-1.5 text-xs text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
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
                        <span className="text-muted-foreground dark:text-muted-foreground">Description</span>
                        <input
                          className="w-full rounded-md border border-border bg-white px-2 py-1.5 text-xs text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
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
                      <label className="flex items-center gap-2 text-xs text-muted-foreground dark:text-zinc-300">
                        <input
                          type="checkbox"
                          className="rounded border-border bg-white text-primary-600 focus:ring-primary-500 dark:border-border dark:bg-surface-1 dark:text-primary-400 dark:focus:ring-primary-400"
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
                        <span className="text-muted-foreground dark:text-muted-foreground">Input type</span>
                        <select
                          className="w-full rounded-md border border-border bg-white px-2 py-1.5 text-xs text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
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
                        <span className="text-muted-foreground dark:text-muted-foreground">
                          Rules (semicolon separated)
                        </span>
                        <input
                          className="w-full rounded-md border border-border bg-white px-2 py-1.5 text-xs text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                          value={variable.rules}
                          onChange={(event) =>
                            setVariables((prev) =>
                              prev.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, rules: event.target.value } : item,
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
              <div className="space-y-3 rounded-2xl border border-border bg-surface-2 p-4 transition-all duration-300 dark:border-border dark:bg-surface-1/40">
                <div className="text-sm font-semibold text-foreground dark:text-zinc-200">
                  Advanced features
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground dark:text-zinc-300">
                    <input
                      type="checkbox"
                      className="rounded border-border bg-white text-primary-600 focus:ring-primary-500 dark:border-border dark:bg-surface-1 dark:text-primary-400 dark:focus:ring-primary-400"
                      checked={restartOnExit}
                      onChange={(event) => setRestartOnExit(event.target.checked)}
                    />
                    Restart on exit
                  </label>
                  <label className="block space-y-1">
                    <span className="text-muted-foreground dark:text-muted-foreground">Max instances (optional)</span>
                    <input
                      className="w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                      type="number"
                      min={1}
                      value={maxInstances}
                      onChange={(event) => setMaxInstances(event.target.value)}
                      placeholder="Unlimited"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground dark:text-zinc-300">
                    <input
                      type="checkbox"
                      className="rounded border-border bg-white text-primary-600 focus:ring-primary-500 dark:border-border dark:bg-surface-1 dark:text-primary-400 dark:focus:ring-primary-400"
                      checked={fileEditorEnabled}
                      onChange={(event) => setFileEditorEnabled(event.target.checked)}
                    />
                    Enable file editor
                  </label>
                  <label className="block space-y-1">
                    <span className="text-muted-foreground dark:text-muted-foreground">File editor restricted paths (optional)</span>
                    <input
                      className="w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                      value={fileEditorRestrictedPaths}
                      onChange={(event) => setFileEditorRestrictedPaths(event.target.value)}
                      placeholder="/sensitive, /config"
                    />
                  </label>
                </div>
                <label className="block space-y-1">
                  <span className="text-muted-foreground dark:text-muted-foreground">Backup paths (optional)</span>
                  <input
                    className="w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
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
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-4 text-xs dark:border-border">
              <div className="space-y-1">
                {missingFields.length > 0 ? (
                  <div className="text-xs">
                    <span className="text-muted-foreground dark:text-muted-foreground">Missing required fields: </span>
                    <span className="text-amber-600 dark:text-amber-400 font-medium">
                      {missingFields.join(', ')}
                    </span>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground dark:text-muted-foreground">
                    Templates are available immediately after creation.
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  className="rounded-full border border-border px-4 py-2 font-semibold text-muted-foreground transition-all duration-300 hover:border-primary-500 hover:text-foreground dark:border-border dark:text-zinc-300 dark:hover:border-primary/30"
                  onClick={() => {
                    setOpen(false);
                    setImportError('');
                  }}
                >
                  Cancel
                </button>
                <button
                  className="rounded-full bg-primary-600 px-4 py-2 font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
                  onClick={() => mutation.mutate()}
                  disabled={disableSubmit}
                >
                  {mutation.isPending ? 'Creating...' : 'Create template'}
                </button>
              </div>
            </div>
          </div>
        </div>
        </ModalPortal>
      ) : null}
    </div>
  );
}

export default TemplateCreateModal;
