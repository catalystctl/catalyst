import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, File, Folder } from 'lucide-react';
import type { FileEntry } from '../../types/file';
import { formatBytes, formatFileMode } from '../../utils/formatters';
import EmptyState from '../shared/EmptyState';
import FileContextMenu from './FileContextMenu';

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

const ROW_HEIGHT = 40;
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
    <ArrowUp className="inline h-3 w-3" />
  ) : (
    <ArrowDown className="inline h-3 w-3" />
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
      className="w-full max-w-xs rounded border border-primary-500 bg-white px-1.5 py-0.5 text-sm text-foreground outline-none dark:bg-surface-2 dark:text-zinc-200"
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

  // Memoize row data to avoid recreating on each render
  const rowData = useMemo(() => {
    return files.map((entry) => ({
      entry,
      selected: selectedPaths.has(entry.path),
      isRenaming: renamingEntry?.path === entry.path,
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
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [contextMenuPosition, closeContextMenu]);

  if (isLoading) {
    return (
      <div className="px-4 py-8 text-center text-sm text-muted-foreground dark:text-muted-foreground">
        Loading files...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="px-4 py-8 text-center text-sm text-rose-600 dark:text-rose-400">
        Unable to load file listing.
      </div>
    );
  }

  if (!files.length) {
    return (
      <EmptyState title="No files here" description="Upload or create a file to get started." />
    );
  }

  const thClass =
    'cursor-pointer select-none px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-muted-foreground dark:text-muted-foreground dark:hover:text-zinc-300';

  const totalHeight = files.length * ROW_HEIGHT;
  const innerHeight = virtualizer.getTotalSize();

  return (
    <div className="flex flex-col h-full">
      {/* Fixed header */}
      <div className="flex-none border-b border-border dark:border-border bg-surface-1/50 dark:bg-surface-0/50">
        <div className="flex items-center" style={{ height: HEADER_HEIGHT }}>
          <div className="w-10 px-3 flex items-center">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={onSelectAll}
              className="h-3.5 w-3.5 rounded border-border text-primary-500 dark:border-zinc-600 dark:bg-surface-2"
            />
          </div>
          <div className={thClass} onClick={() => onSort('name')}>
            Name <SortIndicator field="name" active={sortField} direction={sortDirection} />
          </div>
          <div className={`${thClass} w-20`} onClick={() => onSort('mode')}>
            Mode <SortIndicator field="mode" active={sortField} direction={sortDirection} />
          </div>
          <div className={`${thClass} w-24`} onClick={() => onSort('size')}>
            Size <SortIndicator field="size" active={sortField} direction={sortDirection} />
          </div>
          <div className={`${thClass} w-40`} onClick={() => onSort('modified')}>
            Modified <SortIndicator field="modified" active={sortField} direction={sortDirection} />
          </div>
          <div className="w-10 px-3" />
        </div>
      </div>

      {/* Virtual scroll container */}
      <div 
        ref={parentRef} 
        className="flex-1 overflow-auto"
        style={{ contain: 'strict' }}
      >
        <div style={{ height: totalHeight, position: 'relative' }}>
          {virtualItems.map((virtualRow) => {
            const { entry, selected, isRenaming } = rowData[virtualRow.index];
            return (
              <div
                key={entry.path}
                data-index={virtualRow.index}
                className={`absolute left-0 right-0 flex items-center group transition-colors ${
                  selected
                    ? 'bg-primary-500/5 dark:bg-primary-500/10'
                    : 'hover:bg-surface-2 dark:hover:bg-surface-2/50'
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
                <div className="w-10 px-3 flex items-center">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={(e) => onSelect(entry, e.target.checked)}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (e.shiftKey) {
                        e.preventDefault();
                        onShiftSelect(entry);
                      }
                    }}
                    className="h-3.5 w-3.5 rounded border-border text-primary-500 dark:border-zinc-600 dark:bg-surface-2"
                  />
                </div>
                <div className="flex items-center gap-2 flex-1 min-w-0 px-3">
                  <button
                    type="button"
                    className="flex items-center gap-2 text-left min-w-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(entry);
                    }}
                  >
                    {entry.isDirectory ? (
                      <Folder className="h-4 w-4 shrink-0 text-primary-500" />
                    ) : (
                      <File className="h-4 w-4 shrink-0 text-muted-foreground dark:text-muted-foreground" />
                    )}
                    {isRenaming ? (
                      <InlineRenameInput
                        entry={entry}
                        onSubmit={onRenameSubmit}
                        onCancel={onRenameCancel}
                      />
                    ) : (
                      <span className="truncate text-sm text-foreground dark:text-zinc-200">
                        {entry.name}
                      </span>
                    )}
                  </button>
                </div>
                <div className="w-20 px-3 font-mono text-xs text-muted-foreground dark:text-muted-foreground">
                  {formatFileMode(entry.mode)}
                </div>
                <div className="w-24 px-3 text-xs text-muted-foreground dark:text-muted-foreground">
                  {entry.isDirectory ? '—' : formatBytes(entry.size)}
                </div>
                <div className="w-40 px-3 text-xs text-muted-foreground dark:text-muted-foreground">
                  {entry.modified ? new Date(entry.modified).toLocaleString() : '—'}
                </div>
                <div className="w-10 px-3">
                  <div className="flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
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
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer */}
      <div className="flex-none border-t border-border px-4 py-2 text-[11px] text-muted-foreground dark:border-border dark:text-muted-foreground">
        {files.length} item{files.length !== 1 ? 's' : ''}
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