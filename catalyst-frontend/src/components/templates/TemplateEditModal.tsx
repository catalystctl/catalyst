import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Template, TemplateImageOption, TemplateVariable } from '../../types/template';
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

const createVariableDraft = (variable?: TemplateVariable): VariableDraft => ({
  name: variable?.name ?? '',
  description: variable?.description ?? '',
  defaultValue: variable?.default ?? '',
  required: Boolean(variable?.required),
  input: variable?.input ?? 'text',
  rules: variable?.rules?.join('; ') ?? '',
});

function TemplateEditModal({ template }: { template: Template }) {
  const [open, setOpen] = useState(false);
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description ?? '');
  const [author, setAuthor] = useState(template.author);
  const [version, setVersion] = useState(template.version);
  const [image, setImage] = useState(template.image);
  const [installImage, setInstallImage] = useState(template.installImage ?? '');
  const [imageOptions, setImageOptions] = useState<TemplateImageOption[]>(
    template.images ?? [],
  );
  const [defaultImage, setDefaultImage] = useState(template.defaultImage ?? '');
  const [startup, setStartup] = useState(template.startup);
  const [stopCommand, setStopCommand] = useState(template.stopCommand);
  const [sendSignalTo, setSendSignalTo] = useState<'SIGTERM' | 'SIGINT' | 'SIGKILL'>(
    template.sendSignalTo === 'SIGKILL' ? 'SIGKILL' : template.sendSignalTo === 'SIGINT' ? 'SIGINT' : 'SIGTERM',
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
  const [fileEditorEnabled, setFileEditorEnabled] = useState(template.features?.fileEditor?.enabled ?? true);
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

  const resetFromTemplate = () => {
    setImportError('');
    setName(template.name);
    setDescription(template.description ?? '');
    setAuthor(template.author);
    setVersion(template.version);
    setImage(template.image);
    setInstallImage(template.installImage ?? '');
    setImageOptions(template.images ?? []);
    setDefaultImage(template.defaultImage ?? '');
    setStartup(template.startup);
    setStopCommand(template.stopCommand);
    setSendSignalTo(template.sendSignalTo === 'SIGKILL' ? 'SIGKILL' : template.sendSignalTo === 'SIGINT' ? 'SIGINT' : 'SIGTERM');
    setInstallScript(template.installScript ?? '');
    setConfigFile(template.features?.configFile ?? '');
    setConfigFiles(template.features?.configFiles ?? (template.features?.configFile ? [template.features.configFile] : []));
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
    setVariables(
      template.variables?.length
        ? template.variables.map((variable) => createVariableDraft(variable))
        : [createVariableDraft()],
    );
  };

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
    setSendSignalTo(payload.sendSignalTo === 'SIGKILL' ? 'SIGKILL' : payload.sendSignalTo === 'SIGINT' ? 'SIGINT' : 'SIGTERM');
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
        images: imageOptions.filter((option) => option.name && option.image),
        defaultImage: defaultImage || undefined,
        installImage: installImage || undefined,
        startup,
        stopCommand,
        sendSignalTo,
        variables: buildVariables(),
        installScript: installScript || undefined,
        features: {
          ...templateFeatures,
          iconUrl: iconUrl || undefined,
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
      queryClient.invalidateQueries({ queryKey: ['template', template.id] });
      notifySuccess('Template updated');
      setOpen(false);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to update template';
      notifyError(message);
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
      <button
        className="rounded-md border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500/30"
        onClick={() => {
          resetFromTemplate();
          setOpen(true);
        }}
      >
        Edit
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-10 backdrop-blur-sm">
          <div className="flex w-full max-w-4xl max-h-[90vh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl transition-all duration-300 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-5 dark:border-slate-800">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Edit template</h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Update images, resources, and startup configuration.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                  onClick={() => importFileRef.current?.click()}
                >
                  Import
                </button>
                <button
                  className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-500 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                  onClick={() => setOpen(false)}
                >
                  Close
                </button>
                <input
                  ref={importFileRef}
                  type="file"
                  accept="application/json,.json,application/x-yaml,.yaml,.yml"
                  onChange={handleImportFile}
                  className="hidden"
                />
              </div>
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
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-500 dark:text-slate-400">Author</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                    value={author}
                    onChange={(event) => setAuthor(event.target.value)}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-500 dark:text-slate-400">Version</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                    value={version}
                    onChange={(event) => setVersion(event.target.value)}
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
              </div>
              <label className="block space-y-1">
                <span className="text-slate-500 dark:text-slate-400">Description</span>
                <textarea
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                  rows={2}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
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
                    />
                  </label>
                  <label className="block space-y-1 md:col-span-2">
                    <span className="text-slate-500 dark:text-slate-400">Install image (optional)</span>
                    <input
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                      value={installImage}
                      onChange={(event) => setInstallImage(event.target.value)}
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
                  />
                </label>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <label className="block space-y-1 md:col-span-2">
                    <span className="text-slate-500 dark:text-slate-400">Stop command</span>
                    <input
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                      value={stopCommand}
                      onChange={(event) => setStopCommand(event.target.value)}
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
                    Changes apply immediately after save.
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  className="rounded-full border border-slate-200 px-4 py-2 font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </button>
                <button
                  className="rounded-full bg-primary-600 px-4 py-2 font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
                  onClick={() => mutation.mutate()}
                  disabled={disableSubmit}
                >
                  {mutation.isPending ? 'Saving...' : 'Save changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default TemplateEditModal;
