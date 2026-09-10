import { type DragEvent, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { describeError } from '../../utils/errors';
import FileList from './FileList';
import FileTree from './FileTree';
import FileUploader from './FileUploader';
import { useFileManager } from '../../hooks/useFileManager';
import { filesApi, DEFAULT_MAX_UPLOAD_MB } from '../../services/api/files';
import { adminApi } from '../../services/api/admin';
import type { FileEntry } from '../../types/file';
import { formatFileMode } from '../../utils/formatters';
import { formatNumber } from '@/i18n/format';
import { notifyError, notifyInfo, notifySuccess } from '../../utils/notify';
import { collectDroppedFiles, isFileDrag } from '../../utils/droppedFiles';
import { buildBreadcrumbs, getParentPath, joinPath, normalizePath } from '../../utils/filePaths';
import { useUploadStore } from '../../stores/uploadStore';
import { useDownloadStore } from '../../stores/downloadStore';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
 const { t } = useTranslation('server-tabs');
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
 const [isFileDropActive, setIsFileDropActive] = useState(false);
 const fileDropDepthRef = useRef(0);

 const writeDisabled = isSuspended || !canWrite;

 // Without preventDefault on dragover, the browser treats a file drop as a
 // navigation and the explorer never sees `drop`. Keep that from stealing
 // drops anywhere on the Files tab.
 useEffect(() => {
  const onDragOver = (event: globalThis.DragEvent) => {
   if (isFileDrag(event.dataTransfer)) event.preventDefault();
  };
  const onDrop = (event: globalThis.DragEvent) => {
   if (isFileDrag(event.dataTransfer)) event.preventDefault();
  };
  window.addEventListener('dragover', onDragOver);
  window.addEventListener('drop', onDrop);
  return () => {
   window.removeEventListener('dragover', onDragOver);
   window.removeEventListener('drop', onDrop);
  };
 }, []);

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
 notifySuccess(entry.isDirectory ? t('files.manager.folderCreated') : t('files.manager.fileCreated'));
 if (!entry.isDirectory) {
 openFile(entry);
 }
 },
 onError: (error: any) => {
 notifyError(error?.message || t('files.manager.createFailed'));
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
 notifySuccess(t('files.manager.fileSaved'));
 },
 onError: (error: any) => {
 notifyError(error?.message || t('files.manager.saveFailed'));
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
 notifySuccess(t('files.manager.deletedSelection'));
 },
 onError: (error: any) => {
 notifyError(error?.message || t('files.manager.deleteFailed'));
 },
 onSettled: () => {
 invalidateFiles();
 },
 });

 const resolveMaxUploadMb = useCallback(async () => {
 try {
 const controller = new AbortController();
 const timeout = setTimeout(() => controller.abort(), 5000);
 try {
 return await adminApi.getFileTunnelUploadLimit();
 } finally {
 clearTimeout(timeout);
 }
 } catch {
 return DEFAULT_MAX_UPLOAD_MB;
 }
 }, []);

 const assertUploadSize = useCallback(async (files: File[]) => {
 const maxUploadMb = await resolveMaxUploadMb();
 const maxBytes = maxUploadMb * 1024 * 1024;
 const oversized = files.filter((f) => f.size > maxBytes);
 if (oversized.length > 0) {
 const names = oversized.map((f) => f.name).join(', ');
 throw new Error(t('files.manager.uploadTooLarge', { max: maxUploadMb, names }));
 }
 }, [resolveMaxUploadMb]);

 const uploadMutation = useMutation({
 mutationFn: async ({
 files,
 onProgress,
 signal,
 targetPath,
 batches,
 }: {
 files: File[];
 onProgress?: (fileIndex: number, progress: number) => void;
 signal?: AbortSignal;
 targetPath?: string;
 batches?: Array<{ files: File[]; targetPath: string }>;
 }) => {
 const uploadStore = useUploadStore.getState();
 const abortController = new AbortController();
 const abortSignal = abortController.signal;
 if (signal) {
 if (signal.aborted) abortController.abort();
 else signal.addEventListener('abort', () => abortController.abort(), { once: true });
 }

 const runBatch = async (batchFiles: File[], destPath: string) => {
 await assertUploadSize(batchFiles);
 const sessionId = uploadStore.beginSession(
 batchFiles.map((file) => ({
 path: joinPath(destPath, file.name),
 name: file.name,
 total: file.size,
 })),
 );
 uploadStore.registerAbort(sessionId, abortController);
 try {
 await filesApi.upload(
 serverId,
 destPath,
 batchFiles,
 (fileIndex, pct, loaded, total) => {
 onProgress?.(fileIndex, pct);
 if (loaded === undefined) return;
 const file = batchFiles[fileIndex];
 if (!file) return;
 uploadStore.setFileProgress(sessionId, fileIndex, loaded, total);
 },
 abortSignal,
 );
 batchFiles.forEach((_, fileIndex) => uploadStore.setFileDone(sessionId, fileIndex));
 } catch (error: any) {
 const aborted = abortSignal.aborted || error?.message === 'Upload aborted';
 if (aborted) {
 uploadStore.markSessionCanceled(sessionId);
 } else {
 const message = error?.message || t('files.manager.uploadError');
 batchFiles.forEach((_, fileIndex) => uploadStore.setFileError(sessionId, fileIndex, message));
 }
 throw error;
 }
 };

 if (batches?.length) {
 for (const batch of batches) {
 await runBatch(batch.files, batch.targetPath);
 }
 return;
 }
 await runBatch(files, targetPath ?? path);
 },
 onSuccess: () => {
 setShowUpload(false);
 notifySuccess(t('files.manager.uploadComplete'));
 },
 onError: (error: any) => {
 if (error?.message === 'Upload aborted') {
 notifyInfo(t('files.manager.uploadCanceled'));
 return;
 }
 notifyError(error?.message || t('files.manager.uploadFailed'));
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
 notifySuccess(data?.archivePath ? t('files.manager.archiveCreatedAt', { path: data.archivePath }) : t('files.manager.archiveCreated'));
 },
 onError: (error: any) => {
 const bufErr = isBufferError(error);
 if (bufErr) return setBufferError(bufErr);
 notifyError(error?.message || t('files.manager.compressFailed'));
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
 notifySuccess(t('files.manager.archiveExtracted'));
 },
 onError: (error: any) => {
 const bufErr = isBufferError(error);
 if (bufErr) return setBufferError(bufErr);
 notifyError(error?.message || t('files.manager.extractFailed'));
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
 notifySuccess(t('files.manager.permissionsUpdated'));
 },
 onError: (error: any) => {
 notifyError(error?.message || t('files.manager.permissionsFailed'));
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
 notifySuccess(t('files.manager.renamed'));
 },
 onError: (error: any) => {
 notifyError(error?.message || t('files.manager.renameFailed'));
 },
 onSettled: () => {
 invalidateFiles();
 },
 });

 const resetFileDrop = useCallback(() => {
 fileDropDepthRef.current = 0;
 setIsFileDropActive(false);
 }, []);

 const handleExplorerDragEnter = useCallback(
 (event: DragEvent<HTMLDivElement>) => {
 if (writeDisabled || !isFileDrag(event.dataTransfer)) return;
 event.preventDefault();
 event.stopPropagation();
 fileDropDepthRef.current += 1;
 setIsFileDropActive(true);
 },
 [writeDisabled],
 );

 const handleExplorerDragOver = useCallback(
 (event: DragEvent<HTMLDivElement>) => {
 if (writeDisabled || !isFileDrag(event.dataTransfer)) return;
 event.preventDefault();
 event.stopPropagation();
 event.dataTransfer.dropEffect = 'copy';
 },
 [writeDisabled],
 );

 const handleExplorerDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
 event.preventDefault();
 event.stopPropagation();
 fileDropDepthRef.current = Math.max(0, fileDropDepthRef.current - 1);
 if (fileDropDepthRef.current === 0) setIsFileDropActive(false);
 }, []);

 const handleExplorerDrop = useCallback(
 async (event: DragEvent<HTMLDivElement>) => {
 event.preventDefault();
 event.stopPropagation();
 resetFileDrop();
 if (writeDisabled) {
 notifyError(isSuspended ? t('files.manager.serverSuspended') : t('files.manager.noPermission'));
 return;
 }
 if (!isFileDrag(event.dataTransfer)) return;
 try {
 const dropped = await collectDroppedFiles(event.dataTransfer);
 if (!dropped.length) {
 notifyError(t('files.manager.noDropFiles'));
 return;
 }
 const groups = new Map<string, File[]>();
 for (const item of dropped) {
 const target = item.relativeDir ? joinPath(path, item.relativeDir) : path;
 const list = groups.get(target) ?? [];
 list.push(item.file);
 groups.set(target, list);
 }
 const batches = [...groups.entries()].map(([targetPath, filesToUpload]) => ({
 files: filesToUpload,
 targetPath,
 }));
 await uploadMutation.mutateAsync({
 files: dropped.map((item) => item.file),
 batches,
 });
 } catch (error: unknown) {
 notifyError(error instanceof Error ? error.message : t('files.manager.uploadFailed'));
 }
 },
 [isSuspended, path, resetFileDrop, uploadMutation, writeDisabled],
 );

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
 message: describeError(error),
 stack: error instanceof Error ? error.stack : undefined,
 metadata: { context: 'read archive' },
 });
 const bufErr = isBufferError(error);
 if (bufErr) {
 setBufferError(bufErr);
 setArchiveBrowsePath(null);
 } else {
 notifyError(t('files.manager.readArchiveFailed'));
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
 const store = useDownloadStore.getState();
 const controller = new AbortController();
 const knownTotal = entry.size > 0 ? entry.size : undefined;
 const sessionId = store.beginSession([{ path: entry.path, name: entry.name, total: knownTotal }]);
 store.registerAbort(sessionId, controller);
 try {
 const blob = await filesApi.download(
 serverId,
 entry.path,
 (loaded, total) => {
 useDownloadStore.getState().setFileProgress(sessionId, 0, loaded, total ?? knownTotal);
 },
 controller.signal,
 );
 useDownloadStore.getState().setFileDone(sessionId, 0);
 const url = URL.createObjectURL(blob);
 const link = document.createElement('a');
 link.href = url;
 link.download = entry.name;
 document.body.appendChild(link);
 link.click();
 link.remove();
 URL.revokeObjectURL(url);
 notifySuccess(t('files.manager.downloadComplete'));
 } catch (error: any) {
 const aborted = controller.signal.aborted || error?.message === 'Download aborted';
 if (aborted) {
 useDownloadStore.getState().markSessionCanceled(sessionId);
 notifyInfo(t('files.manager.downloadCanceled'));
 } else {
 useDownloadStore.getState().setFileError(sessionId, 0, error?.message || t('files.manager.downloadFailed'));
 notifyError(error?.message || t('files.manager.downloadFailed'));
 }
 }
 };

 const handleCopyPath = (entry: FileEntry) => {
 navigator.clipboard.writeText(entry.path).then(
 () => notifyInfo(t('files.manager.pathCopied')),
 () => notifyError(t('files.manager.copyPathFailed')),
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
 notifyError(t('files.manager.selectForArchive'));
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
 setPermissionsError(t('files.manager.invalidMode'));
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
 notifyError(t('files.manager.serverSuspended'));
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
 {t('files.manager.folders')}
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
 {t('files.manager.directoryTree')}
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
 title={t('files.manager.root')}
 >
 <Home className="h-3.5 w-3.5" />
 <span className="hidden sm:inline">{t('files.manager.root')}</span>
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
 placeholder={t('files.manager.filterPlaceholder')}
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
 title={t('files.manager.goUp')}
 >
 <ArrowUp className="h-3.5 w-3.5" />
 <span className="hidden sm:inline">{t('files.manager.up')}</span>
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
 <span className="hidden sm:inline">{t('common:actions.upload')}</span>
 </button>
 <button
 type="button"
 className={tbtn}
 onClick={guardSuspended(() => setCreateMode('file'))}
 disabled={writeDisabled}
 >
 <FilePlus className="h-3.5 w-3.5" />
 <span className="hidden sm:inline">{t('files.manager.newFile')}</span>
 </button>
 <button
 type="button"
 className={tbtn}
 onClick={guardSuspended(() => setCreateMode('directory'))}
 disabled={writeDisabled}
 >
 <FolderPlus className="h-3.5 w-3.5" />
 <span className="hidden sm:inline">{t('files.manager.newFolder')}</span>
 </button>
 </>
 )}

 <div className="hidden sm:block h-4 w-px bg-border/60" />

 <button type="button" className={tbtnIcon} onClick={() => refetch()} title={t('common:actions.refresh')}>
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
 <span className="hidden sm:inline">{t('files.actions.compress')}</span>
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
 <span className="hidden sm:inline">{t('files.actions.extract')}</span>
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
 <span className="hidden sm:inline">{t('common:actions.delete')}</span>
 </button>
 )}
 <button
 type="button"
 className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
 onClick={() => setSelectedPaths(new Set())}
 title={t('files.manager.clearSelection')}
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
 {t('files.manager.deleteConfirm', { count: selectedEntries.length })}
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
 t('files.manager.confirmDelete')
 )}
 </button>
 <button type="button" className={tbtn} onClick={() => setConfirmDelete(false)}>
 {t('common:actions.cancel')}
 </button>
 </div>
 </motion.div>
 )}
 </AnimatePresence>

 {/* File list — drop target for explorer uploads (no Upload modal required) */}
 <div
 className={`relative rounded-xl border bg-card dark:bg-surface-1 h-[calc(100vh-280px)] min-h-[200px] overflow-hidden transition-colors ${
 isFileDropActive
 ? 'border-primary ring-2 ring-primary/30'
 : 'border-border dark:border-border'
 }`}
 onDragEnter={handleExplorerDragEnter}
 onDragOver={handleExplorerDragOver}
 onDragLeave={handleExplorerDragLeave}
 onDrop={handleExplorerDrop}
 >
 {isFileDropActive && canWrite && !isSuspended && (
 <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-primary/10 backdrop-blur-[1px]">
 <Upload className="h-8 w-8 text-primary" />
 <p className="text-sm font-semibold text-primary">{t('files.manager.dropToUpload')}</p>
 <p className="font-mono text-[11px] text-muted-foreground">{path}</p>
 </div>
 )}
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
 notifyError(t('files.manager.noPermission'));
 return;
 }
 if (isSuspended) {
 notifyError(t('files.manager.serverSuspended'));
 return;
 }
 setRenamingEntry(entry);
 }}
 onRenameSubmit={handleRename}
 onRenameCancel={() => setRenamingEntry(null)}
 onDelete={(entry) => {
 if (!canWrite) {
 notifyError(t('files.manager.noPermission'));
 return;
 }
 if (isSuspended) {
 notifyError(t('files.manager.serverSuspended'));
 return;
 }
 setSelectedPaths(new Set([entry.path]));
 setConfirmDelete(true);
 }}
 onCompress={(entry) => {
 if (!canWrite) {
 notifyError(t('files.manager.noPermission'));
 return;
 }
 if (isSuspended) {
 notifyError(t('files.manager.serverSuspended'));
 return;
 }
 handleBulkCompressFromEntry(entry);
 }}
 onDecompress={(entry) => {
 if (!canWrite) {
 notifyError(t('files.manager.noPermission'));
 return;
 }
 if (isSuspended) {
 notifyError(t('files.manager.serverSuspended'));
 return;
 }
 handleBulkDecompressFromEntry(entry);
 }}
 onPermissions={(entry) => {
 if (!canWrite) {
 notifyError(t('files.manager.noPermission'));
 return;
 }
 if (isSuspended) {
 notifyError(t('files.manager.serverSuspended'));
 return;
 }
 handlePermissionsOpen(entry);
 }}
 />
 </div>
 </motion.div>

 {/* File editor overlay */}
 <Dialog
 open={!!activeFile}
 onOpenChange={(open) => {
 if (!open) closeActiveFile();
 }}
 >
 <DialogContent
 size="full"
 showClose={false}
 className="h-[92dvh]"
 onOpenAutoFocus={(event) => event.preventDefault()}
 >
 <DialogTitle className="sr-only">{t('files.manager.editFile')}</DialogTitle>
 <DialogDescription className="sr-only">
 {activeFile ? activeFile.path : t('files.manager.fileEditor')}
 </DialogDescription>
 <DialogBody className="flex min-h-0 flex-1 flex-col overflow-hidden p-2 sm:p-4">
 {activeFile && (
 <FileEditor
 file={activeFile}
 isLoading={isFileLoading}
 isSaving={saveMutation.isPending}
 isDirty={isDirty}
 onChange={updateActiveContent}
 onSave={() => {
 if (!canWrite) {
 notifyError(t('files.manager.noPermission'));
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
 )}
 </DialogBody>
 </DialogContent>
 </Dialog>

 {/* Permissions modal */}
 <Dialog
 open={!!permissionsEntry}
 onOpenChange={(open) => {
 if (!open) setPermissionsEntry(null);
 }}
 >
 <DialogContent size="sm">
 <form onSubmit={handlePermissionsSubmit} className="flex min-h-0 flex-1 flex-col">
 <DialogHeader
 icon={<Shield className="h-4 w-4" />}
 iconClassName="border-success/20 bg-success/10 text-success"
 >
 <DialogTitle>{t('files.manager.editPermissions')}</DialogTitle>
 <DialogDescription className="truncate">
 {permissionsEntry?.path ?? t('files.manager.permissionsDescription')}
 </DialogDescription>
 </DialogHeader>
 <DialogBody className="space-y-3">
 <div className="space-y-1.5">
 <Label htmlFor="file-permissions-mode">{t('files.manager.modeOctal')}</Label>
 <Input
 id="file-permissions-mode"
 className="font-mono"
 value={permissionsValue}
 onChange={(e) => {
 setPermissionsValue(e.target.value);
 setPermissionsError(null);
 }}
 placeholder={permissionsEntry?.isDirectory ? '755' : '644'}
 autoFocus
 />
 <p className="text-[11px] text-muted-foreground/70">
 {t('files.manager.modeHint.prefix')}
 <span className="font-mono text-foreground/80">644</span>
 {t('files.manager.modeHint.forFiles')}
 <span className="font-mono text-foreground/80">755</span>
 {t('files.manager.modeHint.forFolders')}
 </p>
 </div>
 {permissionsError && (
 <div className="rounded-lg border border-danger/20 bg-danger-muted px-3 py-2 text-xs text-danger dark:border-danger/15 dark:bg-danger-muted/30">
 {permissionsError}
 </div>
 )}
 </DialogBody>
 <DialogFooter>
 <Button type="button" variant="outline" onClick={() => setPermissionsEntry(null)}>
 {t('common:actions.cancel')}
 </Button>
 <Button type="submit" disabled={permissionsMutation.isPending || writeDisabled}>
 {permissionsMutation.isPending ? (
 <Loader2 className="h-3.5 w-3.5 animate-spin" />
 ) : (
 t('files.manager.updatePermissions')
 )}
 </Button>
 </DialogFooter>
 </form>
 </DialogContent>
 </Dialog>

 {/* Archive browser modal */}
 <Dialog
 open={!!archiveBrowsePath}
 onOpenChange={(open) => {
 if (!open) setArchiveBrowsePath(null);
 }}
 >
 <DialogContent size="xl" className="h-[min(80dvh,40rem)]">
 <DialogHeader
 icon={<Archive className="h-4 w-4" />}
 iconClassName="border-warning/30 bg-warning/10 text-warning"
 >
 <DialogTitle className="truncate">
 {archiveBrowsePath?.split('/').pop() || t('files.manager.archive')}
 </DialogTitle>
 <DialogDescription>{t('files.manager.readOnlyPreview')}</DialogDescription>
 </DialogHeader>
 <DialogToolbar>
 <div className="flex items-center gap-1 overflow-x-auto text-xs scrollbar-hide">
 <button
 type="button"
 className="shrink-0 rounded-md px-1.5 py-0.5 font-medium text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
 onClick={() => setArchiveBrowseDir('/')}
 >
 <Home className="inline h-3 w-3" />
 </button>
 {archiveBrowseDir !== '/' &&
 archiveBrowseDir.split('/').filter(Boolean).map((seg, i, arr) => {
 const segPath = '/' + arr.slice(0, i + 1).join('/');
 return (
 <span key={segPath} className="flex shrink-0 items-center gap-1">
 <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
 <button
 type="button"
 className="whitespace-nowrap rounded-md px-1.5 py-0.5 font-medium text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
 onClick={() => setArchiveBrowseDir(segPath)}
 >
 {seg}
 </button>
 </span>
 );
 })}
 </div>
 </DialogToolbar>
 <DialogBody className="p-0">
 {archiveLoading ? (
 <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
 <Loader2 className="h-6 w-6 animate-spin text-primary" />
 {t('files.manager.readingArchive')}
 </div>
 ) : (
 <ArchiveListing
 entries={archiveEntries}
 currentDir={archiveBrowseDir}
 onNavigate={setArchiveBrowseDir}
 />
 )}
 </DialogBody>
 <DialogFooter className="sm:justify-between">
 <span className="text-[11px] text-muted-foreground">
 {t('files.manager.entriesTotal', { count: archiveEntries.length })}
 </span>
 <Button type="button" variant="outline" onClick={() => setArchiveBrowsePath(null)}>
 {t('common:actions.close')}
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>

 {/* Buffer error modal */}
 <Dialog
 open={!!bufferError}
 onOpenChange={(open) => {
 if (!open) setBufferError(null);
 }}
 >
 <DialogContent size="sm">
 <DialogHeader
 icon={<AlertTriangle className="h-4 w-4" />}
 iconClassName="border-warning/20 bg-warning/10 text-warning"
 >
 <DialogTitle>{t('files.manager.bufferLimitTitle')}</DialogTitle>
 <DialogDescription>
 {t('files.manager.bufferLimitDescription')}
 </DialogDescription>
 </DialogHeader>
 <DialogBody className="space-y-3">
 <div className="rounded-lg border border-border bg-surface-2 p-3 dark:border-border dark:bg-surface-2">
 <div className="flex justify-between text-sm">
 <span className="text-muted-foreground">{t('files.manager.currentLimit')}</span>
 <span className="font-medium text-foreground">
 {formatNumber(bufferError?.currentMaxBufferMb ?? 0)} MB
 </span>
 </div>
 <div className="mt-1 flex justify-between text-sm">
 <span className="text-muted-foreground">{t('files.manager.recommended')}</span>
 <span className="font-medium text-primary">
 {formatNumber(bufferError?.recommendedMaxBufferMb ?? 0)} MB
 </span>
 </div>
 </div>
 <p className="text-xs leading-relaxed text-muted-foreground">
 {t('files.manager.bufferAdminHint.prefix')}<span className="font-medium text-foreground">{t('files.manager.bufferAdminHint.maxBufferSetting')}</span>{t('files.manager.bufferAdminHint.middle')}<span className="font-medium text-foreground">{t('files.manager.bufferAdminHint.adminSecurity')}</span>{t('files.manager.bufferAdminHint.suffix')}
 </p>
 </DialogBody>
 <DialogFooter>
 <Button type="button" onClick={() => setBufferError(null)}>
 {t('files.manager.gotIt')}
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>

 {/* Upload modal */}
 <Dialog open={showUpload} onOpenChange={setShowUpload}>
 <DialogContent size="md">
 <DialogHeader icon={<Upload className="h-4 w-4" />}>
 <DialogTitle>{t('files.manager.uploadFiles')}</DialogTitle>
 <DialogDescription>
 {t('files.uploader.target')} <span className="font-mono">{path}</span>
 </DialogDescription>
 </DialogHeader>
 <DialogBody>
 <FileUploader
 path={path}
 isUploading={uploadMutation.isPending}
 onUpload={(filesToUpload, onProgress, signal) =>
 uploadMutation.mutate({ files: filesToUpload, onProgress, signal })
 }
 onClose={() => setShowUpload(false)}
 inModal
 />
 </DialogBody>
 <DialogFooter>
 <Button type="button" variant="outline" onClick={() => setShowUpload(false)}>
 {t('common:actions.close')}
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>

 {/* Create file/folder modal */}
 <Dialog
 open={!!createMode}
 onOpenChange={(open) => {
 if (!open) setCreateMode(null);
 }}
 >
 <DialogContent size={createMode === 'file' ? 'md' : 'sm'}>
 <form onSubmit={handleCreateSubmit} className="flex min-h-0 flex-1 flex-col">
 <DialogHeader
 icon={
 createMode === 'directory' ? (
 <FolderPlus className="h-4 w-4" />
 ) : (
 <FilePlus className="h-4 w-4" />
 )
 }
 >
 <DialogTitle>
 {createMode === 'directory' ? t('files.manager.createFolder') : t('files.manager.createFile')}
 </DialogTitle>
 <DialogDescription>
 {createMode === 'directory'
 ? t('files.manager.createFolderDescription')
 : t('files.manager.createFileDescription')}
 </DialogDescription>
 </DialogHeader>
 <DialogBody className="space-y-3">
 <div className="space-y-1.5">
 <Label htmlFor="create-entry-name">{t('files.manager.name')}</Label>
 <Input
 id="create-entry-name"
 value={createName}
 onChange={(e) => setCreateName(e.target.value)}
 placeholder={createMode === 'directory' ? 'configs' : 'server.properties'}
 autoFocus
 />
 </div>
 {createMode === 'file' && (
 <div className="space-y-1.5">
 <Label htmlFor="create-file-content">{t('files.manager.initialContent')}</Label>
 <Textarea
 id="create-file-content"
 className="h-24 font-mono"
 value={createContent}
 onChange={(e) => setCreateContent(e.target.value)}
 placeholder="# New file"
 />
 </div>
 )}
 </DialogBody>
 <DialogFooter>
 <Button type="button" variant="outline" onClick={() => setCreateMode(null)}>
 {t('common:actions.cancel')}
 </Button>
 <Button
 type="submit"
 disabled={!createName.trim() || createMutation.isPending || writeDisabled}
 >
 {createMutation.isPending ? (
 <Loader2 className="h-3.5 w-3.5 animate-spin" />
 ) : createMode === 'directory' ? (
 t('files.manager.createFolder')
 ) : (
 t('files.manager.createFile')
 )}
 </Button>
 </DialogFooter>
 </form>
 </DialogContent>
 </Dialog>

 {/* Compress modal */}
 <Dialog open={showCompress} onOpenChange={setShowCompress}>
 <DialogContent size="sm">
 <DialogHeader
 icon={<Archive className="h-4 w-4" />}
 iconClassName="border-warning/20 bg-warning/10 text-warning"
 >
 <DialogTitle>
 {t('files.manager.compressTitle', { count: selectedEntries.length })}
 </DialogTitle>
 <DialogDescription>{t('files.manager.compressDescription')}</DialogDescription>
 </DialogHeader>
 <DialogBody>
 <div className="space-y-1.5">
 <Label htmlFor="compress-archive-name">{t('files.manager.archiveName')}</Label>
 <Input
 id="compress-archive-name"
 value={archiveName}
 onChange={(e) => setArchiveName(e.target.value)}
 placeholder="archive.tar.gz"
 autoFocus
 />
 </div>
 </DialogBody>
 <DialogFooter>
 <Button type="button" variant="outline" onClick={() => setShowCompress(false)}>
 {t('common:actions.cancel')}
 </Button>
 <Button
 type="button"
 onClick={handleCompress}
 disabled={!selectedEntries.length || compressMutation.isPending || writeDisabled}
 >
 {compressMutation.isPending ? (
 <Loader2 className="h-3.5 w-3.5 animate-spin" />
 ) : (
 <>
 <Archive className="h-3.5 w-3.5" />
 {t('files.manager.createArchive')}
 </>
 )}
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>

 {/* Decompress modal */}
 <Dialog
 open={showDecompress && !!selectedArchive}
 onOpenChange={setShowDecompress}
 >
 <DialogContent size="sm">
 <DialogHeader
 icon={<ArchiveRestore className="h-4 w-4" />}
 iconClassName="border-warning/20 bg-warning/10 text-warning"
 >
 <DialogTitle>{t('files.manager.extractArchive')}</DialogTitle>
 <DialogDescription className="truncate">
 {selectedArchive?.name ?? t('files.manager.extractDescription')}
 </DialogDescription>
 </DialogHeader>
 <DialogBody>
 <div className="space-y-1.5">
 <Label htmlFor="decompress-target-path">{t('files.manager.targetPath')}</Label>
 <Input
 id="decompress-target-path"
 value={decompressTarget}
 onChange={(e) => setDecompressTarget(e.target.value)}
 placeholder="/"
 autoFocus
 />
 </div>
 </DialogBody>
 <DialogFooter>
 <Button type="button" variant="outline" onClick={() => setShowDecompress(false)}>
 {t('common:actions.cancel')}
 </Button>
 <Button
 type="button"
 onClick={handleDecompress}
 disabled={decompressMutation.isPending || writeDisabled}
 >
 {decompressMutation.isPending ? (
 <Loader2 className="h-3.5 w-3.5 animate-spin" />
 ) : (
 <>
 <ArchiveRestore className="h-3.5 w-3.5" />
 {t('files.manager.extractArchive')}
 </>
 )}
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>
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
 const { t } = useTranslation('server-tabs');
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
 {t('files.manager.emptyDirectory')}
 </div>
 );
 }

 return (
 <table className="w-full text-left text-sm">
 <thead>
 <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
 <th className="px-4 py-2.5">{t('files.list.name')}</th>
 <th className="px-4 py-2.5 text-right">{t('files.list.size')}</th>
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
