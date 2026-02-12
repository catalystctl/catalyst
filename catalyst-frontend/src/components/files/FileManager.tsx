import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUp,
  ChevronRight,
  FilePlus,
  FolderPlus,
  RefreshCw,
  Upload,
  Archive,
  ArchiveRestore,
  Trash2,
  XCircle,
  Home,
  File,
  Folder,
  X,
  Loader2,
  AlertTriangle,
  Menu,
} from 'lucide-react';
import FileEditor from './FileEditor';
import FileList from './FileList';
import FileTree from './FileTree';
import FileUploader from './FileUploader';
import { useFileManager } from '../../hooks/useFileManager';
import { filesApi } from '../../services/api/files';
import type { FileEntry } from '../../types/file';
import { formatFileMode } from '../../utils/formatters';
import { notifyError, notifyInfo, notifySuccess } from '../../utils/notify';
import { buildBreadcrumbs, getParentPath, joinPath, normalizePath } from '../../utils/filePaths';

type CreatePayload = {
  name: string;
  isDirectory: boolean;
  content?: string;
};

type SortField = 'name' | 'size' | 'modified' | 'mode';
type SortDirection = 'asc' | 'desc';

const isArchive = (name: string) =>
  name.endsWith('.tar.gz') || name.endsWith('.tgz') || name.endsWith('.zip');

const isBufferError = (error: any): { currentMaxBufferMb: number; recommendedMaxBufferMb: number } | null => {
  const data = error?.response?.data;
  if (data?.code === 'MAX_BUFFER_EXCEEDED') {
    return {
      currentMaxBufferMb: data.currentMaxBufferMb ?? 50,
      recommendedMaxBufferMb: data.recommendedMaxBufferMb ?? 100,
    };
  }
  return null;
};

