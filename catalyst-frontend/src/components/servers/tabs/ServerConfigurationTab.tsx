import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { filesApi } from '../../../services/api/files';
import {
  detectConfigFormat,
  parseConfig,
  serializeConfig,
  type ConfigMap,
  type ConfigNode,
} from '../../../utils/configFormats';
import { getErrorMessage } from '../../../utils/errors';
import { notifyError, notifySuccess } from '../../../utils/notify';
import { reportSystemError } from '../../../services/api/systemErrors';
import SectionDivider from './SectionDivider';
import StatGrid from './StatGrid';
import ServerStartupVariablesSection from './ServerStartupVariablesSection';

type ConfigEntry = {
  key: string;
  value: string;
  type: 'string' | 'number' | 'boolean' | 'null' | 'object';
  children?: ConfigEntry[];
};
type ConfigSection = {
  title: string;
  entries: ConfigEntry[];
  collapsed?: boolean;
};
type ConfigFileState = {
  path: string;
  sections: ConfigSection[];
  format: ReturnType<typeof detectConfigFormat>;
  error: string | null;
  loaded: boolean;
  viewMode: 'form' | 'raw';
  rawContent: string;
};

interface Props {
  serverId: string | undefined;
  isSuspended: boolean;
  isAdmin: boolean;
  server: {
    name?: string;
    template?: {
      name?: string;
      startup?: string;
      defaultImage?: string;
      image?: string;
      features?: {
        configFile?: string;
        configFiles?: string[];
      };
    };
    templateId?: string;
    environment?: Record<string, any>;
    allocatedMemoryMb: number;
    allocatedCpuCores: number;
    primaryPort?: number | string;
    networkMode?: string;
    startupCommand?: string;
  };
  startupCommand: string;
  onStartupCommandChange: (cmd: string) => void;
  startupCommandPending: boolean;
  onSaveStartupCommand: () => void;
  onResetStartupCommand: () => void;
}

