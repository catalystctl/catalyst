import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, Folder, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { FileEntry } from '../../types/file';
import { formatBytes, formatFileMode } from '../../utils/formatters';
import EmptyState from '../shared/EmptyState';
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
const HEADER_HEIGHT = 40;

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
    <ArrowUp className="inline h-3 w-3 ml-0.5" />
  ) : (
    <ArrowDown className="inline h-3 w-3 ml-0.5" />
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
      className="w-full max-w-xs rounded-md border border-primary bg-card px-2 py-0.5 text-sm text-foreground outline-none shadow-sm dark:bg-surface-2 dark:text-foreground"
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

  const virtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  const virtualItems = virtualizer.getVirtualItems();

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

  if (isLoading) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">Scanning directory…</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-2 px-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-danger-muted">
          <Folder className="h-6 w-6 text-danger" />
        </div>
        <p className="text-sm font-medium text-destructive">Unable to load file listing</p>
        <p className="text-xs text-muted-foreground">Check server connectivity and try again</p>
      </div>
    );
  }

  if (!files.length) {
    return (
      <EmptyState
        title="This folder is empty"
        description="Upload files or create a new folder to get started."
      />
    );
  }

  const thBase =
    'cursor-pointer select-none px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground';

  const totalHeight = files.length * ROW_HEIGHT;

  return (
    <div className="flex flex-col h-full">
      {/* Fixed header */}
      <div className="flex-none border-b border-border bg-surface-1/80 backdrop-blur-sm dark:bg-surface-0/80">
        <div className="flex items-center" style={{ height: HEADER_HEIGHT }}>
          <div className="w-10 px-3 flex items-center">
            <button
              type="button"
              onClick={onSelectAll}
              className={`flex h-4 w-4 items-center justify-center rounded border transition-colors ${
                allSelected
                  ? 'border-primary bg-primary text-primary-foreground'
                  : selectedPaths.size > 0
                  ? 'border-primary bg-primary/30'
                  : 'border-border bg-card dark:border-border dark:bg-surface-2'
              }`}
            >
              {allSelected && <Check className="h-3 w-3" />}
            </button>
          </div>
          <div className={`${thBase} flex-1 min-w-0`} onClick={() => onSort('name')}>
            Name <SortIndicator field="name" active={sortField} direction={sortDirection} />
          </div>
          <div className={`${thBase} hidden sm:block w-20`} onClick={() => onSort('mode')}>
            Mode <SortIndicator field="mode" active={sortField} direction={sortDirection} />
          </div>
          <div className={`${thBase} hidden md:block w-24`} onClick={() => onSort('size')}>
            Size <SortIndicator field="size" active={sortField} direction={sortDirection} />
          </div>
          <div className={`${thBase} hidden lg:block w-40`} onClick={() => onSort('modified')}>
            Modified <SortIndicator field="modified" active={sortField} direction={sortDirection} />
          </div>
          <div className="w-10 px-3" />
        </div>
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
                  transition={{ duration: 0.15, delay: Math.min(virtualRow.index * 0.005, 0.2) }}
                  className={`absolute left-0 right-0 flex items-center group transition-colors ${
                    selected
                      ? 'bg-primary-500/5 dark:bg-primary-500/10 border-l-2 border-l-primary'
                      : 'border-l-2 border-l-transparent hover:bg-surface-2 dark:hover:bg-surface-2/50'
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
                  <div className="w-10 px-3 flex items-center">
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
                      className={`flex h-4 w-4 items-center justify-center rounded border transition-colors ${
                        selected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-card dark:border-border dark:bg-surface-2 group-hover:border-primary/50'
                      }`}
                    >
                      {selected && <Check className="h-3 w-3" />}
                    </button>
                  </div>

                  {/* Name */}
                  <div className="flex items-center gap-2.5 flex-1 min-w-0 px-3">
                    <button
                      type="button"
                      className="flex items-center gap-2.5 text-left min-w-0 w-full"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(entry);
                      }}
                    >
                      {entry.isDirectory ? (
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary-500/10">
                          <Folder className="h-4 w-4 shrink-0 text-primary" />
                        </div>
                      ) : (
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-2 dark:bg-surface-3">
                          <FileTypeIcon name={entry.name} className="h-4 w-4" />
                        </div>
                      )}
                      {isRenaming ? (
                        <InlineRenameInput
                          entry={entry}
                          onSubmit={onRenameSubmit}
                          onCancel={onRenameCancel}
                        />
                      ) : (
                        <div className="min-w-0 flex flex-col">
                          <span className="truncate text-sm font-medium text-foreground dark:text-foreground">
                            {entry.name}
                          </span>
                          {info && (
                            <span className="text-[10px] text-muted-foreground leading-tight">
                              {info.label}
                            </span>
                          )}
                        </div>
                      )}
                    </button>
                  </div>

                  {/* Mode */}
                  <div className="hidden sm:block w-20 px-3 font-mono text-[11px] text-muted-foreground tabular-nums">
                    {formatFileMode(entry.mode)}
                  </div>

                  {/* Size */}
                  <div className="hidden md:block w-24 px-3">
                    {entry.isDirectory ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {formatBytes(entry.size)}
                        </span>
                        {/* Subtle size bar for files > 1KB */}
                        {entry.size > 1024 && (
                          <div className="h-1 w-full max-w-[60px] overflow-hidden rounded-full bg-surface-3 dark:bg-surface-3/50">
                            <div
                              className="h-full rounded-full bg-primary/30"
                              style={{
                                width: `${Math.min(100, Math.log10(entry.size + 1) * 8)}%`,
                              }}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Modified */}
                  <div className="hidden lg:block w-40 px-3 text-xs text-muted-foreground">
                    {entry.modified ? (
                      <span className="tabular-nums" title={new Date(entry.modified).toLocaleString()}>
                        {new Date(entry.modified).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}{' '}
                        <span className="text-muted-foreground/60">
                          {new Date(entry.modified).toLocaleTimeString(undefined, {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </span>
                    ) : (
                      '—'
                    )}
                  </div>

                  {/* Actions */}
                  <div className="w-10 px-3">
                    <div className="flex justify-end opacity-0 group-hover:opacity-100 transition-opacity duration-150">
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
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>

      {/* Footer */}
      <div className="flex-none border-t border-border bg-surface-1/80 backdrop-blur-sm dark:bg-surface-0/80">
        <div className="flex items-center justify-between px-4 py-2">
          <span className="text-[11px] text-muted-foreground">
            {files.length} item{files.length !== 1 ? 's' : ''}
            {totalSize > 0 && (
              <span className="ml-2 text-muted-foreground/60">
                · {formatBytes(totalSize)} total
              </span>
            )}
          </span>
          {selectedPaths.size > 0 && (
            <span className="text-[11px] font-medium text-primary">
              {selectedPaths.size} selected
            </span>
          )}
        </div>
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