function FileManager({ serverId, isSuspended = false }: { serverId: string; isSuspended?: boolean }) {
  const {
    path,
    setPath,
    files,
    message,
    isLoading,
    isError,
    refetch,
    activeFile,
    isFileLoading,
    isDirty,
    openFile,
    updateActiveContent,
    markActiveSaved,
    closeActiveFile,
  } = useFileManager(serverId);
  const queryClient = useQueryClient();

  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [showUpload, setShowUpload] = useState(false);
  const [createMode, setCreateMode] = useState<'file' | 'directory' | null>(null);
  const [createName, setCreateName] = useState('');
  const [createContent, setCreateContent] = useState('');
  const [showCompress, setShowCompress] = useState(false);
  const [showDecompress, setShowDecompress] = useState(false);
  const [archiveName, setArchiveName] = useState('archive.tar.gz');
  const [decompressTarget, setDecompressTarget] = useState(path);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [permissionsEntry, setPermissionsEntry] = useState<FileEntry | null>(null);
  const [permissionsValue, setPermissionsValue] = useState('');
  const [permissionsError, setPermissionsError] = useState<string | null>(null);
  const [renamingEntry, setRenamingEntry] = useState<FileEntry | null>(null);
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [archiveBrowsePath, setArchiveBrowsePath] = useState<string | null>(null);
  const [archiveBrowseDir, setArchiveBrowseDir] = useState('/');
  const [archiveEntries, setArchiveEntries] = useState<
    Array<{ name: string; size: number; isDirectory: boolean; modified?: string }>
  >([]);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [bufferError, setBufferError] = useState<{
    currentMaxBufferMb: number;
    recommendedMaxBufferMb: number;
  } | null>(null);
  const [showSidebar, setShowSidebar] = useState(false);

  useEffect(() => {
    setSelectedPaths(new Set());
    setConfirmDelete(false);
    setShowCompress(false);
    setShowDecompress(false);
    setPermissionsEntry(null);
    setPermissionsError(null);
    setRenamingEntry(null);
  }, [path]);

  useEffect(() => {
    setDecompressTarget(path);
  }, [path]);

  useEffect(() => {
    if (!selectedPaths.size) {
      setConfirmDelete(false);
      setShowCompress(false);
      setShowDecompress(false);
    }
  }, [selectedPaths]);

  const sortedFiles = useMemo(() => {
    const next = [...files];
    next.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'size':
          cmp = a.size - b.size;
          break;
        case 'modified': {
          const am = a.modified ? new Date(a.modified).getTime() : 0;
          const bm = b.modified ? new Date(b.modified).getTime() : 0;
          cmp = am - bm;
          break;
        }
        case 'mode':
          cmp = (a.mode ?? 0) - (b.mode ?? 0);
          break;
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return next;
  }, [files, sortField, sortDirection]);

  const handleSort = useCallback((field: SortField) => {
    setSortField((prev) => {
      if (prev === field) {
        setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDirection('asc');
      return field;
    });
  }, []);

  const breadcrumbs = useMemo(() => buildBreadcrumbs(path), [path]);
  const selectedEntries = useMemo(
    () => sortedFiles.filter((entry) => selectedPaths.has(entry.path)),
    [sortedFiles, selectedPaths],
  );
  const selectedArchive =
    selectedEntries.length === 1 &&
    !selectedEntries[0].isDirectory &&
    isArchive(selectedEntries[0].name)
      ? selectedEntries[0]
      : undefined;

  const allSelected = sortedFiles.length > 0 && selectedPaths.size === sortedFiles.length;

  const invalidateFiles = () => {
    queryClient.invalidateQueries({ queryKey: ['files', serverId] });
  };

  const createMutation = useMutation({
    mutationFn: async ({ name, isDirectory, content }: CreatePayload) => {
      const targetPath = joinPath(path, name);
      if (isDirectory) {
        await filesApi.create(serverId, { path: targetPath, isDirectory: true });
        return { name, path: targetPath, isDirectory: true, size: 0 } as FileEntry;
      }
      try {
        await filesApi.create(serverId, { path: targetPath, isDirectory: false, content });
      } catch {
        await filesApi.write(serverId, targetPath, content ?? '');
      }
      return { name, path: targetPath, isDirectory: false, size: 0 } as FileEntry;
    },
    onSuccess: (entry) => {
      invalidateFiles();
      setCreateName('');
      setCreateContent('');
      setCreateMode(null);
      notifySuccess(entry.isDirectory ? 'Folder created' : 'File created');
      if (!entry.isDirectory) {
        openFile(entry);
      }
    },
    onError: (error: any) => {
      const msg = error?.response?.data?.error || error?.message || 'Failed to create item';
      notifyError(msg);
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!activeFile) return;
      await filesApi.write(serverId, activeFile.path, activeFile.content);
    },
    onSuccess: () => {
      markActiveSaved();
      notifySuccess('File saved');
      invalidateFiles();
    },
    onError: (error: any) => {
      const msg = error?.response?.data?.error || error?.message || 'Failed to save file';
      notifyError(msg);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (paths: string[]) => {
      await Promise.all(paths.map((target) => filesApi.remove(serverId, target)));
    },
    onSuccess: (_, paths) => {
      invalidateFiles();
      setSelectedPaths(new Set());
      setConfirmDelete(false);
      if (activeFile && paths.includes(activeFile.path)) {
        closeActiveFile();
      }
      notifySuccess('Deleted selection');
    },
    onError: (error: any) => {
      const msg = error?.response?.data?.error || error?.message || 'Failed to delete selection';
      notifyError(msg);
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (uploadFiles: File[]) => {
      await filesApi.upload(serverId, path, uploadFiles);
    },
    onSuccess: () => {
      invalidateFiles();
      setShowUpload(false);
      notifySuccess('Upload complete');
    },
    onError: (error: any) => {
      const msg = error?.response?.data?.error || error?.message || 'Failed to upload files';
      notifyError(msg);
    },
  });

  const compressMutation = useMutation({
    mutationFn: async ({ paths, archive }: { paths: string[]; archive: string }) =>
      filesApi.compress(serverId, { paths, archiveName: archive }),
    onSuccess: (data) => {
      invalidateFiles();
      setShowCompress(false);
      notifySuccess(data?.archivePath ? `Archive created at ${data.archivePath}` : 'Archive created');
    },
    onError: (error: any) => {
      const bufErr = isBufferError(error);
      if (bufErr) return setBufferError(bufErr);
      const msg = error?.response?.data?.error || error?.message || 'Failed to compress files';
      notifyError(msg);
    },
  });

  const decompressMutation = useMutation({
    mutationFn: async ({ archivePath, targetPath }: { archivePath: string; targetPath: string }) =>
      filesApi.decompress(serverId, { archivePath, targetPath }),
    onSuccess: () => {
      invalidateFiles();
      setShowDecompress(false);
      notifySuccess('Archive extracted');
    },
    onError: (error: any) => {
      const bufErr = isBufferError(error);
      if (bufErr) return setBufferError(bufErr);
      const msg = error?.response?.data?.error || error?.message || 'Failed to extract archive';
      notifyError(msg);
    },
  });

  const permissionsMutation = useMutation({
    mutationFn: async ({ path: targetPath, mode }: { path: string; mode: number }) =>
      filesApi.updatePermissions(serverId, targetPath, mode),
    onSuccess: () => {
      invalidateFiles();
      setPermissionsEntry(null);
      notifySuccess('Permissions updated');
    },
    onError: (error: any) => {
      const msg = error?.response?.data?.error || error?.message || 'Failed to update permissions';
      notifyError(msg);
    },
  });

  const renameMutation = useMutation({
    mutationFn: async ({ from, to }: { from: string; to: string }) =>
      filesApi.rename(serverId, from, to),
    onSuccess: () => {
      invalidateFiles();
      setRenamingEntry(null);
      notifySuccess('Renamed');
    },
    onError: (error: any) => {
      const msg = error?.response?.data?.error || error?.message || 'Failed to rename';
      notifyError(msg);
    },
  });

  const handleOpen = (entry: FileEntry) => {
    if (entry.isDirectory) {
      setPath(entry.path);
      return;
    }
    if (isArchive(entry.name)) {
      openArchiveBrowser(entry.path);
      return;
    }
    openFile(entry);
  };

  const openArchiveBrowser = async (archivePath: string) => {
    setArchiveBrowsePath(archivePath);
    setArchiveBrowseDir('/');
    setArchiveLoading(true);
    try {
      const entries = await filesApi.listArchiveContents(serverId, archivePath);
      setArchiveEntries(entries);
    } catch (error: any) {
      const bufErr = isBufferError(error);
      if (bufErr) {
        setBufferError(bufErr);
        setArchiveBrowsePath(null);
      } else {
        notifyError('Failed to read archive');
        setArchiveBrowsePath(null);
      }
    } finally {
      setArchiveLoading(false);
    }
  };

  const handleSelect = (entry: FileEntry, selected: boolean) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (selected) next.add(entry.path);
      else next.delete(entry.path);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (allSelected) {
      setSelectedPaths(new Set());
    } else {
      setSelectedPaths(new Set(sortedFiles.map((f) => f.path)));
    }
  };

  const handleShiftSelect = (entry: FileEntry) => {
    const lastSelected = [...selectedPaths].pop();
    if (!lastSelected) {
      setSelectedPaths(new Set([entry.path]));
      return;
    }
    const paths = sortedFiles.map((f) => f.path);
    const startIdx = paths.indexOf(lastSelected);
    const endIdx = paths.indexOf(entry.path);
    if (startIdx === -1 || endIdx === -1) return;
    const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
    const range = paths.slice(from, to + 1);
    setSelectedPaths((prev) => new Set([...prev, ...range]));
  };

  const handleDownload = async (entry: FileEntry) => {
    try {
      const blob = await filesApi.download(serverId, entry.path);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = entry.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      notifyInfo('Download started');
    } catch {
      notifyError('Failed to download file');
    }
  };

  const handleCopyPath = (entry: FileEntry) => {
    navigator.clipboard.writeText(entry.path).then(
      () => notifyInfo('Path copied'),
      () => notifyError('Failed to copy path'),
    );
  };

  const handleRename = (entry: FileEntry, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === entry.name) {
      setRenamingEntry(null);
      return;
    }
    const parentDir = getParentPath(entry.path);
    const newPath = joinPath(parentDir, trimmed);
    renameMutation.mutate({ from: entry.path, to: newPath });
  };

  const handleCreateSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!createMode) return;
    const name = createName.trim();
    if (!name) return;
    createMutation.mutate({ name, isDirectory: createMode === 'directory', content: createContent });
  };

  const handleCompress = () => {
    const selected = Array.from(selectedPaths);
    const name = archiveName.trim();
    if (!selected.length || !name) {
      notifyError('Select files and provide an archive name');
      return;
    }
    const archivePath = name.startsWith('/') ? normalizePath(name) : joinPath(path, name);
    compressMutation.mutate({ paths: selected, archive: archivePath });
  };

  const handleDecompress = () => {
    if (!selectedArchive) return;
    const target = normalizePath(decompressTarget);
    decompressMutation.mutate({ archivePath: selectedArchive.path, targetPath: target });
  };

  const handleDeleteSelection = () => {
    const selected = Array.from(selectedPaths);
    if (!selected.length) return;
    deleteMutation.mutate(selected);
  };

  const parseModeInput = (value: string) => {
    const trimmed = value.trim();
    if (!/^[0-7]{3,4}$/.test(trimmed)) return null;
    const parsed = parseInt(trimmed, 8);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const handlePermissionsOpen = (entry: FileEntry) => {
    const fallback = entry.isDirectory ? 0o755 : 0o644;
    const formatted = formatFileMode(entry.mode ?? fallback);
    setPermissionsValue(formatted === '---' ? '644' : formatted);
    setPermissionsEntry(entry);
    setPermissionsError(null);
  };

  const handlePermissionsSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!permissionsEntry) return;
    const parsed = parseModeInput(permissionsValue);
    if (!parsed) {
      setPermissionsError('Enter a 3-4 digit octal mode, e.g. 644 or 0755.');
      return;
    }
    setPermissionsError(null);
    permissionsMutation.mutate({ path: permissionsEntry.path, mode: parsed });
  };

  const handleBulkCompressFromEntry = (entry: FileEntry) => {
    setSelectedPaths(new Set([entry.path]));
    setArchiveName(entry.name.endsWith('.tar.gz') ? entry.name : `${entry.name}.tar.gz`);
    setShowCompress(true);
  };

  const handleBulkDecompressFromEntry = (entry: FileEntry) => {
    if (!isArchive(entry.name)) return;
    setSelectedPaths(new Set([entry.path]));
    setShowDecompress(true);
  };

  const guardSuspended = (fn: () => void) => () => {
    if (isSuspended) {
      notifyError('Server is suspended');
      return;
    }
    fn();
  };

  // Toolbar button style
  const tbtn =
    'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white';
  const tbtnDanger =
    'inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-400 dark:hover:bg-rose-500/10';
  const tbtnPrimary =
    'inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary-500 disabled:opacity-50';

  return (
    <div className="flex flex-col lg:grid lg:grid-cols-[220px_1fr] gap-4">
      {/* Mobile sidebar toggle */}
      <button
        type="button"
        className="lg:hidden flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
        onClick={() => setShowSidebar(!showSidebar)}
      >
        <Menu className="h-4 w-4" />
        Folders
      </button>

      {/* Sidebar - mobile overlay + desktop sidebar */}
      {/* Mobile overlay */}
      {showSidebar && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setShowSidebar(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`
          fixed inset-y-0 left-0 z-50 w-64 transform rounded-none border-r border-slate-200 bg-white p-3 transition-transform duration-300 dark:border-slate-800 dark:bg-slate-900
          lg:static lg:z-auto lg:w-auto lg:transform-none lg:rounded-xl lg:border lg:transition-none
          ${showSidebar ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Folders
          </div>
          <button
            type="button"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 lg:hidden dark:hover:bg-slate-800 dark:hover:text-slate-300"
            onClick={() => setShowSidebar(false)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <FileTree serverId={serverId} activePath={path} onNavigate={(nextPath) => {
          setPath(nextPath);
          setShowSidebar(false);
        }} />
      </div>

      {/* Main content */}
      <div className="space-y-3 min-w-0">
        {/* Breadcrumb + toolbar */}
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
          {/* Breadcrumbs */}
          <nav className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 overflow-x-auto">
            <button
              type="button"
              className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
              onClick={() => setPath('/')}
              title="Root"
            >
              <Home className="h-3.5 w-3.5" />
            </button>
            {breadcrumbs.map((crumb) => (
              <div key={crumb.path} className="flex items-center gap-1 shrink-0">
                <ChevronRight className="h-3 w-3 text-slate-300 dark:text-slate-600" />
                <button
                  type="button"
                  className="rounded px-1.5 py-0.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white whitespace-nowrap"
                  onClick={() => setPath(crumb.path)}
                >
                  {crumb.name}
                </button>
              </div>
            ))}
          </nav>

          {/* Toolbar */}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={tbtn}
              onClick={() => setPath(getParentPath(path))}
              disabled={path === '/'}
              title="Go up"
            >
              <ArrowUp className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Up</span>
            </button>
            <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
            <button
              type="button"
              className={tbtn}
              onClick={guardSuspended(() => setShowUpload((prev) => !prev))}
              disabled={isSuspended}
            >
              <Upload className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Upload</span>
            </button>
            <button
              type="button"
              className={tbtn}
              onClick={guardSuspended(() => setCreateMode('file'))}
              disabled={isSuspended}
            >
              <FilePlus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">New File</span>
            </button>
            <button
              type="button"
              className={tbtn}
              onClick={guardSuspended(() => setCreateMode('directory'))}
              disabled={isSuspended}
            >
              <FolderPlus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">New Folder</span>
            </button>
            <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
            <button type="button" className={tbtn} onClick={() => refetch()}>
              <RefreshCw className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            {/* Selection actions */}
            {selectedEntries.length > 0 && (
              <>
                <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {selectedEntries.length}
                </span>
                <button
                  type="button"
                  className={tbtn}
                  onClick={guardSuspended(() => setShowCompress(true))}
                  disabled={isSuspended}
                >
                  <Archive className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Compress</span>
                </button>
                {selectedArchive && (
                  <button
                    type="button"
                    className={tbtn}
                    onClick={guardSuspended(() => setShowDecompress(true))}
                    disabled={isSuspended}
                  >
                    <ArchiveRestore className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Extract</span>
                  </button>
                )}
                <button
                  type="button"
                  className={tbtnDanger}
                  onClick={guardSuspended(() => setConfirmDelete(true))}
                  disabled={isSuspended}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Delete</span>
                </button>
                <button
                  type="button"
                  className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
                  onClick={() => setSelectedPaths(new Set())}
                >
                  <XCircle className="h-4 w-4" />
                </button>
              </>
            )}
          </div>

          {message && (
            <div className="mt-2 text-xs text-amber-600 dark:text-amber-300">{message}</div>
          )}
        </div>

        {/* Upload panel */}
        {showUpload && (
          <FileUploader
            path={path}
            isUploading={uploadMutation.isPending}
            onUpload={(filesToUpload) => uploadMutation.mutate(filesToUpload)}
            onClose={() => setShowUpload(false)}
          />
        )}

        {/* Create panel */}
        {createMode && (
          <form
            className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4 dark:border-slate-800 dark:bg-slate-900"
            onSubmit={handleCreateSubmit}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                {createMode === 'directory' ? 'Create Folder' : 'Create File'}
              </h3>
              <button type="button" className={tbtn} onClick={() => setCreateMode(null)}>
                Cancel
              </button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Name</span>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-primary-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:border-primary-400"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder={createMode === 'directory' ? 'configs' : 'server.properties'}
                  autoFocus
                />
              </label>
              {createMode === 'file' && (
                <label className="space-y-1">
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    Initial content
                  </span>
                  <textarea
                    className="h-20 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 outline-none transition-colors focus:border-primary-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:border-primary-400"
                    value={createContent}
                    onChange={(e) => setCreateContent(e.target.value)}
                    placeholder="# New file"
                  />
                </label>
              )}
            </div>
            <div className="mt-3 flex justify-end">
              <button
                type="submit"
                className={tbtnPrimary}
                disabled={!createName.trim() || createMutation.isPending || isSuspended}
              >
                Create
              </button>
            </div>
          </form>
        )}

        {/* Compress panel */}
        {showCompress && (
          <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Compress {selectedEntries.length} item(s)
              </h3>
              <button type="button" className={tbtn} onClick={() => setShowCompress(false)}>
                Cancel
              </button>
            </div>
            <div className="mt-3">
              <label className="space-y-1">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Archive name
                </span>
                <input
                  className="w-full sm:max-w-xs rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-primary-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:border-primary-400"
                  value={archiveName}
                  onChange={(e) => setArchiveName(e.target.value)}
                  placeholder="archive.tar.gz"
                />
              </label>
            </div>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                className={tbtnPrimary}
                onClick={handleCompress}
                disabled={!selectedEntries.length || compressMutation.isPending || isSuspended}
              >
                <Archive className="h-3.5 w-3.5" />
                Create Archive
              </button>
            </div>
          </div>
        )}

        {/* Decompress panel */}
        {showDecompress && selectedArchive && (
          <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white truncate mr-2">
                Extract: {selectedArchive.name}
              </h3>
              <button type="button" className={tbtn} onClick={() => setShowDecompress(false)}>
                Cancel
              </button>
            </div>
            <div className="mt-3">
              <label className="space-y-1">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Target path
                </span>
                <input
                  className="w-full sm:max-w-xs rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-primary-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:border-primary-400"
                  value={decompressTarget}
                  onChange={(e) => setDecompressTarget(e.target.value)}
                  placeholder="/"
                />
              </label>
            </div>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                className={tbtnPrimary}
                onClick={handleDecompress}
                disabled={decompressMutation.isPending || isSuspended}
              >
                <ArchiveRestore className="h-3.5 w-3.5" />
                Extract
              </button>
            </div>
          </div>
        )}

        {/* Delete confirmation */}
        {confirmDelete && selectedEntries.length > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 dark:border-rose-500/20 dark:bg-rose-500/5">
            <span className="text-sm text-rose-700 dark:text-rose-300">
              Delete {selectedEntries.length} item(s)? This cannot be undone.
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={tbtnDanger}
                onClick={handleDeleteSelection}
                disabled={deleteMutation.isPending || isSuspended}
              >
                Confirm Delete
              </button>
              <button type="button" className={tbtn} onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* File list */}
        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <FileList
            files={sortedFiles}
            selectedPaths={selectedPaths}
            isLoading={isLoading}
            isError={isError}
            allSelected={allSelected}
            sortField={sortField}
            sortDirection={sortDirection}
            renamingEntry={renamingEntry}
            onSort={handleSort}
            onSelectAll={handleSelectAll}
            onOpen={handleOpen}
            onSelect={handleSelect}
            onShiftSelect={handleShiftSelect}
            onDownload={handleDownload}
            onCopyPath={handleCopyPath}
            onRename={(entry) => {
              if (isSuspended) {
                notifyError('Server is suspended');
                return;
              }
              setRenamingEntry(entry);
            }}
            onRenameSubmit={handleRename}
            onRenameCancel={() => setRenamingEntry(null)}
            onDelete={(entry) => {
              if (isSuspended) {
                notifyError('Server is suspended');
                return;
              }
              setSelectedPaths(new Set([entry.path]));
              setConfirmDelete(true);
            }}
            onCompress={(entry) => {
              if (isSuspended) {
                notifyError('Server is suspended');
                return;
              }
              handleBulkCompressFromEntry(entry);
            }}
            onDecompress={(entry) => {
              if (isSuspended) {
                notifyError('Server is suspended');
                return;
              }
              handleBulkDecompressFromEntry(entry);
            }}
            onPermissions={(entry) => {
              if (isSuspended) {
                notifyError('Server is suspended');
                return;
              }
              handlePermissionsOpen(entry);
            }}
          />
        </div>
      </div>

      {/* File editor overlay */}
      {activeFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={closeActiveFile}
          />
          <div className="relative z-10 flex h-[95vh] sm:h-[90vh] w-full max-w-6xl flex-col rounded-lg sm:rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 p-2 sm:p-4">
              <FileEditor
                file={activeFile}
                isLoading={isFileLoading}
                isSaving={saveMutation.isPending}
                isDirty={isDirty}
                onChange={updateActiveContent}
                onSave={() => saveMutation.mutate()}
                onDownload={() => handleDownload(activeFile)}
                onReset={() => {
                  if (!activeFile) return;
                  updateActiveContent(activeFile.originalContent);
                }}
                onClose={closeActiveFile}
                isSuspended={isSuspended}
              />
          </div>
        </div>
      )}

      {/* Permissions modal */}
      {permissionsEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setPermissionsEntry(null)}
          />
          <form
            className="relative z-10 w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
            onSubmit={handlePermissionsSubmit}
          >
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Edit Permissions
            </h3>
            <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
              {permissionsEntry.path}
            </p>
            <div className="mt-4">
              <label className="space-y-1">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Mode (octal)
                </span>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 outline-none transition-colors focus:border-primary-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:border-primary-400"
                  value={permissionsValue}
                  onChange={(e) => {
                    setPermissionsValue(e.target.value);
                    setPermissionsError(null);
                  }}
                  placeholder={permissionsEntry.isDirectory ? '755' : '644'}
                  autoFocus
                />
              </label>
              <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">
                Three or four digits. Example: 644 for files, 755 for folders.
              </p>
            </div>
            {permissionsError && (
              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/5 dark:text-rose-300">
                {permissionsError}
              </div>
            )}
            <div className="mt-4 flex flex-col-reverse sm:flex-row justify-end gap-2">
              <button type="button" className={tbtn} onClick={() => setPermissionsEntry(null)}>
                Cancel
              </button>
              <button
                type="submit"
                className={tbtnPrimary}
                disabled={permissionsMutation.isPending || isSuspended}
              >
                Update
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Archive browser modal */}
      {archiveBrowsePath && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setArchiveBrowsePath(null)}
          />
          <div className="relative z-10 flex h-[95vh] sm:h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg sm:rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-200 px-3 sm:px-4 py-3 dark:border-slate-800">
              <div className="flex min-w-0 items-center gap-2">
                <Archive className="h-4 w-4 shrink-0 text-slate-400" />
                <span className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                  {archiveBrowsePath.split('/').pop()}
                </span>
                <span className="hidden sm:inline text-xs text-slate-400 dark:text-slate-500">— read-only preview</span>
              </div>
              <button
                type="button"
                className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                onClick={() => setArchiveBrowsePath(null)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Breadcrumbs */}
            <div className="flex items-center gap-1 border-b border-slate-100 px-3 sm:px-4 py-2 text-xs dark:border-slate-800/60 overflow-x-auto">
              <button
                type="button"
                className="rounded px-1.5 py-0.5 font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white shrink-0"
                onClick={() => setArchiveBrowseDir('/')}
              >
                <Home className="inline h-3 w-3" />
              </button>
              {archiveBrowseDir !== '/' &&
                archiveBrowseDir.split('/').filter(Boolean).map((seg, i, arr) => {
                  const segPath = '/' + arr.slice(0, i + 1).join('/');
                  return (
                    <span key={segPath} className="flex items-center gap-1 shrink-0">
                      <ChevronRight className="h-3 w-3 text-slate-300 dark:text-slate-600" />
                      <button
                        type="button"
                        className="rounded px-1.5 py-0.5 font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white whitespace-nowrap"
                        onClick={() => setArchiveBrowseDir(segPath)}
                      >
                        {seg}
                      </button>
                    </span>
                  );
                })}
            </div>

            {/* Content */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {archiveLoading ? (
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Reading archive…
                </div>
              ) : (
                <ArchiveListing
                  entries={archiveEntries}
                  currentDir={archiveBrowseDir}
                  onNavigate={setArchiveBrowseDir}
                />
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-slate-200 px-3 sm:px-4 py-2 dark:border-slate-800">
              <span className="text-[11px] text-slate-400 dark:text-slate-500">
                {archiveEntries.length} entries total
              </span>
              <button
                type="button"
                className={tbtn}
                onClick={() => setArchiveBrowsePath(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {bufferError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setBufferError(null)}
          />
          <div className="relative w-full max-w-md rounded-xl sm:rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-500/20">
                <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <h3 className="text-base sm:text-lg font-semibold text-slate-900 dark:text-white">Buffer Limit Exceeded</h3>
            </div>
            <p className="mb-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              This operation produced more output than the current buffer limit allows. This typically
              happens with large archives containing many files.
            </p>
            <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500 dark:text-slate-400">Current limit</span>
                <span className="font-medium text-slate-900 dark:text-white">{bufferError.currentMaxBufferMb} MB</span>
              </div>
              <div className="mt-1 flex justify-between text-sm">
                <span className="text-slate-500 dark:text-slate-400">Recommended</span>
                <span className="font-medium text-primary-600 dark:text-primary-400">{bufferError.recommendedMaxBufferMb} MB</span>
              </div>
            </div>
            <p className="mb-4 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              An admin can increase the <span className="font-medium text-slate-700 dark:text-slate-200">Max buffer (MB)</span> setting
              under <span className="font-medium text-slate-700 dark:text-slate-200">Admin → Security</span> to resolve this.
            </p>
            <button
              onClick={() => setBufferError(null)}
              className="w-full rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700 dark:bg-primary-500 dark:hover:bg-primary-600"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Archive virtual directory listing ── */

type ArchiveItem = { name: string; size: number; isDirectory: boolean; modified?: string };

function formatSize(bytes: number) {
  if (bytes === 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ArchiveListing({
  entries,
  currentDir,
  onNavigate,
}: {
  entries: ArchiveItem[];
  currentDir: string;
  onNavigate: (dir: string) => void;
}) {
  const prefix = currentDir === '/' ? '' : currentDir.replace(/^\//, '') + '/';

  const visible = useMemo(() => {
    const seen = new Set<string>();
    const items: (ArchiveItem & { displayName: string })[] = [];

    for (const entry of entries) {
      const { name } = entry;
      if (prefix && !name.startsWith(prefix)) continue;
      const rest = name.slice(prefix.length);
      if (!rest) continue;

      const slashIdx = rest.indexOf('/');
      if (slashIdx === -1) {
        if (!seen.has(rest)) {
          seen.add(rest);
          items.push({ ...entry, displayName: rest });
        }
      } else {
        const dirName = rest.slice(0, slashIdx);
        if (!seen.has(dirName)) {
          seen.add(dirName);
          items.push({ name: prefix + dirName, displayName: dirName, size: 0, isDirectory: true });
        }
      }
    }

    items.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    });
    return items;
  }, [entries, prefix]);

  if (visible.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-slate-400 dark:text-slate-500">
        Empty directory
      </div>
    );
  }

  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b border-slate-100 text-[11px] font-medium uppercase tracking-wider text-slate-400 dark:border-slate-800 dark:text-slate-500">
          <th className="px-4 py-2">Name</th>
          <th className="px-4 py-2 text-right">Size</th>
        </tr>
      </thead>
      <tbody>
        {visible.map((item) => (
          <tr
            key={item.name}
            className="border-b border-slate-50 transition-colors hover:bg-slate-50 dark:border-slate-800/40 dark:hover:bg-slate-800/40"
            onDoubleClick={() => item.isDirectory && onNavigate('/' + item.name)}
          >
            <td className="px-4 py-1.5">
              <button
                type="button"
                className="flex items-center gap-2 text-slate-700 transition-colors hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                onClick={() => item.isDirectory && onNavigate('/' + item.name)}
                disabled={!item.isDirectory}
              >
                {item.isDirectory ? (
                  <Folder className="h-4 w-4 shrink-0 text-sky-500/70" />
                ) : (
                  <File className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
                )}
                <span className={item.isDirectory ? 'font-medium' : ''}>{item.displayName}</span>
              </button>
            </td>
            <td className="px-4 py-1.5 text-right text-xs tabular-nums text-slate-400 dark:text-slate-500">
              {item.isDirectory ? '—' : formatSize(item.size)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default FileManager;
