import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@/csync';
import { qk } from '@/lib/queryKeys';

import { motion, AnimatePresence, type Variants } from 'framer-motion';
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
 HardDrive,
 Search,
 Shield,
} from 'lucide-react';
import FileEditor from './FileEditor';
import FileList from './FileList';
import FileTree from './FileTree';
import FileUploader from './FileUploader';
import { useFileManager } from '../../hooks/useFileManager';
import { filesApi, DEFAULT_MAX_UPLOAD_MB } from '../../services/api/files';
import { adminApi } from '../../services/api/admin';
import type { FileEntry } from '../../types/file';
import { formatFileMode } from '../../utils/formatters';
import { notifyError, notifyInfo, notifySuccess } from '../../utils/notify';
import { buildBreadcrumbs, getParentPath, joinPath, normalizePath } from '../../utils/filePaths';
import { ModalPortal } from '@/components/ui/modal-portal';
import { reportSystemError } from '../../services/api/systemErrors';

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
 const msg = error?.message ?? '';
 if (msg.includes('MAX_BUFFER_EXCEEDED') || msg.includes('buffer limit')) {
 const currentMatch = msg.match(/(\d+)\s*MB/i);
 const recommendedMatch = msg.match(/(\d+)\s*MB/gi);
 return {
 currentMaxBufferMb: currentMatch ? parseInt(currentMatch[1], 10) : 50,
 recommendedMaxBufferMb: recommendedMatch?.[1] ? parseInt(recommendedMatch[1], 10) : 100,
 };
 }
 return null;
};

const containerVariants: Variants = {
 hidden: { opacity: 0 },
 visible: { opacity: 1, transition: { staggerChildren: 0.04, delayChildren: 0.05 } },
};

const itemVariants: Variants = {
 hidden: { opacity: 0, y: 8 },
 visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 350, damping: 26 } },
};