export default function ServerConfigurationTab({
  serverId,
  isSuspended,
  isAdmin,
  server,
  startupCommand,
  onStartupCommandChange,
  startupCommandPending,
  onSaveStartupCommand,
  onResetStartupCommand,
}: Props) {
  // ── Config file state ──
  const [configFiles, setConfigFiles] = useState<ConfigFileState[]>([]);
  const [openConfigIndex, setOpenConfigIndex] = useState(-1);
  const queryClient = useQueryClient();
  const [configSearch, setConfigSearch] = useState('');

  const configTemplatePath = server.template?.features?.configFile;
  const configTemplatePaths = server.template?.features?.configFiles ?? [];
  const combinedConfigPaths = [
    ...(configTemplatePath ? [configTemplatePath] : []),
    ...configTemplatePaths,
  ];

  // ── Config helpers ──
  const isConfigMap = (value: ConfigNode): value is ConfigMap =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);

  const normalizeEntry = (key: string, value: ConfigNode): ConfigEntry => {
    if (isConfigMap(value)) {
      const children = Object.entries(value).map(([childKey, childValue]) =>
        normalizeEntry(childKey, childValue),
      );
      return { key, value: '', type: 'object', children };
    }
    if (value === null) return { key, value: '', type: 'null' };
    if (typeof value === 'boolean')
      return { key, value: value ? 'true' : 'false', type: 'boolean' };
    if (typeof value === 'number')
      return { key, value: String(value), type: 'number' };
    return { key, value: String(value), type: 'string' };
  };

  const toSections = (record: ConfigMap): ConfigSection[] => {
    const rootEntries: ConfigEntry[] = [];
    const sections: ConfigSection[] = [];
    Object.entries(record).forEach(([key, value]) => {
      if (isConfigMap(value)) {
        const nestedEntries = Object.entries(value).map(([childKey, childValue]) =>
          normalizeEntry(childKey, childValue),
        );
        sections.push({ title: key, entries: nestedEntries, collapsed: true });
      } else {
        rootEntries.push(normalizeEntry(key, value));
      }
    });
    if (rootEntries.length || sections.length === 0) {
      sections.unshift({
        title: 'General',
        entries: rootEntries,
        collapsed: false,
      });
    }
    return sections;
  };

  const buildConfigRecord = (sections: ConfigSection[]): ConfigMap => {
    const record: ConfigMap = {};
    const inferType = (raw: string): ConfigEntry['type'] => {
      const trimmed = raw.trim();
      if (trimmed === '') return 'string';
      if (trimmed === 'true' || trimmed === 'false') return 'boolean';
      if (trimmed === 'null') return 'null';
      if (!Number.isNaN(Number(trimmed))) return 'number';
      return 'string';
    };
    const normalizeValue = (entry: ConfigEntry): ConfigNode => {
      const resolvedType =
        entry.type === 'string' ? inferType(entry.value) : entry.type;
      switch (resolvedType) {
        case 'number':
          return entry.value === '' ? 0 : Number(entry.value);
        case 'boolean':
          return entry.value === 'true';
        case 'null':
          return null;
        case 'object': {
          const output: ConfigMap = {};
          (entry.children ?? []).forEach((child) => {
            if (!child.key.trim()) return;
            output[child.key] = normalizeValue(child);
          });
          return output;
        }
        default:
          return entry.value;
      }
    };

    sections.forEach((section) => {
      const target =
        section.title === 'General'
          ? record
          : ((record[section.title] ||= {}) as ConfigMap);
      section.entries.forEach((entry) => {
        if (!entry.key.trim()) return;
        target[entry.key] = normalizeValue(entry);
      });
    });
    return record;
  };

  const loadConfigFile = useCallback(
    async (pathValue: string): Promise<ConfigFileState> => {
      const format = detectConfigFormat(pathValue);
      if (!format) {
        return {
          path: pathValue,
          sections: [],
          format: null,
          error: 'Unsupported config format.',
          loaded: true,
          viewMode: 'form',
          rawContent: '',
        } as ConfigFileState;
      }
      try {
        const content = await filesApi.readText(serverId ?? '', pathValue);
        const parsed = parseConfig(format, content);
        const sections = toSections(parsed);
        return {
          path: pathValue,
          sections,
          format,
          error: null,
          loaded: true,
          viewMode: 'form',
          rawContent: content,
        };
      } catch (error: unknown) {
        reportSystemError({
          level: 'error',
          component: 'ServerConfigurationTab',
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          metadata: { context: 'load config file' },
        });
        return {
          path: pathValue,
          sections: [],
          format,
          error: getErrorMessage(error, 'Failed to load config file'),
          loaded: true,
          viewMode: 'form',
          rawContent: '',
        };
      }
    },
    [serverId],
  );

  // Load config files on mount
  useEffect(() => {
    if (!serverId || !server?.template) {
      setConfigFiles([]);
      return;
    }
    if (combinedConfigPaths.length === 0) {
      setConfigFiles([]);
      return;
    }
    const uniquePaths = Array.from(new Set(combinedConfigPaths));
    setConfigFiles(
      uniquePaths.map((path) => ({
        path,
        sections: [],
        format: null,
        error: null,
        loaded: false,
        viewMode: 'form' as const,
        rawContent: '',
      })),
    );
    setOpenConfigIndex(-1);
    Promise.all(uniquePaths.map((path) => loadConfigFile(path))).then(
      (results) => {
        setConfigFiles(results);
      },
    );
  }, [
    serverId,
    server?.template?.features?.configFile,
    server?.template?.features?.configFiles?.join('|'),
    loadConfigFile,
  ]);

  const configMutation = useMutation({
    mutationFn: async (index: number) => {
      if (!serverId) {
        reportSystemError({ level: 'error', component: 'ServerConfigurationTab', message: 'Missing server id', metadata: { context: 'config mutation' } });
        throw new Error('Missing server id');
      }
      const target = configFiles[index];
      if (!target || !target.format) {
        reportSystemError({ level: 'error', component: 'ServerConfigurationTab', message: 'Missing config file path', metadata: { context: 'config mutation' } });
        throw new Error('Missing config file path');
      }
      if (target.viewMode === 'raw') {
        await filesApi.write(serverId, target.path, target.rawContent);
        return;
      }
      const record = buildConfigRecord(target.sections);
      const content = serializeConfig(target.format, record);
      await filesApi.write(serverId, target.path, content);
    },
    onSuccess: () => {
      notifySuccess('Configuration saved');
      if (serverId) {
        queryClient.invalidateQueries({ queryKey: ['files', serverId] });
      }
    },
    onError: (error: any) => {
      const message =
        error?.message ||
        'Failed to save config';
      notifyError(message);
    },
  });

  // ── Config search/filter ──
  const filteredConfigFiles = useMemo(() => {
    const query = configSearch.trim().toLowerCase();
    if (!query) return configFiles;
    const matchesEntry = (entry: ConfigEntry) => {
      if (entry.key.toLowerCase().includes(query)) return true;
      if (entry.value.toLowerCase().includes(query)) return true;
      return (entry.children ?? []).some(matchesEntry);
    };
    return configFiles
      .map((file) => {
        if (file.viewMode === 'raw') {
          return file.rawContent.toLowerCase().includes(query) ? file : null;
        }
        const sections = file.sections
          .map((section) => {
            const entries = section.entries.filter(matchesEntry);
            if (!entries.length) return null;
            return { ...section, entries, collapsed: false };
          })
          .filter(Boolean) as ConfigSection[];
        return sections.length ? { ...file, sections } : null;
      })
      .filter(Boolean) as ConfigFileState[];
  }, [configFiles, configSearch]);

  const fileIndexByPath = useMemo(() => {
    const mapping = new Map<string, number>();
    configFiles.forEach((file, index) => {
      mapping.set(file.path, index);
    });
    return mapping;
  }, [configFiles]);

  // ── Config entry operations ──
  const updateConfigEntry = useCallback(
    (
      fileIndex: number,
      sectionIndex: number,
      entryIndex: number,
      patch: Partial<ConfigEntry>,
      childIndex?: number,
    ) => {
      setConfigFiles((current) =>
        current.map((file, idx) => {
          if (idx !== fileIndex) return file;
          return {
            ...file,
            sections: file.sections.map((section, secIdx) => {
              if (secIdx !== sectionIndex) return section;
              return {
                ...section,
                entries: section.entries.map((entry, entryIdx) => {
                  if (entryIdx !== entryIndex) return entry;
                  if (typeof childIndex === 'number' && entry.children) {
                    return {
                      ...entry,
                      children: entry.children.map((child, childIdx) =>
                        childIdx === childIndex
                          ? { ...child, ...patch }
                          : child,
                      ),
                    };
                  }
                  return { ...entry, ...patch };
                }),
              };
            }),
          };
        }),
      );
    },
    [],
  );

  const addConfigEntry = useCallback(
    (fileIndex: number, sectionIndex: number, parentIndex?: number) => {
      setConfigFiles((current) =>
        current.map((file, idx) =>
          idx === fileIndex
            ? {
                ...file,
                sections: file.sections.map((section, secIdx) => {
                  if (secIdx !== sectionIndex) return section;
                  if (typeof parentIndex === 'number') {
                    return {
                      ...section,
                      entries: section.entries.map((entry, entryIdx) =>
                        entryIdx === parentIndex
                          ? {
                              ...entry,
                              children: [
                                ...(entry.children ?? []),
                                { key: '', value: '', type: 'string' },
                              ],
                            }
                          : entry,
                      ),
                    };
                  }
                  return {
                    ...section,
                    entries: [
                      ...section.entries,
                      { key: '', value: '', type: 'string' },
                    ],
                  };
                }),
              }
            : file,
        ),
      );
    },
    [],
  );

  const removeConfigEntry = useCallback(
    (
      fileIndex: number,
      sectionIndex: number,
      entryIndex: number,
      childIndex?: number,
    ) => {
      setConfigFiles((current) =>
        current.map((file, idx) =>
          idx === fileIndex
            ? {
                ...file,
                sections: file.sections.map((section, secIdx) => {
                  if (secIdx !== sectionIndex) return section;
                  if (typeof childIndex === 'number') {
                    return {
                      ...section,
                      entries: section.entries.map((entry, entryIdx) =>
                        entryIdx === entryIndex
                          ? {
                              ...entry,
                              children: (entry.children ?? []).filter(
                                (_, childIdx) => childIdx !== childIndex,
                              ),
                            }
                          : entry,
                      ),
                    };
                  }
                  return {
                    ...section,
                    entries: section.entries.filter(
                      (_, entryIdx) => entryIdx !== entryIndex,
                    ),
                  };
                }),
              }
            : file,
        ),
      );
    },
    [],
  );

  // ── Render helpers ──
  const renderValueInput = (
    entry: ConfigEntry,
    onValueChange: (value: string) => void,
    className = 'w-full',
  ) => {
    if (entry.type === 'boolean') {
      const checked = entry.value === 'true';
      return (
        <label className="relative inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={checked}
            onChange={(event) =>
              onValueChange(event.target.checked ? 'true' : 'false')
            }
          />
          <div className="h-5 w-10 rounded-full bg-surface-3 transition peer-checked:bg-primary dark:bg-surface-2" />
          <div className="pointer-events-none absolute left-0.5 h-4 w-4 rounded-full bg-card shadow transition peer-checked:translate-x-5" />
        </label>
      );
    }

    return (
      <input
        type={entry.type === 'number' ? 'number' : 'text'}
        className={`${className} rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground transition-all duration-300 focus:border-primary focus:outline-none`}
        value={entry.value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder="Value"
      />
    );
  };

  // ── JSX ──
  return (
    <div className="space-y-6">
      {/* ── Startup & Environment ── */}
      {isAdmin && (
        <section>
          <SectionDivider title="Startup" />
          <div className="rounded-xl border border-border/50 bg-card/80 p-5 shadow-sm backdrop-blur-sm hover:shadow-md">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-foreground">
                  Startup command
                </div>
                <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
                  Executed when the server starts.{' '}
                  <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[10px] dark:bg-surface-2">
                    {'{{MEMORY}}'}
                  </code>
                  ,{' '}
                  <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[10px] dark:bg-surface-2">
                    {'{{PORT}}'}
                  </code>{' '}
                  and other variables are substituted from the environment below.
                </p>
              </div>
              {server.startupCommand && (
                <button
                  type="button"
                  className="shrink-0 rounded-md border border-border px-2.5 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:text-primary"
                  onClick={onResetStartupCommand}
                  disabled={isSuspended}
                >
                  Reset to default
                </button>
              )}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <input
                className="min-w-0 flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-xs text-foreground transition-colors focus:border-primary focus:bg-card focus:outline-none"
                value={startupCommand}
                onChange={(event) =>
                  onStartupCommandChange(event.target.value)
                }
                placeholder="e.g. java -Xms128M -Xmx{{MEMORY}}M -jar server.jar --port {{PORT}}"
                disabled={isSuspended}
              />
              <button
                type="button"
                className="shrink-0 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50"
                onClick={onSaveStartupCommand}
                disabled={
                  isSuspended ||
                  startupCommandPending ||
                  !startupCommand.trim() ||
                  startupCommand.trim() ===
                    (server.startupCommand ?? server.template?.startup ?? '')
                }
              >
                Save
              </button>
            </div>
            {server.template?.startup &&
              startupCommand.trim() !== server.template.startup && (
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  Template default:{' '}
                  <button
                    type="button"
                    className="font-mono underline decoration-dotted hover:text-primary"
                    onClick={() =>
                      onStartupCommandChange(server.template?.startup ?? '')
                    }
                  >
                    {server.template.startup}
                  </button>
                </p>
              )}
          </div>
        </section>
      )}

      {/* ── Startup Variables ── */}
      {serverId && (
        <section>
          <SectionDivider title="Startup Variables" />
          <ServerStartupVariablesSection
            serverId={serverId}
            isSuspended={isSuspended}
            canEdit={isAdmin}
          />
        </section>
      )}

      {/* ── Config Files ── */}
      <section>
        <SectionDivider title="Config files" />
        <div className="rounded-xl border border-border/50 bg-card/80 p-5 shadow-sm backdrop-blur-sm hover:shadow-md">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {combinedConfigPaths.length
                ? combinedConfigPaths.join(', ')
                : 'No config files defined in template.'}
            </p>
          </div>
          <div className="mt-3">
            <input
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-foreground transition-colors focus:border-primary focus:bg-card focus:outline-none"
              placeholder="Search config keys or values…"
              value={configSearch}
              onChange={(event) => setConfigSearch(event.target.value)}
            />
          </div>
          <div className="mt-4 space-y-3">
            {!combinedConfigPaths.length ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                Add{' '}
                <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[10px] dark:bg-surface-2">
                  features.configFiles
                </code>{' '}
                to the template to enable dynamic settings.
              </p>
            ) : (
              <div className="space-y-2">
                {filteredConfigFiles.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border py-4 text-center text-xs text-muted-foreground">
                    No matches found.
                  </p>
                ) : (
                  filteredConfigFiles.map((configFile) => (
                    <div
                      className="overflow-hidden rounded-lg border border-border bg-surface-2/50 transition-colors dark:bg-surface-2/40"
                      key={configFile.path}
                    >
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-xs transition-colors hover:bg-surface-2/80 dark:hover:bg-surface-2/80"
                        onClick={() => {
                          if (configSearch) return;
                          const fileIndex =
                            fileIndexByPath.get(configFile.path) ?? -1;
                          setOpenConfigIndex((current) =>
                            current === fileIndex ? -1 : fileIndex,
                          );
                        }}
                      >
                        <span className="font-semibold text-foreground">
                          {configFile.path}
                        </span>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold tracking-wide transition-colors ${
                            configSearch ||
                            openConfigIndex ===
                              (fileIndexByPath.get(configFile.path) ?? -1)
                              ? 'bg-primary-muted text-primary'
                              : 'bg-surface-2 text-muted-foreground dark:bg-surface-2'
                          }`}
                        >
                          {configSearch
                            ? 'Filtered'
                            : openConfigIndex ===
                                (fileIndexByPath.get(configFile.path) ?? -1)
                              ? 'Collapse'
                              : 'Expand'}
                        </span>
                      </button>
                      {configSearch ||
                      openConfigIndex ===
                        (fileIndexByPath.get(configFile.path) ?? -1) ? (
                        <div className="border-t border-border px-4 py-4">
                          {!configFile.loaded ? (
                            <p className="text-xs text-muted-foreground">
                              Loading config values…
                            </p>
                          ) : configFile.error ? (
                            <div className="rounded-lg border border-danger/30 bg-danger-muted px-3 py-2 text-xs text-danger">
                              {configFile.error}
                            </div>
                          ) : (
                            <div className="space-y-3 text-xs text-muted-foreground">
                              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground dark:bg-surface-2">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold">View</span>
                                  {configSearch ? (
                                    <span className="rounded-full bg-primary-muted px-2 py-0.5 text-[10px] font-semibold text-primary">
                                      Filtered
                                    </span>
                                  ) : null}
                                </div>
                                <div className="flex items-center overflow-hidden rounded-full border border-border">
                                  <button
                                    type="button"
                                    className={`px-3 py-1 text-[10px] font-semibold tracking-wide transition-colors ${
                                      configFile.viewMode === 'form'
                                        ? 'bg-primary text-primary-foreground'
                                        : 'bg-card text-muted-foreground hover:text-foreground'
                                    }`}
                                    onClick={() =>
                                      setConfigFiles((current) =>
                                        current.map((file) =>
                                          file.path === configFile.path
                                            ? { ...file, viewMode: 'form' }
                                            : file,
                                        ),
                                      )
                                    }
                                  >
                                    Form
                                  </button>
                                  <button
                                    type="button"
                                    className={`px-3 py-1 text-[10px] font-semibold tracking-wide transition-colors ${
                                      configFile.viewMode === 'raw'
                                        ? 'bg-primary text-primary-foreground'
                                        : 'bg-card text-muted-foreground hover:text-foreground'
                                    }`}
                                    onClick={() =>
                                      setConfigFiles((current) =>
                                        current.map((file) =>
                                          file.path === configFile.path
                                            ? { ...file, viewMode: 'raw' }
                                            : file,
                                        ),
                                      )
                                    }
                                  >
                                    Raw
                                  </button>
                                </div>
                              </div>
                              {configFile.viewMode === 'raw' ? (
                                <textarea
                                  className="min-h-[240px] w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-xs text-foreground transition-colors focus:border-primary focus:bg-card focus:outline-none"
                                  value={configFile.rawContent}
                                  onChange={(event) =>
                                    setConfigFiles((current) =>
                                      current.map((file) =>
                                        file.path === configFile.path
                                          ? {
                                              ...file,
                                              rawContent: event.target.value,
                                            }
                                          : file,
                                      ),
                                    )
                                  }
                                />
                              ) : (
                                <div className="space-y-4">
                                  {configFile.sections.map(
                                    (section, sectionIndex) => (
                                      <div
                                        key={`${configFile.path}-${section.title}`}
                                        className="rounded-xl border border-border bg-card p-4 dark:bg-surface-2/60"
                                      >
                                        <button
                                          type="button"
                                          className="flex w-full items-center justify-between text-left"
                                          onClick={() =>
                                            setConfigFiles((current) =>
                                              current.map((file) => {
                                                if (
                                                  file.path !== configFile.path
                                                )
                                                  return file;
                                                return {
                                                  ...file,
                                                  sections: file.sections.map(
                                                    (sectionItem, secIdx) =>
                                                      secIdx === sectionIndex
                                                        ? {
                                                            ...sectionItem,
                                                            collapsed:
                                                              !sectionItem.collapsed,
                                                          }
                                                        : sectionItem,
                                                  ),
                                                };
                                              }),
                                            )
                                          }
                                        >
                                          <div className="flex items-center gap-3 text-sm font-semibold text-foreground">
                                            <span className="h-2 w-2 rounded-full bg-primary" />
                                            <span className="uppercase tracking-wide">
                                              {section.title}
                                            </span>
                                          </div>
                                          <span
                                            className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold tracking-wide ${
                                              section.collapsed
                                                ? 'bg-surface-2 text-muted-foreground dark:bg-surface-2'
                                                : 'bg-primary-muted text-primary'
                                            }`}
                                          >
                                            {section.collapsed
                                              ? 'Expand'
                                              : 'Collapse'}
                                          </span>
                                        </button>
                                        {section.collapsed ? null : (
                                          <div className="mt-4 space-y-4">
                                            <div className="space-y-3">
                                              {section.entries.map(
                                                (entry, entryIndex) =>
                                                  entry.type === 'object' ? (
                                                    <div
                                                      key={`${entry.key}-${entryIndex}`}
                                                      className="p-3"
                                                    >
                                                      <div className="flex items-center justify-between">
                                                        <h4 className="text-sm font-semibold text-foreground">
                                                          {entry.key || 'Object'}
                                                        </h4>
                                                        <button
                                                          type="button"
                                                          className="text-[10px] font-semibold uppercase tracking-wide text-primary transition-all duration-300 hover:text-primary"
                                                          onClick={() =>
                                                            addConfigEntry(
                                                              fileIndexByPath.get(
                                                                configFile.path,
                                                              ) ?? 0,
                                                              sectionIndex,
                                                              entryIndex,
                                                            )
                                                          }
                                                        >
                                                          Add entry
                                                        </button>
                                                      </div>
                                                      <div className="mt-3">
                                                        {(
                                                          entry.children ?? []
                                                        ).map(
                                                          (
                                                            child,
                                                            childIndex,
                                                          ) => (
                                                            <div
                                                              key={`${entry.key}-${child.key}-${childIndex}`}
                                                              className="space-y-3 border-b border-border/60 px-3 py-3 last:border-b-0"
                                                            >
                                                              <div className="flex items-start justify-between gap-3">
                                                                <div className="text-base font-semibold text-foreground">
                                                                  {child.key ||
                                                                    'Key'}
                                                                </div>
                                                                <button
                                                                  type="button"
                                                                  className="flex h-6 w-6 items-center justify-center rounded-md border border-danger/30 bg-danger-muted text-[11px] font-semibold text-danger transition-all duration-300 hover:border-danger/50"
                                                                  onClick={() =>
                                                                    removeConfigEntry(
                                                                      fileIndexByPath.get(
                                                                        configFile.path,
                                                                      ) ?? 0,
                                                                      sectionIndex,
                                                                      entryIndex,
                                                                      childIndex,
                                                                    )
                                                                  }
                                                                >
                                                                  ✕
                                                                </button>
                                                              </div>
                                                              {renderValueInput(
                                                                child,
                                                                (value) =>
                                                                  updateConfigEntry(
                                                                    fileIndexByPath.get(
                                                                      configFile.path,
                                                                    ) ?? 0,
                                                                    sectionIndex,
                                                                    entryIndex,
                                                                    { value },
                                                                    childIndex,
                                                                  ),
                                                              )}
                                                            </div>
                                                          ),
                                                        )}
                                                      </div>
                                                    </div>
                                                  ) : (
                                                    <div
                                                      key={`${entry.key}-${entryIndex}`}
                                                      className="space-y-3 border-b border-border px-3 py-3 last:border-b-0/60"
                                                    >
                                                      <div className="flex items-start justify-between gap-3">
                                                        <div className="text-base font-semibold text-foreground">
                                                          {entry.key || 'Key'}
                                                        </div>
                                                        <button
                                                          type="button"
                                                          className="flex h-6 w-6 items-center justify-center rounded-md border border-danger/30 bg-danger-muted text-[11px] font-semibold text-danger transition-all duration-300 hover:border-danger/50"
                                                          onClick={() =>
                                                            removeConfigEntry(
                                                              fileIndexByPath.get(
                                                                configFile.path,
                                                              ) ?? 0,
                                                              sectionIndex,
                                                              entryIndex,
                                                            )
                                                          }
                                                        >
                                                          ✕
                                                        </button>
                                                      </div>
                                                      {renderValueInput(
                                                        entry,
                                                        (value) =>
                                                          updateConfigEntry(
                                                            fileIndexByPath.get(
                                                              configFile.path,
                                                            ) ?? 0,
                                                            sectionIndex,
                                                            entryIndex,
                                                            { value },
                                                          ),
                                                      )}
                                                    </div>
                                                  ),
                                              )}
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2">
                                              <button
                                                type="button"
                                                className="rounded-md border border-border px-3 py-1 text-xs text-muted-foreground transition-all duration-300 hover:border-primary/30 hover:text-foreground"
                                                onClick={() =>
                                                  addConfigEntry(
                                                    fileIndexByPath.get(
                                                      configFile.path,
                                                    ) ?? 0,
                                                    sectionIndex,
                                                  )
                                                }
                                              >
                                                Add entry
                                              </button>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    ),
                                  )}
                                </div>
                              )}
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary/90 disabled:opacity-60"
                                  onClick={() =>
                                    configMutation.mutate(
                                      fileIndexByPath.get(configFile.path) ??
                                        0,
                                    )
                                  }
                                  disabled={configMutation.isPending}
                                >
                                  Save config
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
