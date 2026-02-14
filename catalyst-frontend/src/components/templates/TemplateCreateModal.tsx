import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TemplateImageOption, TemplateVariable } from '../../types/template';
import { templatesApi } from '../../services/api/templates';
import { notifyError, notifySuccess } from '../../utils/notify';
import { normalizeTemplateImport, parseEggContent } from '../../utils/pterodactylImport';

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

  const buildTemplatePayload = (raw: any) => {
    const payload = normalizeTemplateImport(raw) as any;
    const toNumber = (value: unknown, fallback: number) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    };
    const ports = Array.isArray(payload.supportedPorts)
      ? payload.supportedPorts
          .map((port: unknown) => Number(port))
          .filter((value: number) => Number.isFinite(value) && value > 0)
      : [];
    const variablesPayload = Array.isArray(payload.variables)
      ? payload.variables
          .map((variable: any) => ({
            name: String(variable?.name ?? '').trim(),
            description: variable?.description ? String(variable.description) : undefined,
            default: String(variable?.default ?? ''),
            required: Boolean(variable?.required),
            input: variable?.input ?? 'text',
            rules: Array.isArray(variable?.rules) ? variable.rules : undefined,
          }))
          .filter((variable: TemplateVariable) => variable.name)
      : [];
    const imagesPayload = Array.isArray(payload.images)
      ? payload.images
          .map((option: any) => ({
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
      features: {
        ...templateFeatures,
        ...(payload.features ?? {}),
        iconUrl: payload.features?.iconUrl ? String(payload.features.iconUrl) : undefined,
        ...(payload.features?.configFile ? { configFile: String(payload.features.configFile) } : {}),
        ...(Array.isArray(payload.features?.configFiles)
          ? { configFiles: payload.features.configFiles }
          : {}),
        ...(payload.features?.restartOnExit ? { restartOnExit: Boolean(payload.features.restartOnExit) } : {}),
        ...(payload.features?.maxInstances ? { maxInstances: Number(payload.features.maxInstances) } : {}),
        ...(Array.isArray(payload.features?.backupPaths) ? { backupPaths: payload.features.backupPaths } : {}),
        ...(payload.features?.fileEditor ? {
          fileEditor: {
            enabled: Boolean(payload.features.fileEditor.enabled),
            ...(Array.isArray(payload.features.fileEditor.restrictedPaths) ? { restrictedPaths: payload.features.fileEditor.restrictedPaths } : {}),
          },
        } : {}),
      },
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
      setVariables([createVariableDraft()]);
      setImportError('');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to create template';
      notifyError(message);
    },
  });

  const applyTemplateImport = (raw: any) => {
    if (!raw || typeof raw !== 'object') {
      setImportError('Invalid template JSON');
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
        ? payload.images.map((option: any) => ({
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
    setConfigFile(String(payload.features?.configFile ?? ''));
    setConfigFiles(Array.isArray(payload.features?.configFiles) ? payload.features.configFiles : payload.features?.configFile ? [String(payload.features.configFile)] : []);
    setSupportedPorts(
      Array.isArray(payload.supportedPorts)
        ? payload.supportedPorts.join(', ')
        : '25565',
    );
    setAllocatedMemoryMb(
      payload.allocatedMemoryMb ? String(payload.allocatedMemoryMb) : '1024',
    );
    setAllocatedCpuCores(
      payload.allocatedCpuCores ? String(payload.allocatedCpuCores) : '2',
    );
    setIconUrl(String(payload.features?.iconUrl ?? ''));
    setRestartOnExit(Boolean(payload.features?.restartOnExit));
    setMaxInstances(String(payload.features?.maxInstances ?? ''));
    setBackupPaths(Array.isArray(payload.features?.backupPaths) ? payload.features.backupPaths.join(', ') : '');
    setFileEditorEnabled(payload.features?.fileEditor?.enabled !== false);
    setFileEditorRestrictedPaths(Array.isArray(payload.features?.fileEditor?.restrictedPaths) ? payload.features.fileEditor.restrictedPaths.join(', ') : '');
    setTemplateFeatures(payload.features ?? {});
    const importedVariables = Array.isArray(payload.variables)
      ? payload.variables.map((variable: any) => ({
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
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-10 backdrop-blur-sm">
          <div className="flex w-full max-w-4xl max-h-[90vh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl transition-all duration-300 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-5 dark:border-slate-800">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                  Create template
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Define runtime images, resources, and startup commands.
                </p>
              </div>
              <button
                className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-500 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => {
                  setOpen(false);
                  setImportError('');
                }}
              >
                Close
              </button>
            </div>
            <div className="space-y-6 overflow-y-auto px-6 py-5 text-sm text-slate-600 dark:text-slate-300">
              {importError ? (
                <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-500 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                  {importError}
                </p>
              ) : null}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="block space-y-1">
                  <span className="text-slate-500 dark:text-slate-400">Name</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Minecraft Paper"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-500 dark:text-slate-400">Author</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                    value={author}
                    onChange={(event) => setAuthor(event.target.value)}
                    placeholder="Catalyst Maintainers"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-500 dark:text-slate-400">Version</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                    value={version}
                    onChange={(event) => setVersion(event.target.value)}
                    placeholder="1.20.4"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-500 dark:text-slate-400">Icon URL (optional)</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                    value={iconUrl}
                    onChange={(event) => setIconUrl(event.target.value)}
                    placeholder="https://example.com/icon.png"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-500 dark:text-slate-400">Import template (optional)</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 transition-all duration-300 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-600 hover:file:bg-slate-200 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:file:bg-slate-800 dark:file:text-slate-600 dark:text-slate-200 dark:hover:file:bg-slate-700"
                    type="file"
                    accept="application/json,.json,application/x-yaml,.yaml,.yml"
                    onChange={handleImportFile}
                  />
                  {importError ? <p className="text-xs text-rose-400">{importError}</p> : null}
                </label>
              </div>
              <label className="block space-y-1">
                <span className="text-slate-500 dark:text-slate-400">Description</span>
                <textarea
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                  rows={2}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Template summary"
                />
              </label>
              <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 transition-all duration-300 dark:border-slate-800 dark:bg-slate-900/40">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-200">
                  Runtime images
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label className="block space-y-1">
                    <span className="text-slate-500 dark:text-slate-400">Container image</span>
                    <input
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                      value={image}
                      onChange={(event) => setImage(event.target.value)}
                      placeholder="itzg/minecraft-server:latest"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-slate-500 dark:text-slate-400">
                      Default image (optional)
                    </span>
                    <input
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                      value={defaultImage}
                      onChange={(event) => setDefaultImage(event.target.value)}
                      placeholder="eclipse-temurin:21-jre"
                    />
                  </label>
                  <label className="block space-y-1 md:col-span-2">
                    <span className="text-slate-500 dark:text-slate-400">Install image (optional)</span>
                    <input
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                      value={installImage}
                      onChange={(event) => setInstallImage(event.target.value)}
                      placeholder="alpine:3.19"
                    />
                  </label>
                </div>
                <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3 transition-all duration-300 dark:border-slate-800 dark:bg-slate-950/40">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                      Image variants
                    </div>
                    <button
                      className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
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
                            <span className="text-xs text-slate-500 dark:text-slate-400">Name</span>
                            <input
                              className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
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
                            <span className="text-xs text-slate-500 dark:text-slate-400">Label</span>
                            <input
                              className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
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
                            <span className="text-xs text-slate-500 dark:text-slate-400">Image</span>
                            <input
                              className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
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
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Add optional image variants for selectable runtimes.
                    </p>
                  )}
                </div>
              </div>
              <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 transition-all duration-300 dark:border-slate-800 dark:bg-slate-900/40">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-200">
                  Commands & config
                </div>
                <label className="block space-y-1">
                  <span className="text-slate-500 dark:text-slate-400">Config file path (optional)</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                    value={configFile}
                    onChange={(event) => setConfigFile(event.target.value)}
                    placeholder="/config/server.properties"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-500 dark:text-slate-400">Config files (optional)</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
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
                  <span className="text-slate-500 dark:text-slate-400">Startup command</span>
                  <textarea
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                    rows={2}
                    value={startup}
                    onChange={(event) => setStartup(event.target.value)}
                    placeholder="java -Xmx{{MEMORY}}M -jar server.jar"
                  />
                </label>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <label className="block space-y-1 md:col-span-2">
                    <span className="text-slate-500 dark:text-slate-400">Stop command</span>
                    <input
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                      value={stopCommand}
                      onChange={(event) => setStopCommand(event.target.value)}
                      placeholder="stop"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-slate-500 dark:text-slate-400">Signal</span>
                    <select
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
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
                  <span className="text-slate-500 dark:text-slate-400">Install script (optional)</span>
                  <textarea
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                    rows={5}
                    value={installScript}
                    onChange={(event) => setInstallScript(event.target.value)}
                    placeholder="#!/bin/sh"
                  />
                </label>
              </div>
              <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 transition-all duration-300 dark:border-slate-800 dark:bg-slate-900/40">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-200">
                  Resources & ports
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <label className="block space-y-1">
                    <span className="text-slate-500 dark:text-slate-400">Ports (comma separated)</span>
                    <input
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                      value={supportedPorts}
                      onChange={(event) => setSupportedPorts(event.target.value)}
                      placeholder="25565, 25566"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-slate-500 dark:text-slate-400">Allocated memory (MB)</span>
                    <input
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                      type="number"
                      min={128}
                      value={allocatedMemoryMb}
                      onChange={(event) => setAllocatedMemoryMb(event.target.value)}
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-slate-500 dark:text-slate-400">Allocated CPU cores</span>
                    <input
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                      type="number"
                      min={1}
                      step={1}
                      value={allocatedCpuCores}
                      onChange={(event) => setAllocatedCpuCores(event.target.value)}
                    />
                  </label>
                </div>
              </div>
              <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 transition-all duration-300 dark:border-slate-800 dark:bg-slate-900/40">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-200">
                    Variables
                  </h3>
                  <button
                    className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                    onClick={() => setVariables((prev) => [...prev, createVariableDraft()])}
                    type="button"
                  >
                    Add variable
                  </button>
                </div>
                {variables.map((variable, index) => (
                  <div
                    key={`${variable.name}-${index}`}
                    className="rounded-xl border border-slate-200 bg-white p-3 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-950/40 dark:hover:border-primary-500/30"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">
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
                        <span className="text-slate-500 dark:text-slate-400">Name</span>
                        <input
                          className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
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
                        <span className="text-slate-500 dark:text-slate-400">Default</span>
                        <input
                          className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
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
                        <span className="text-slate-500 dark:text-slate-400">Description</span>
                        <input
                          className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
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
                      <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-300">
                        <input
                          type="checkbox"
                          className="rounded border-slate-300 bg-white text-primary-600 focus:ring-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-primary-400 dark:focus:ring-primary-400"
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
                        <span className="text-slate-500 dark:text-slate-400">Input type</span>
                        <select
                          className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
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
                        <span className="text-slate-500 dark:text-slate-400">
                          Rules (semicolon separated)
                        </span>
                        <input
                          className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
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
              <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 transition-all duration-300 dark:border-slate-800 dark:bg-slate-900/40">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-200">
                  Advanced features
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-300">
                    <input
                      type="checkbox"
                      className="rounded border-slate-300 bg-white text-primary-600 focus:ring-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-primary-400 dark:focus:ring-primary-400"
                      checked={restartOnExit}
                      onChange={(event) => setRestartOnExit(event.target.checked)}
                    />
                    Restart on exit
                  </label>
                  <label className="block space-y-1">
                    <span className="text-slate-500 dark:text-slate-400">Max instances (optional)</span>
                    <input
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                      type="number"
                      min={1}
                      value={maxInstances}
                      onChange={(event) => setMaxInstances(event.target.value)}
                      placeholder="Unlimited"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-300">
                    <input
                      type="checkbox"
                      className="rounded border-slate-300 bg-white text-primary-600 focus:ring-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-primary-400 dark:focus:ring-primary-400"
                      checked={fileEditorEnabled}
                      onChange={(event) => setFileEditorEnabled(event.target.checked)}
                    />
                    Enable file editor
                  </label>
                  <label className="block space-y-1">
                    <span className="text-slate-500 dark:text-slate-400">File editor restricted paths (optional)</span>
                    <input
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                      value={fileEditorRestrictedPaths}
                      onChange={(event) => setFileEditorRestrictedPaths(event.target.value)}
                      placeholder="/sensitive, /config"
                    />
                  </label>
                </div>
                <label className="block space-y-1">
                  <span className="text-slate-500 dark:text-slate-400">Backup paths (optional)</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                    value={backupPaths}
                    onChange={(event) => setBackupPaths(event.target.value)}
                    placeholder="/world, /plugins, /config"
                  />
                </label>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-6 py-4 text-xs dark:border-slate-800">
              <div className="space-y-1">
                {missingFields.length > 0 ? (
                  <div className="text-xs">
                    <span className="text-slate-500 dark:text-slate-400">Missing required fields: </span>
                    <span className="text-amber-600 dark:text-amber-400 font-medium">
                      {missingFields.join(', ')}
                    </span>
                  </div>
                ) : (
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    Templates are available immediately after creation.
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  className="rounded-full border border-slate-200 px-4 py-2 font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
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
      ) : null}
    </div>
  );
}

export default TemplateCreateModal;