function FileManager({ serverId, isSuspended = false, canWrite = false }: { serverId: string; isSuspended?: boolean; canWrite?: boolean }) {
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
 const [searchQuery, setSearchQuery] = useState('');

 const writeDisabled = isSuspended || !canWrite;

 // Reset UI state when navigating to a different path
 useEffect(() => {
 const id = setTimeout(() => {
 setSelectedPaths(new Set());
 setConfirmDelete(false);
 setShowCompress(false);
 setShowDecompress(false);
 setPermissionsEntry(null);
 setPermissionsError(null);
 setRenamingEntry(null);
 }, 0);
 return () => clearTimeout(id);
 }, [path]);

 // Sync decompress target with current path
 useEffect(() => {
 const id = setTimeout(() => setDecompressTarget(path), 0);
 return () => clearTimeout(id);
 }, [path]);

 // Clear bulk actions when selection is emptied
 useEffect(() => {
 if (!selectedPaths.size) {
 const id = setTimeout(() => {
 setConfirmDelete(false);
 setShowCompress(false);
 setShowDecompress(false);
 }, 0);
 return () => clearTimeout(id);
 }
 }, [selectedPaths]);

 // Filter files by search
 const filteredFiles = useMemo(() => {
 if (!searchQuery.trim()) return files;
 const q = searchQuery.toLowerCase();
 return files.filter((f) => f.name.toLowerCase().includes(q));
 }, [files, searchQuery]);

 const sortedFiles = useMemo(() => {
 const next = [...filteredFiles];
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
 }, [filteredFiles, sortField, sortDirection]);

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
 queryClient.invalidateQueries({ queryKey: qk.files(serverId, path) });
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
 setCreateName('');
 setCreateContent('');
 setCreateMode(null);
 notifySuccess(entry.isDirectory ? 'Folder created' : 'File created');
 if (!entry.isDirectory) {
 openFile(entry);
 }
 },
 onError: (error: any) => {
 notifyError(error?.message || 'Failed to create item');
 },
 onSettled: () => {
 invalidateFiles();
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
 },
 onError: (error: any) => {
 notifyError(error?.message || 'Failed to save file');
 },
 onSettled: () => {
 invalidateFiles();
 },
 });

 const deleteMutation = useMutation({
 mutationFn: async (paths: string[]) => {
 await Promise.all(paths.map((target) => filesApi.remove(serverId, target)));
 },
 onSuccess: (_, paths) => {
 setSelectedPaths(new Set());
 setConfirmDelete(false);
 if (activeFile && paths.includes(activeFile.path)) {
 closeActiveFile();
 }
 notifySuccess('Deleted selection');
 },
 onError: (error: any) => {
 notifyError(error?.message || 'Failed to delete selection');
 },
 onSettled: () => {
 invalidateFiles();
 },
 });

 const uploadMutation = useMutation({
 mutationFn: async ({ files, onProgress, signal }: { files: File[]; onProgress?: (fileIndex: number, progress: number) => void; signal?: AbortSignal }) => {
 // Validate file sizes against the configurable upload limit (with fallback)
 let maxUploadMb: number;
 try {
 const controller = new AbortController();
 const timeout = setTimeout(() => controller.abort(), 5000);
 try {
 maxUploadMb = await adminApi.getFileTunnelUploadLimit();
 } finally {
 clearTimeout(timeout);
 }
 } catch {
 maxUploadMb = DEFAULT_MAX_UPLOAD_MB; // fallback — when the setting can't be fetched
 }
 const maxBytes = maxUploadMb * 1024 * 1024;
 const oversized = files.filter((f) => f.size > maxBytes);
 if (oversized.length > 0) {
 const names = oversized.map((f) => f.name).join(', ');
 throw new Error(`Files exceed the maximum upload size of ${maxUploadMb}MB: ${names}`);
 }
 await filesApi.upload(serverId, path, files, onProgress, signal);
 },
 onSuccess: () => {
 setShowUpload(false);
 notifySuccess('Upload complete');
 },
 onError: (error: any) => {
 notifyError(error?.message || 'Failed to upload files');
 },
 onSettled: () => {
 invalidateFiles();
 },
 });

 const compressMutation = useMutation({
 mutationFn: async ({ paths, archive }: { paths: string[]; archive: string }) =>
 filesApi.compress(serverId, { paths, archiveName: archive }),
 onSuccess: (data) => {
 setShowCompress(false);
 notifySuccess(data?.archivePath ? `Archive created at ${data.archivePath}` : 'Archive created');
 },
 onError: (error: any) => {
 const bufErr = isBufferError(error);
 if (bufErr) return setBufferError(bufErr);
 notifyError(error?.message || 'Failed to compress files');
 },
 onSettled: () => {
 invalidateFiles();
 },
 });

 const decompressMutation = useMutation({
 mutationFn: async ({ archivePath, targetPath }: { archivePath: string; targetPath: string }) =>
 filesApi.decompress(serverId, { archivePath, targetPath }),
 onSuccess: () => {
 setShowDecompress(false);
 notifySuccess('Archive extracted');
 },
 onError: (error: any) => {
 const bufErr = isBufferError(error);
 if (bufErr) return setBufferError(bufErr);
 notifyError(error?.message || 'Failed to extract archive');
 },
 onSettled: () => {
 invalidateFiles();
 },
 });

 const permissionsMutation = useMutation({
 mutationFn: async ({ path: targetPath, mode }: { path: string; mode: number }) =>
 filesApi.updatePermissions(serverId, targetPath, mode),
 onSuccess: () => {
 setPermissionsEntry(null);
 notifySuccess('Permissions updated');
 },
 onError: (error: any) => {
 notifyError(error?.message || 'Failed to update permissions');
 },
 onSettled: () => {
 invalidateFiles();
 },
 });

 const renameMutation = useMutation({
 mutationFn: async ({ from, to }: { from: string; to: string }) =>
 filesApi.rename(serverId, from, to),
 onSuccess: () => {
 setRenamingEntry(null);
 notifySuccess('Renamed');
 },
 onError: (error: any) => {
 notifyError(error?.message || 'Failed to rename');
 },
 onSettled: () => {
 invalidateFiles();
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
 } catch (error: unknown) {
 reportSystemError({
 level: 'error',
 component: 'FileManager',
 message: error instanceof Error ? error.message : String(error),
 stack: error instanceof Error ? error.stack : undefined,
 metadata: { context: 'read archive' },
 });
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

 // Toolbar button styles
 const tbtn =
 'inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-all hover:bg-surface-2 hover:text-foreground hover:border-border hover:shadow-sm disabled:opacity-40 dark:border-border/40 dark:hover:bg-surface-2 dark:hover:text-foreground';
 const tbtnIcon =
 'inline-flex items-center justify-center h-8 w-8 rounded-lg border border-border/60 text-muted-foreground transition-all hover:bg-surface-2 hover:text-foreground hover:border-border hover:shadow-sm disabled:opacity-40 dark:border-border/40 dark:hover:bg-surface-2 dark:hover:text-foreground';
 const tbtnDanger =
 'inline-flex items-center gap-1.5 rounded-lg border border-danger/20 px-2.5 py-1.5 text-xs font-medium text-danger transition-all hover:bg-danger-muted hover:border-danger/30 disabled:opacity-40 dark:border-danger/20 dark:text-danger dark:hover:bg-danger-muted';
 const tbtnPrimary =
 'inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-all hover:bg-primary/90 disabled:opacity-50';

 return (
 <motion.div
 className="flex flex-col lg:grid lg:grid-cols-[240px_1fr] gap-4"
 variants={containerVariants}
 initial="hidden"
 animate="visible"
 >
 {/* Ambient background (subtle, panel-style) */}



 {/* Mobile sidebar toggle */}
 <motion.button
 variants={itemVariants}
 type="button"
 className="lg:hidden flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium text-muted-foreground"
 onClick={() => setShowSidebar(!showSidebar)}
 >
 <Menu className="h-4 w-4" />
 Folders
 </motion.button>

 {/* Mobile overlay */}
 <AnimatePresence>
 {showSidebar && (
 <motion.div
 initial={{ opacity: 0 }}
 animate={{ opacity: 1 }}
 exit={{ opacity: 0 }}
 className="fixed inset-0 z-40 bg-surface-0/50 backdrop-blur-sm lg:hidden"
 onClick={() => setShowSidebar(false)}
 />
 )}
 </AnimatePresence>

 {/* Sidebar */}
 <motion.div
 variants={itemVariants}
 className={`
 fixed inset-y-0 left-0 z-50 w-64 transform rounded-none border-r border-border bg-card p-3 transition-transform duration-300 ease-out
 lg:static lg:z-auto lg:w-auto lg:transform-none lg:rounded-xl lg:border lg:transition-none lg:shadow-sm
 ${showSidebar ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
 `}
 >
 <div className="flex items-center justify-between mb-3">
 <div className="flex items-center gap-2">
 <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
 <HardDrive className="h-3.5 w-3.5 text-primary" />
 </div>
 <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
 Directory Tree
 </div>
 </div>
 <button
 type="button"
 className="rounded-lg p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground lg:hidden"
 onClick={() => setShowSidebar(false)}
 >
 <X className="h-4 w-4" />
 </button>
 </div>
 <div className="overflow-y-auto max-h-[calc(100vh-200px)] scrollbar-thin">
 <FileTree
 serverId={serverId}
 activePath={path}
 onNavigate={(nextPath) => {
 setPath(nextPath);
 setShowSidebar(false);
 }}
 />
 </div>
 </motion.div>

 {/* Main content */}
 <motion.div variants={itemVariants} className="space-y-3 min-w-0">
 {/* Breadcrumb + toolbar */}
 <div className="rounded-xl border border-border bg-card px-4 py-3 dark:border-border dark:bg-surface-1">
 {/* Breadcrumbs */}
 <nav className="flex items-center gap-1 text-xs text-muted-foreground overflow-x-auto scrollbar-hide pb-2">
 <button
 type="button"
 className="flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-surface-2 hover:text-foreground shrink-0 transition-colors"
 onClick={() => setPath('/')}
 title="Root"
 >
 <Home className="h-3.5 w-3.5" />
 <span className="hidden sm:inline">Root</span>
 </button>
 {breadcrumbs.map((crumb, idx) => (
 <div key={crumb.path} className="flex items-center gap-1 shrink-0">
 <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
 <button
 type="button"
 className={`rounded-md px-1.5 py-0.5 transition-colors whitespace-nowrap ${
 idx === breadcrumbs.length - 1
 ? 'font-medium text-foreground hover:text-foreground'
 : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground'
 }`}
 onClick={() => setPath(crumb.path)}
 >
 {crumb.name}
 </button>
 </div>
 ))}
 </nav>

 {/* Search bar + toolbar */}
 <div className="mt-1 flex flex-wrap items-center gap-2">
 {/* Search */}
 <div className="relative flex-1 min-w-[140px] max-w-xs">
 <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
 <input
 type="text"
 placeholder="Filter files…"
 value={searchQuery}
 onChange={(e) => setSearchQuery(e.target.value)}
 className="w-full rounded-lg border border-border bg-surface-1 pl-8 pr-3 py-1.5 text-xs text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/20 dark:border-border dark:bg-surface-2"
 />
 </div>

 <div className="hidden sm:block h-4 w-px bg-border/60" />

 {/* Navigation */}
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

 <div className="hidden sm:block h-4 w-px bg-border/60" />

 {/* Create actions */}
 {canWrite && (
 <>
 <button
 type="button"
 className={tbtn}
 onClick={guardSuspended(() => setShowUpload((prev) => !prev))}
 disabled={writeDisabled}
 >
 <Upload className="h-3.5 w-3.5" />
 <span className="hidden sm:inline">Upload</span>
 </button>
 <button
 type="button"
 className={tbtn}
 onClick={guardSuspended(() => setCreateMode('file'))}
 disabled={writeDisabled}
 >
 <FilePlus className="h-3.5 w-3.5" />
 <span className="hidden sm:inline">New File</span>
 </button>
 <button
 type="button"
 className={tbtn}
 onClick={guardSuspended(() => setCreateMode('directory'))}
 disabled={writeDisabled}
 >
 <FolderPlus className="h-3.5 w-3.5" />
 <span className="hidden sm:inline">New Folder</span>
 </button>
 </>
 )}

 <div className="hidden sm:block h-4 w-px bg-border/60" />

 <button type="button" className={tbtnIcon} onClick={() => refetch()} title="Refresh">
 <RefreshCw className="h-3.5 w-3.5" />
 </button>

 {/* Selection actions */}
 <AnimatePresence>
 {selectedEntries.length > 0 && (
 <motion.div
 initial={{ opacity: 0, width: 0 }}
 animate={{ opacity: 1, width: 'auto' }}
 exit={{ opacity: 0, width: 0 }}
 className="flex items-center gap-2 overflow-hidden"
 >
 <div className="hidden sm:block h-4 w-px bg-border/60" />
 <span className="text-xs font-medium text-primary tabular-nums">
 {selectedEntries.length}
 </span>
 {canWrite && (
 <button
 type="button"
 className={tbtn}
 onClick={guardSuspended(() => setShowCompress(true))}
 disabled={writeDisabled}
 >
 <Archive className="h-3.5 w-3.5" />
 <span className="hidden sm:inline">Compress</span>
 </button>
 )}
 {canWrite && selectedArchive && (
 <button
 type="button"
 className={tbtn}
 onClick={guardSuspended(() => setShowDecompress(true))}
 disabled={writeDisabled}
 >
 <ArchiveRestore className="h-3.5 w-3.5" />
 <span className="hidden sm:inline">Extract</span>
 </button>
 )}
 {canWrite && (
 <button
 type="button"
 className={tbtnDanger}
 onClick={guardSuspended(() => setConfirmDelete(true))}
 disabled={writeDisabled}
 >
 <Trash2 className="h-3.5 w-3.5" />
 <span className="hidden sm:inline">Delete</span>
 </button>
 )}
 <button
 type="button"
 className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
 onClick={() => setSelectedPaths(new Set())}
 title="Clear selection"
 >
 <XCircle className="h-4 w-4" />
 </button>
 </motion.div>
 )}
 </AnimatePresence>
 </div>

 {message && (
 <div className="mt-2 rounded-lg bg-warning-muted px-3 py-1.5 text-xs text-warning flex items-center gap-1.5">
 <AlertTriangle className="h-3 w-3 shrink-0" />
 {message}
 </div>
 )}
 </div>

 {/* Delete confirmation */}
 <AnimatePresence>
 {confirmDelete && selectedEntries.length > 0 && (
 <motion.div
 initial={{ opacity: 0, y: -8 }}
 animate={{ opacity: 1, y: 0 }}
 exit={{ opacity: 0, y: -8 }}
 transition={{ duration: 0.2 }}
 className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-danger/20 bg-danger-muted px-4 py-3 dark:border-danger/15 dark:bg-danger-muted/30"
 >
 <div className="flex items-center gap-2">
 <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-danger/10">
 <Trash2 className="h-4 w-4 text-danger" />
 </div>
 <span className="text-sm text-danger">
 Delete {selectedEntries.length} item{selectedEntries.length !== 1 ? 's' : ''}? This cannot be undone.
 </span>
 </div>
 <div className="flex items-center gap-2">
 <button
 type="button"
 className={tbtnDanger}
 onClick={handleDeleteSelection}
 disabled={deleteMutation.isPending || writeDisabled}
 >
 {deleteMutation.isPending ? (
 <Loader2 className="h-3.5 w-3.5 animate-spin" />
 ) : (
 'Confirm Delete'
 )}
 </button>
 <button type="button" className={tbtn} onClick={() => setConfirmDelete(false)}>
 Cancel
 </button>
 </div>
 </motion.div>
 )}
 </AnimatePresence>

 {/* File list */}
 <div className="rounded-xl border border-border bg-card dark:border-border dark:bg-surface-1 h-[calc(100vh-280px)] min-h-[200px] overflow-hidden">
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
 if (!canWrite) {
 notifyError('You do not have permission to modify files');
 return;
 }
 if (isSuspended) {
 notifyError('Server is suspended');
 return;
 }
 setRenamingEntry(entry);
 }}
 onRenameSubmit={handleRename}
 onRenameCancel={() => setRenamingEntry(null)}
 onDelete={(entry) => {
 if (!canWrite) {
 notifyError('You do not have permission to modify files');
 return;
 }
 if (isSuspended) {
 notifyError('Server is suspended');
 return;
 }
 setSelectedPaths(new Set([entry.path]));
 setConfirmDelete(true);
 }}
 onCompress={(entry) => {
 if (!canWrite) {
 notifyError('You do not have permission to modify files');
 return;
 }
 if (isSuspended) {
 notifyError('Server is suspended');
 return;
 }
 handleBulkCompressFromEntry(entry);
 }}
 onDecompress={(entry) => {
 if (!canWrite) {
 notifyError('You do not have permission to modify files');
 return;
 }
 if (isSuspended) {
 notifyError('Server is suspended');
 return;
 }
 handleBulkDecompressFromEntry(entry);
 }}
 onPermissions={(entry) => {
 if (!canWrite) {
 notifyError('You do not have permission to modify files');
 return;
 }
 if (isSuspended) {
 notifyError('Server is suspended');
 return;
 }
 handlePermissionsOpen(entry);
 }}
 />
 </div>
 </motion.div>

 {/* File editor overlay */}
 <AnimatePresence>
 {activeFile && (
 <ModalPortal>
 <motion.div
 initial={{ opacity: 0 }}
 animate={{ opacity: 1 }}
 exit={{ opacity: 0 }}
 transition={{ duration: 0.2 }}
 className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6"
 >
 <div
 className="absolute inset-0 bg-surface-0/40 backdrop-blur-sm"
 onClick={closeActiveFile}
 />
 <motion.div
 initial={{ opacity: 0, scale: 0.96, y: 8 }}
 animate={{ opacity: 1, scale: 1, y: 0 }}
 exit={{ opacity: 0, scale: 0.96, y: 8 }}
 transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
 className="relative z-10 flex h-[95vh] sm:h-[90vh] w-full max-w-6xl flex-col rounded-xl border border-border bg-card shadow-elevated dark:border-border dark:bg-surface-1 p-2 sm:p-4"
 >
 <FileEditor
 file={activeFile}
 isLoading={isFileLoading}
 isSaving={saveMutation.isPending}
 isDirty={isDirty}
 onChange={updateActiveContent}
 onSave={() => {
 if (!canWrite) {
 notifyError('You do not have permission to modify files');
 return;
 }
 saveMutation.mutate();
 }}
 onDownload={() => activeFile && handleDownload(activeFile as unknown as FileEntry)}
 onReset={() => {
 if (!activeFile) return;
 updateActiveContent(activeFile.originalContent);
 }}
 onClose={closeActiveFile}
 isSuspended={isSuspended || !canWrite}
 />
 </motion.div>
 </motion.div>
 </ModalPortal>
 )}
 </AnimatePresence>

 {/* Permissions modal */}
 <AnimatePresence>
 {permissionsEntry && (
 <ModalPortal>
 <motion.div
 initial={{ opacity: 0 }}
 animate={{ opacity: 1 }}
 exit={{ opacity: 0 }}
 transition={{ duration: 0.2 }}
 className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
 >
 <div
 className="absolute inset-0 bg-surface-0/40 backdrop-blur-sm"
 onClick={() => setPermissionsEntry(null)}
 />
 <motion.form
 initial={{ opacity: 0, scale: 0.96, y: 8 }}
 animate={{ opacity: 1, scale: 1, y: 0 }}
 exit={{ opacity: 0, scale: 0.96, y: 8 }}
 transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
 className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card p-4 sm:p-5 shadow-elevated dark:border-border dark:bg-surface-1"
 onSubmit={handlePermissionsSubmit}
 >
 <div className="flex items-center gap-2">
 <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-success/10">
 <Shield className="h-4 w-4 text-success" />
 </div>
 <h3 className="text-sm font-semibold text-foreground">
 Edit Permissions
 </h3>
 </div>
 <p className="mt-1 truncate text-xs text-muted-foreground">
 {permissionsEntry.path}
 </p>
 <div className="mt-4">
 <label className="space-y-1">
 <span className="text-xs font-medium text-muted-foreground">
 Mode (octal)
 </span>
 <input
 className="w-full rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/20 dark:border-border dark:bg-surface-2"
 value={permissionsValue}
 onChange={(e) => {
 setPermissionsValue(e.target.value);
 setPermissionsError(null);
 }}
 placeholder={permissionsEntry.isDirectory ? '755' : '644'}
 autoFocus
 />
 </label>
 <p className="mt-1.5 text-[11px] text-muted-foreground/70">
 Three or four digits. Example: <span className="font-mono text-foreground/80">644</span> for files,{' '}
 <span className="font-mono text-foreground/80">755</span> for folders.
 </p>
 </div>
 {permissionsError && (
 <div className="mt-3 rounded-lg border border-danger/20 bg-danger-muted px-3 py-2 text-xs text-danger dark:border-danger/15 dark:bg-danger-muted/30">
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
 disabled={permissionsMutation.isPending || writeDisabled}
 >
 {permissionsMutation.isPending ? (
 <Loader2 className="h-3.5 w-3.5 animate-spin" />
 ) : (
 'Update'
 )}
 </button>
 </div>
 </motion.form>
 </motion.div>
 </ModalPortal>
 )}
 </AnimatePresence>

 {/* Archive browser modal */}
 <AnimatePresence>
 {archiveBrowsePath && (
 <ModalPortal>
 <motion.div
 initial={{ opacity: 0 }}
 animate={{ opacity: 1 }}
 exit={{ opacity: 0 }}
 transition={{ duration: 0.2 }}
 className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6"
 >
 <div
 className="absolute inset-0 bg-surface-0/40 backdrop-blur-sm"
 onClick={() => setArchiveBrowsePath(null)}
 />
 <motion.div
 initial={{ opacity: 0, scale: 0.96, y: 8 }}
 animate={{ opacity: 1, scale: 1, y: 0 }}
 exit={{ opacity: 0, scale: 0.96, y: 8 }}
 transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-10 flex h-[95vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border/70 bg-card shadow-elevated sm:h-[80vh]"
        >
          <div className="flex items-center justify-between border-b border-border/70 px-3 py-2.5">
            <div className="flex min-w-0 items-start gap-2.5">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-warning/30 bg-warning/10 text-warning">
                <Archive className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold tracking-tight text-foreground">
                  {archiveBrowsePath.split('/').pop()}
                </h2>
                <p className="type-meta mt-0.5">Read-only preview</p>
              </div>
            </div>
            <button
              type="button"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground"
              onClick={() => setArchiveBrowsePath(null)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

 {/* Breadcrumbs */}
 <div className="flex items-center gap-1 border-b border-border px-3 sm:px-4 py-2 text-xs overflow-x-auto scrollbar-hide">
 <button
 type="button"
 className="rounded-md px-1.5 py-0.5 font-medium text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground shrink-0"
 onClick={() => setArchiveBrowseDir('/')}
 >
 <Home className="inline h-3 w-3" />
 </button>
 {archiveBrowseDir !== '/' &&
 archiveBrowseDir.split('/').filter(Boolean).map((seg, i, arr) => {
 const segPath = '/' + arr.slice(0, i + 1).join('/');
 return (
 <span key={segPath} className="flex items-center gap-1 shrink-0">
 <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
 <button
 type="button"
 className="rounded-md px-1.5 py-0.5 font-medium text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground whitespace-nowrap"
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
 <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
 <Loader2 className="h-6 w-6 animate-spin text-primary" />
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
 <div className="flex items-center justify-between border-t border-border px-3 sm:px-4 py-2">
 <span className="text-[11px] text-muted-foreground">
 {archiveEntries.length} entries total
 </span>
 <button type="button" className={tbtn} onClick={() => setArchiveBrowsePath(null)}>
 Close
 </button>
 </div>
 </motion.div>
 </motion.div>
 </ModalPortal>
 )}
 </AnimatePresence>

 {/* Buffer error modal */}
 <AnimatePresence>
 {bufferError && (
 <ModalPortal>
 <motion.div
 initial={{ opacity: 0 }}
 animate={{ opacity: 1 }}
 exit={{ opacity: 0 }}
 transition={{ duration: 0.2 }}
 className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
 >
 <div
 className="absolute inset-0 bg-surface-0/40 backdrop-blur-sm"
 onClick={() => setBufferError(null)}
 />
 <motion.div
 initial={{ opacity: 0, scale: 0.96, y: 8 }}
 animate={{ opacity: 1, scale: 1, y: 0 }}
 exit={{ opacity: 0, scale: 0.96, y: 8 }}
 transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
 className="relative w-full max-w-md rounded-xl border border-border bg-card p-4 sm:p-6 shadow-elevated dark:border-border dark:bg-surface-1"
 >
 <div className="mb-4 flex items-center gap-3">
 <div className="flex h-10 w-10 items-center justify-center rounded-full bg-warning-muted dark:bg-warning-muted/20">
 <AlertTriangle className="h-5 w-5 text-warning" />
 </div>
 <h3 className="text-base sm:text-lg font-semibold text-foreground">Buffer Limit Exceeded</h3>
 </div>
 <p className="mb-3 text-sm leading-relaxed text-muted-foreground">
 This operation produced more output than the current buffer limit allows. This typically
 happens with large archives containing many files.
 </p>
 <div className="mb-4 rounded-lg border border-border bg-surface-2 p-3 dark:border-border dark:bg-surface-2">
 <div className="flex justify-between text-sm">
 <span className="text-muted-foreground">Current limit</span>
 <span className="font-medium text-foreground">{bufferError.currentMaxBufferMb} MB</span>
 </div>
 <div className="mt-1 flex justify-between text-sm">
 <span className="text-muted-foreground">Recommended</span>
 <span className="font-medium text-primary">{bufferError.recommendedMaxBufferMb} MB</span>
 </div>
 </div>
 <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
 An admin can increase the <span className="font-medium text-foreground">Max buffer (MB)</span> setting
 under <span className="font-medium text-foreground">Admin → Security</span> to resolve this.
 </p>
 <button
 onClick={() => setBufferError(null)}
 className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
 >
 Got it
 </button>
 </motion.div>
 </motion.div>
 </ModalPortal>
 )}
 </AnimatePresence>

 {/* Upload modal */}
 <AnimatePresence>
 {showUpload && (
 <ModalPortal>
 <motion.div
 initial={{ opacity: 0 }}
 animate={{ opacity: 1 }}
 exit={{ opacity: 0 }}
 transition={{ duration: 0.2 }}
 className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
 >
 <div
 className="absolute inset-0 bg-surface-0/40 backdrop-blur-sm"
 onClick={() => setShowUpload(false)}
 />
 <motion.div
 initial={{ opacity: 0, scale: 0.96, y: 8 }}
 animate={{ opacity: 1, scale: 1, y: 0 }}
 exit={{ opacity: 0, scale: 0.96, y: 8 }}
 transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
 className="relative z-10 w-full max-w-lg rounded-xl border border-border bg-card p-4 sm:p-5 shadow-elevated dark:border-border dark:bg-surface-1"
 >
 <div className="flex items-center gap-2 mb-4">
 <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
 <Upload className="h-4 w-4 text-primary" />
 </div>
 <div>
 <h3 className="text-sm font-semibold text-foreground">Upload Files</h3>
 <p className="text-[11px] text-muted-foreground">Target: <span className="font-mono">{path}</span></p>
 </div>
 <button
 type="button"
 className="ml-auto rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
 onClick={() => setShowUpload(false)}
 >
 <X className="h-4 w-4" />
 </button>
 </div>
 <FileUploader
 path={path}
 isUploading={uploadMutation.isPending}
 onUpload={(filesToUpload, onProgress, signal) =>
 uploadMutation.mutate({ files: filesToUpload, onProgress, signal })
 }
 onClose={() => setShowUpload(false)}
 inModal
 />
 </motion.div>
 </motion.div>
 </ModalPortal>
 )}
 </AnimatePresence>

 {/* Create file/folder modal */}
 <AnimatePresence>
 {createMode && (
 <ModalPortal>
 <motion.div
 initial={{ opacity: 0 }}
 animate={{ opacity: 1 }}
 exit={{ opacity: 0 }}
 transition={{ duration: 0.2 }}
 className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
 >
 <div
 className="absolute inset-0 bg-surface-0/40 backdrop-blur-sm"
 onClick={() => setCreateMode(null)}
 />
 <motion.form
 initial={{ opacity: 0, scale: 0.96, y: 8 }}
 animate={{ opacity: 1, scale: 1, y: 0 }}
 exit={{ opacity: 0, scale: 0.96, y: 8 }}
 transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
 className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card p-4 sm:p-5 shadow-elevated dark:border-border dark:bg-surface-1"
 onSubmit={handleCreateSubmit}
 >
 <div className="flex items-center gap-2">
 <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
 {createMode === 'directory' ? (
 <FolderPlus className="h-4 w-4 text-primary" />
 ) : (
 <FilePlus className="h-4 w-4 text-primary" />
 )}
 </div>
 <h3 className="text-sm font-semibold text-foreground">
 {createMode === 'directory' ? 'Create Folder' : 'Create File'}
 </h3>
 <button
 type="button"
 className="ml-auto rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
 onClick={() => setCreateMode(null)}
 >
 <X className="h-4 w-4" />
 </button>
 </div>
 <div className="mt-4 space-y-3">
 <label className="block space-y-1">
 <span className="text-xs font-medium text-muted-foreground">Name</span>
 <input
 className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/20 dark:border-border dark:bg-surface-2"
 value={createName}
 onChange={(e) => setCreateName(e.target.value)}
 placeholder={createMode === 'directory' ? 'configs' : 'server.properties'}
 autoFocus
 />
 </label>
 {createMode === 'file' && (
 <label className="block space-y-1">
 <span className="text-xs font-medium text-muted-foreground">Initial content</span>
 <textarea
 className="h-24 w-full rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/20 dark:border-border dark:bg-surface-2"
 value={createContent}
 onChange={(e) => setCreateContent(e.target.value)}
 placeholder="# New file"
 />
 </label>
 )}
 </div>
 <div className="mt-4 flex justify-end gap-2">
 <button type="button" className={tbtn} onClick={() => setCreateMode(null)}>
 Cancel
 </button>
 <button
 type="submit"
 className={tbtnPrimary}
 disabled={!createName.trim() || createMutation.isPending || writeDisabled}
 >
 {createMutation.isPending ? (
 <Loader2 className="h-3.5 w-3.5 animate-spin" />
 ) : (
 'Create'
 )}
 </button>
 </div>
 </motion.form>
 </motion.div>
 </ModalPortal>
 )}
 </AnimatePresence>

 {/* Compress modal */}
 <AnimatePresence>
 {showCompress && (
 <ModalPortal>
 <motion.div
 initial={{ opacity: 0 }}
 animate={{ opacity: 1 }}
 exit={{ opacity: 0 }}
 transition={{ duration: 0.2 }}
 className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
 >
 <div
 className="absolute inset-0 bg-surface-0/40 backdrop-blur-sm"
 onClick={() => setShowCompress(false)}
 />
 <motion.div
 initial={{ opacity: 0, scale: 0.96, y: 8 }}
 animate={{ opacity: 1, scale: 1, y: 0 }}
 exit={{ opacity: 0, scale: 0.96, y: 8 }}
 transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
 className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card p-4 sm:p-5 shadow-elevated dark:border-border dark:bg-surface-1"
 >
 <div className="flex items-center gap-2">
 <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-warning/10">
 <Archive className="h-4 w-4 text-warning" />
 </div>
 <h3 className="text-sm font-semibold text-foreground">
 Compress {selectedEntries.length} item{selectedEntries.length !== 1 ? 's' : ''}
 </h3>
 <button
 type="button"
 className="ml-auto rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
 onClick={() => setShowCompress(false)}
 >
 <X className="h-4 w-4" />
 </button>
 </div>
 <div className="mt-4">
 <label className="block space-y-1">
 <span className="text-xs font-medium text-muted-foreground">Archive name</span>
 <input
 className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/20 dark:border-border dark:bg-surface-2"
 value={archiveName}
 onChange={(e) => setArchiveName(e.target.value)}
 placeholder="archive.tar.gz"
 autoFocus
 />
 </label>
 </div>
 <div className="mt-4 flex justify-end gap-2">
 <button type="button" className={tbtn} onClick={() => setShowCompress(false)}>
 Cancel
 </button>
 <button
 type="button"
 className={tbtnPrimary}
 onClick={handleCompress}
 disabled={!selectedEntries.length || compressMutation.isPending || writeDisabled}
 >
 {compressMutation.isPending ? (
 <Loader2 className="h-3.5 w-3.5 animate-spin" />
 ) : (
 <>
 <Archive className="h-3.5 w-3.5" />
 Create Archive
 </>
 )}
 </button>
 </div>
 </motion.div>
 </motion.div>
 </ModalPortal>
 )}
 </AnimatePresence>

 {/* Decompress modal */}
 <AnimatePresence>
 {showDecompress && selectedArchive && (
 <ModalPortal>
 <motion.div
 initial={{ opacity: 0 }}
 animate={{ opacity: 1 }}
 exit={{ opacity: 0 }}
 transition={{ duration: 0.2 }}
 className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
 >
 <div
 className="absolute inset-0 bg-surface-0/40 backdrop-blur-sm"
 onClick={() => setShowDecompress(false)}
 />
 <motion.div
 initial={{ opacity: 0, scale: 0.96, y: 8 }}
 animate={{ opacity: 1, scale: 1, y: 0 }}
 exit={{ opacity: 0, scale: 0.96, y: 8 }}
 transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
 className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card p-4 sm:p-5 shadow-elevated dark:border-border dark:bg-surface-1"
 >
 <div className="flex items-center gap-2">
 <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-warning/10">
 <ArchiveRestore className="h-4 w-4 text-warning" />
 </div>
 <h3 className="text-sm font-semibold text-foreground truncate mr-2">
 Extract Archive
 </h3>
 <button
 type="button"
 className="ml-auto rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
 onClick={() => setShowDecompress(false)}
 >
 <X className="h-4 w-4" />
 </button>
 </div>
 <p className="mt-1 text-xs text-muted-foreground truncate">{selectedArchive.name}</p>
 <div className="mt-4">
 <label className="block space-y-1">
 <span className="text-xs font-medium text-muted-foreground">Target path</span>
 <input
 className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/20 dark:border-border dark:bg-surface-2"
 value={decompressTarget}
 onChange={(e) => setDecompressTarget(e.target.value)}
 placeholder="/"
 autoFocus
 />
 </label>
 </div>
 <div className="mt-4 flex justify-end gap-2">
 <button type="button" className={tbtn} onClick={() => setShowDecompress(false)}>
 Cancel
 </button>
 <button
 type="button"
 className={tbtnPrimary}
 onClick={handleDecompress}
 disabled={decompressMutation.isPending || writeDisabled}
 >
 {decompressMutation.isPending ? (
 <Loader2 className="h-3.5 w-3.5 animate-spin" />
 ) : (
 <>
 <ArchiveRestore className="h-3.5 w-3.5" />
 Extract
 </>
 )}
 </button>
 </div>
 </motion.div>
 </motion.div>
 </ModalPortal>
 )}
 </AnimatePresence>
 </motion.div>
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
 <div className="flex flex-col items-center justify-center py-16 text-sm text-muted-foreground gap-2">
 <Folder className="h-8 w-8 text-muted-foreground/20" />
 Empty directory
 </div>
 );
 }

 return (
 <table className="w-full text-left text-sm">
 <thead>
 <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
 <th className="px-4 py-2.5">Name</th>
 <th className="px-4 py-2.5 text-right">Size</th>
 </tr>
 </thead>
 <tbody>
 {visible.map((item) => (
 <tr
 key={item.name}
 className="border-b border-border transition-colors hover:bg-surface-2 dark:border-border/40 dark:hover:bg-surface-2/40"
 onDoubleClick={() => item.isDirectory && onNavigate('/' + item.name)}
 >
 <td className="px-4 py-2">
 <button
 type="button"
 className="flex items-center gap-2.5 text-foreground transition-colors hover:text-foreground"
 onClick={() => item.isDirectory && onNavigate('/' + item.name)}
 disabled={!item.isDirectory}
 >
 <div className={`flex h-6 w-6 items-center justify-center rounded-md ${item.isDirectory ? 'bg-primary-500/10' : 'bg-surface-2 dark:bg-surface-3'}`}>
 {item.isDirectory ? (
 <Folder className="h-3.5 w-3.5 shrink-0 text-primary" />
 ) : (
 <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
 )}
 </div>
 <span className={item.isDirectory ? 'font-medium' : ''}>{item.displayName}</span>
 </button>
 </td>
 <td className="px-4 py-2 text-right text-xs tabular-nums text-muted-foreground">
 {item.isDirectory ? '—' : formatSize(item.size)}
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 );
}

export default FileManager;
