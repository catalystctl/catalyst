import { useEffect, useRef, useState } from 'react';
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
    // Select name without extension for files
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
  const [contextMenuEntry, setContextMenuEntry] = useState<FileEntry | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(
    null,
  );

  useEffect(() => {
    if (!contextMenuPosition) return undefined;
    const dismiss = () => {
      setContextMenuPosition(null);
      setContextMenuEntry(null);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const t = (e.target as HTMLElement)?.closest('[data-file-context-menu="true"]');
      if (!t) dismiss();
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('mousedown', handlePointerDown, true);
    window.addEventListener('touchstart', handlePointerDown, true);
    window.addEventListener(
      'contextmenu',
      (e) => {
        if (!(e.target as HTMLElement)?.closest('[data-file-context-menu="true"]')) dismiss();
      },
      true,
    );
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('mousedown', handlePointerDown, true);
      window.removeEventListener('touchstart', handlePointerDown, true);
    };
  }, [contextMenuPosition]);

  const closeContextMenu = () => {
    setContextMenuPosition(null);
    setContextMenuEntry(null);
  };

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

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px]">
        <thead>
          <tr className="border-b border-border dark:border-border">
            <th className="w-10 px-3 py-2.5">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onSelectAll}
                className="h-3.5 w-3.5 rounded border-border text-primary-500 dark:border-zinc-600 dark:bg-surface-2"
              />
            </th>
            <th className={thClass} onClick={() => onSort('name')}>
              Name <SortIndicator field="name" active={sortField} direction={sortDirection} />
            </th>
            <th className={`${thClass} w-20`} onClick={() => onSort('mode')}>
              Mode <SortIndicator field="mode" active={sortField} direction={sortDirection} />
            </th>
            <th className={`${thClass} w-24`} onClick={() => onSort('size')}>
              Size <SortIndicator field="size" active={sortField} direction={sortDirection} />
            </th>
            <th className={`${thClass} w-40`} onClick={() => onSort('modified')}>
              Modified{' '}
              <SortIndicator field="modified" active={sortField} direction={sortDirection} />
            </th>
            <th className="w-10 px-3 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
          {files.map((entry) => {
            const selected = selectedPaths.has(entry.path);
            const isRenaming = renamingEntry?.path === entry.path;
            return (
              <tr
                key={entry.path}
                className={`group transition-colors ${
                  selected
                    ? 'bg-primary-500/5 dark:bg-primary-500/10'
                    : 'hover:bg-surface-2 dark:hover:bg-surface-2/50'
                }`}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenuEntry(entry);
                  setContextMenuPosition({ x: e.clientX, y: e.clientY });
                }}
                onDoubleClick={() => {
                  if (!isRenaming) onOpen(entry);
                }}
              >
                <td className="px-3 py-2">
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
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className="flex items-center gap-2 text-left"
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
                </td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground dark:text-muted-foreground">
                  {formatFileMode(entry.mode)}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground dark:text-muted-foreground">
                  {entry.isDirectory ? '—' : formatBytes(entry.size)}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground dark:text-muted-foreground">
                  {entry.modified ? new Date(entry.modified).toLocaleString() : '—'}
                </td>
                <td className="px-3 py-2">
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
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground dark:border-border dark:text-muted-foreground">
        {files.length} item{files.length !== 1 ? 's' : ''}
      </div>
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
