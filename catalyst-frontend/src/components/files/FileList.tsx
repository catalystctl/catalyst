// ponytail: responsive FileList card layout + bottom nav deferred to a dedicated mobile pass
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFileListVirtualizer } from '../../hooks/useFileListVirtualizer';
import { ArrowDown, ArrowUp, Folder, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { FileEntry } from '../../types/file';
import { formatBytes, formatFileMode } from '../../utils/formatters';
import { formatDate, formatDateTime } from '@/i18n/format';
import FileContextMenu from './FileContextMenu';
import { FileTypeIcon } from './FileTypeIcon';
import { getFileTypeInfo } from './fileTypes';

type SortField = 'name' | 'size' | 'modified' | 'mode';
type SortDirection = 'asc' | 'desc';

type Props = {
 files: FileEntry[];
 selectedPaths: Set<string>;
 isLoading: boolean;
 isError: boolean;
 allSelected: boolean;
 sortField: SortField;
 sortDirection: SortDirection;
 renamingEntry: FileEntry | null;
 onSort: (field: SortField) => void;
 onSelectAll: () => void;
 onOpen: (entry: FileEntry) => void;
 onSelect: (entry: FileEntry, selected: boolean) => void;
 onShiftSelect: (entry: FileEntry) => void;
 onDownload: (entry: FileEntry) => void;
 onCopyPath: (entry: FileEntry) => void;
 onRename: (entry: FileEntry) => void;
 onRenameSubmit: (entry: FileEntry, newName: string) => void;
 onRenameCancel: () => void;
 onDelete: (entry: FileEntry) => void;
 onCompress: (entry: FileEntry) => void;
 onDecompress: (entry: FileEntry) => void;
 onPermissions: (entry: FileEntry) => void;
};

const isArchive = (name: string) =>
 name.endsWith('.tar.gz') || name.endsWith('.tgz') || name.endsWith('.zip');

const ROW_HEIGHT = 44;

/**
 * One grid template shared by the column header and every row, so columns line
 * up exactly at each breakpoint. Hidden cells drop out of grid placement, which
 * is why the visible order matches each template.
 *   base : select · name · actions
 *   sm   : select · name · mode · actions
 *   md   : select · name · mode · size · actions
 *   lg   : select · name · mode · size · modified · actions
 */
const GRID =
 'grid grid-cols-[1.75rem_minmax(0,1fr)_2.25rem] items-center gap-x-2 ' +
 'sm:grid-cols-[1.75rem_minmax(0,1fr)_4.5rem_2.25rem] ' +
 'md:grid-cols-[1.75rem_minmax(0,1fr)_4.5rem_5.5rem_2.25rem] ' +
 'lg:grid-cols-[1.75rem_minmax(0,1fr)_4.5rem_5.5rem_10rem_2.25rem]';

function SortIndicator({
 field,
 active,
 direction,
}: {
 field: SortField;
 active: SortField;
 direction: SortDirection;
}) {
 if (field !== active) return null;
 return direction === 'asc' ? (
 <ArrowUp className="ml-1 inline h-3 w-3" />
 ) : (
 <ArrowDown className="ml-1 inline h-3 w-3" />
 );
}

function InlineRenameInput({
 entry,
 onSubmit,
 onCancel,
}: {
 entry: FileEntry;
 onSubmit: (entry: FileEntry, newName: string) => void;
 onCancel: () => void;
}) {
 const [value, setValue] = useState(entry.name);
 const inputRef = useRef<HTMLInputElement>(null);

 useEffect(() => {
 inputRef.current?.focus();
 if (!entry.isDirectory) {
 const dotIdx = entry.name.lastIndexOf('.');
 if (dotIdx > 0) {
 inputRef.current?.setSelectionRange(0, dotIdx);
 } else {
 inputRef.current?.select();
 }
 } else {
 inputRef.current?.select();
 }
 }, [entry]);

 return (
 <input
 ref={inputRef}
 className="w-full max-w-xs rounded-sm border border-primary bg-background/60 px-2 py-0.5 font-mono text-mini text-foreground outline-none"
 value={value}
 onChange={(e) => setValue(e.target.value)}
 onBlur={() => onSubmit(entry, value)}
 onKeyDown={(e) => {
 if (e.key === 'Enter') onSubmit(entry, value);
 if (e.key === 'Escape') onCancel();
 }}
 onClick={(e) => e.stopPropagation()}
 />
 );
}

function FileList({
 files,
 selectedPaths,
 isLoading,
 isError,
 allSelected,
 sortField,
 sortDirection,
 renamingEntry,
 onSort,
 onSelectAll,
 onOpen,
 onSelect,
 onShiftSelect,
 onDownload,
 onCopyPath,
 onRename,
 onRenameSubmit,
 onRenameCancel,
 onDelete,
 onCompress,
 onDecompress,
 onPermissions,
}: Props) {
 const { t } = useTranslation('server-tabs');
 const parentRef = useRef<HTMLDivElement>(null);
 const [contextMenuEntry, setContextMenuEntry] = useState<FileEntry | null>(null);
 const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);

 // Calculate total size for the footer
 const totalSize = useMemo(() => {
 return files.reduce((sum, f) => sum + (f.isDirectory ? 0 : f.size), 0);
 }, [files]);

 const rowData = useMemo(() => {
 return files.map((entry) => ({
 entry,
 selected: selectedPaths.has(entry.path),
 isRenaming: renamingEntry?.path === entry.path,
 info: entry.isDirectory ? null : getFileTypeInfo(entry.name),
 }));
 }, [files, selectedPaths, renamingEntry]);

 const { virtualItems } = useFileListVirtualizer(files.length, parentRef);

 const closeContextMenu = useCallback(() => {
 setContextMenuPosition(null);
 setContextMenuEntry(null);
 }, []);

 useEffect(() => {
 if (!contextMenuPosition) return undefined;

 const handleKeyDown = (e: KeyboardEvent) => {
 if (e.key === 'Escape') closeContextMenu();
 };

 const handleMouseDown = (e: MouseEvent) => {
 const target = e.target as HTMLElement;
 // Don't close if clicking inside the context menu itself
 if (target.closest('[data-file-context-menu="true"]')) return;
 closeContextMenu();
 };

 window.addEventListener('keydown', handleKeyDown);
 document.addEventListener('mousedown', handleMouseDown);
 return () => {
 window.removeEventListener('keydown', handleKeyDown);
 document.removeEventListener('mousedown', handleMouseDown);
 };
 }, [contextMenuPosition, closeContextMenu]);

 // Loading/empty/error stay in the frame the caller supplies — no blank bands.
 if (isLoading) {
 return (
 <div className="flex flex-col">
 {Array.from({ length: 8 }).map((_, index) => (
 <div
 key={index}
 className={`${GRID} px-3 py-2 ${index > 0 ? 'border-t border-border/40' : ''}`}
 >
 <div className="h-3.5 w-3.5 animate-pulse rounded-sm bg-surface-3" />
 <div className="flex items-center gap-2">
 <div className="h-3.5 w-3.5 animate-pulse rounded-sm bg-surface-3" />
 <div className="h-3 w-40 animate-pulse rounded-sm bg-surface-3" />
 </div>
 </div>
 ))}
 <p className="border-t border-border/40 px-3 py-1.5 text-micro text-muted-foreground">
 {t('files.list.scanning')}
 </p>
 </div>
 );
 }

 if (isError) {
 return (
 <div className="flex h-full flex-col items-center justify-center gap-1 px-4 py-10 text-center">
 <Folder className="h-5 w-5 text-danger" />
 <p className="text-mini font-medium text-danger">{t('files.list.loadFailed')}</p>
 <p className="text-micro text-muted-foreground">{t('files.list.loadFailedHint')}</p>
 </div>
 );
 }

 if (!files.length) {
 return (
 <div className="flex h-full flex-col items-center justify-center gap-1 px-4 py-10 text-center">
 <p className="type-overline">{t('files.list.emptyTitle')}</p>
 <p className="type-meta max-w-md">{t('files.list.emptyDescription')}</p>
 </div>
 );
 }

 const thBase =
 'inline-flex h-7 cursor-pointer select-none items-center text-left type-overline transition-colors hover:text-foreground';

 const totalHeight = files.length * ROW_HEIGHT;

 const selectBox = (selected: boolean, extra = '') =>
 `flex h-4 w-4 items-center justify-center rounded-sm border transition-colors ${extra} ${
 selected
 ? 'border-primary bg-primary text-primary-foreground'
 : 'border-border/60 bg-card'
 }`;

 return (
 <div className="flex flex-col h-full">
 {/* Column header — same grid template as the rows */}
 <div className={`${GRID} flex-none border-b border-border/50 bg-surface-1 px-3 py-1.5 text-muted-foreground/70`}>
 <div className="flex items-center">
 <button
 type="button"
 onClick={onSelectAll}
 className="flex h-7 w-7 items-center justify-center"
 >
 <span className={selectBox(allSelected, selectedPaths.size > 0 && !allSelected ? 'border-primary' : '')}>
 {allSelected && <Check className="h-3 w-3" />}
 </span>
 </button>
 </div>
 <button type="button" className={thBase} onClick={() => onSort('name')}>
 {t('files.list.name')} <SortIndicator field="name" active={sortField} direction={sortDirection} />
 </button>
 <button type="button" className={`${thBase} hidden sm:block`} onClick={() => onSort('mode')}>
 {t('files.list.mode')} <SortIndicator field="mode" active={sortField} direction={sortDirection} />
 </button>
 <button type="button" className={`${thBase} hidden md:block`} onClick={() => onSort('size')}>
 {t('files.list.size')} <SortIndicator field="size" active={sortField} direction={sortDirection} />
 </button>
 <button type="button" className={`${thBase} hidden lg:block`} onClick={() => onSort('modified')}>
 {t('files.list.modified')} <SortIndicator field="modified" active={sortField} direction={sortDirection} />
 </button>
 <span className="sr-only">{t('files.contextMenu.fileActions')}</span>
 </div>

 {/* Virtual scroll container */}
 <div ref={parentRef} className="flex-1 overflow-auto" style={{ contain: 'strict' }}>
 <div style={{ height: totalHeight, position: 'relative' }}>
 <AnimatePresence initial={false}>
 {virtualItems.map((virtualRow) => {
 const { entry, selected, isRenaming, info } = rowData[virtualRow.index];
 return (
 <motion.div
 key={entry.path}
 data-index={virtualRow.index}
 initial={{ opacity: 0 }}
 animate={{ opacity: 1 }}
 transition={{ duration: 0.12 }}
 className={`${GRID} absolute left-0 right-0 group px-3 py-1.5 transition-colors ${
 virtualRow.index > 0 ? 'border-t border-border/40' : ''
 } ${
 selected
 ? 'bg-primary/25 shadow-[inset_2px_0_0_hsl(var(--primary))] hover:bg-primary/30'
 : 'hover:bg-surface-3/80'
 }`}
 style={{
 height: ROW_HEIGHT,
 transform: `translateY(${virtualRow.start}px)`,
 }}
 onContextMenu={(e) => {
 e.preventDefault();
 setContextMenuEntry(entry);
 setContextMenuPosition({ x: e.clientX, y: e.clientY });
 }}
 onDoubleClick={() => {
 if (!isRenaming) onOpen(entry);
 }}
 >
 {/* Selection checkbox */}
 <div className="flex items-center">
 <button
 type="button"
 onClick={(e) => {
 e.stopPropagation();
 if (e.shiftKey) {
 onShiftSelect(entry);
 } else {
 onSelect(entry, !selected);
 }
 }}
 aria-label={entry.name}
 className="flex h-7 w-7 items-center justify-center"
 >
 <span className={selectBox(selected, 'group-hover:border-primary/50')}>
 {selected && <Check className="h-3 w-3" />}
 </span>
 </button>
 </div>

 {/* Name */}
 <button
 type="button"
 className="flex min-w-0 items-center gap-2 py-1.5 text-left min-h-7"
 onClick={(e) => {
 e.stopPropagation();
 onOpen(entry);
 }}
 >
 {entry.isDirectory ? (
 <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
 ) : (
 <FileTypeIcon name={entry.name} className="h-4 w-4" />
 )}
 {isRenaming ? (
 <InlineRenameInput
 entry={entry}
 onSubmit={onRenameSubmit}
 onCancel={onRenameCancel}
 />
 ) : (
 <span className="flex min-w-0 items-baseline gap-2">
 <span className="truncate text-data text-foreground">{entry.name}</span>
 {info && (
 <span className="hidden shrink-0 text-micro text-muted-foreground/70 xl:inline">
 {info.label}
 </span>
 )}
 </span>
 )}
 </button>

 {/* Mode */}
 <span className="hidden font-mono text-micro tabular-nums text-muted-foreground sm:block">
 {formatFileMode(entry.mode)}
 </span>

 {/* Size */}
 <span className="hidden font-mono text-micro tabular-nums text-muted-foreground md:block">
 {entry.isDirectory ? '—' : formatBytes(entry.size)}
 </span>

 {/* Modified */}
 <span
 className="hidden truncate font-mono text-micro tabular-nums text-muted-foreground lg:block"
 title={entry.modified ? formatDateTime(entry.modified) : undefined}
 >
 {entry.modified ? (
 <>
 {formatDate(entry.modified)}{' '}
 <span className="text-muted-foreground/60">
 {formatDateTime(entry.modified, { hour: '2-digit', minute: '2-digit' })}
 </span>
 </>
 ) : (
 '—'
 )}
 </span>

 {/* Actions */}
 <div className="flex justify-end opacity-100 transition-opacity duration-150 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 sm:focus-within:opacity-100 has-[button[data-state=open]]:opacity-100">
 <FileContextMenu
 entry={entry}
 onOpen={() => onOpen(entry)}
 onDownload={!entry.isDirectory ? () => onDownload(entry) : undefined}
 onCopyPath={() => onCopyPath(entry)}
 onRename={() => onRename(entry)}
 onCompress={() => onCompress(entry)}
 onDecompress={
 !entry.isDirectory && isArchive(entry.name)
 ? () => onDecompress(entry)
 : undefined
 }
 onPermissions={() => onPermissions(entry)}
 onDelete={() => onDelete(entry)}
 />
 </div>
 </motion.div>
 );
 })}
 </AnimatePresence>
 </div>
 </div>

 {/* Footer */}
 <div className="flex flex-none items-center justify-between gap-2 border-t border-border/50 bg-surface-1/40 px-3 py-1.5">
 <span className="text-micro text-muted-foreground">
 {t('files.list.itemCount', { count: files.length })}
 {totalSize > 0 && (
 <span className="ml-2 font-mono tabular-nums text-muted-foreground/70">
 {t('files.list.totalSize', { size: formatBytes(totalSize) })}
 </span>
 )}
 </span>
 {selectedPaths.size > 0 && (
 <span className="text-micro font-medium text-foreground">
 {t('files.list.selected', { count: selectedPaths.size })}
 </span>
 )}
 </div>

 {/* Context menu */}
 {contextMenuEntry && contextMenuPosition && (
 <FileContextMenu
 entry={contextMenuEntry}
 onOpen={() => onOpen(contextMenuEntry)}
 onDownload={
 !contextMenuEntry.isDirectory ? () => onDownload(contextMenuEntry) : undefined
 }
 onCopyPath={() => onCopyPath(contextMenuEntry)}
 onRename={() => onRename(contextMenuEntry)}
 onCompress={() => onCompress(contextMenuEntry)}
 onDecompress={
 !contextMenuEntry.isDirectory && isArchive(contextMenuEntry.name)
 ? () => onDecompress(contextMenuEntry)
 : undefined
 }
 onPermissions={() => onPermissions(contextMenuEntry)}
 onDelete={() => onDelete(contextMenuEntry)}
 contextPosition={contextMenuPosition}
 onRequestClose={closeContextMenu}
 />
 )}
 </div>
 );
}

export default FileList;
