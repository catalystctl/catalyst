import { useLayoutEffect, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  ClipboardCopy,
  Download,
  FolderOpen,
  FileText,
  MoreHorizontal,
  Pencil,
  Shield,
  Trash2,
} from 'lucide-react';
import type { FileEntry } from '../../types/file';

type Props = {
  entry: FileEntry;
  onOpen: () => void;
  onDownload?: () => void;
  onCopyPath?: () => void;
  onRename?: () => void;
  onDelete: () => void;
  onCompress?: () => void;
  onDecompress?: () => void;
  onPermissions?: () => void;
  contextPosition?: { x: number; y: number } | null;
  onRequestClose?: () => void;
};

function FileContextMenu({
  entry,
  onOpen,
  onDownload,
  onCopyPath,
  onRename,
  onDelete,
  onCompress,
  onDecompress,
  onPermissions,
  contextPosition,
  onRequestClose,
}: Props) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);

  const wrap = (action?: () => void) => () => {
    action?.();
    if (detailsRef.current) detailsRef.current.open = false;
    onRequestClose?.();
  };

  const itemClass =
    'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white';
  const dangerClass =
    'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-rose-600 transition-colors hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10';

  const menu = (
    <div
      ref={menuRef}
      className="w-44 rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
    >
      <button type="button" className={itemClass} onClick={wrap(onOpen)}>
        {entry.isDirectory ? <FolderOpen className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
        {entry.isDirectory ? 'Open Folder' : 'Open File'}
      </button>
      {onDownload && (
        <button type="button" className={itemClass} onClick={wrap(onDownload)}>
          <Download className="h-3.5 w-3.5" />
          Download
        </button>
      )}
      {onCopyPath && (
        <button type="button" className={itemClass} onClick={wrap(onCopyPath)}>
          <ClipboardCopy className="h-3.5 w-3.5" />
          Copy Path
        </button>
      )}
      {onRename && (
        <button type="button" className={itemClass} onClick={wrap(onRename)}>
          <Pencil className="h-3.5 w-3.5" />
          Rename
        </button>
      )}
      <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
      {onCompress && (
        <button type="button" className={itemClass} onClick={wrap(onCompress)}>
          <Archive className="h-3.5 w-3.5" />
          Compress
        </button>
      )}
      {onDecompress && (
        <button type="button" className={itemClass} onClick={wrap(onDecompress)}>
          <ArchiveRestore className="h-3.5 w-3.5" />
          Extract
        </button>
      )}
      {onPermissions && (
        <button type="button" className={itemClass} onClick={wrap(onPermissions)}>
          <Shield className="h-3.5 w-3.5" />
          Permissions
        </button>
      )}
      <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
      <button type="button" className={dangerClass} onClick={wrap(onDelete)}>
        <Trash2 className="h-3.5 w-3.5" />
        Delete
      </button>
    </div>
  );

  useLayoutEffect(() => {
    if (!contextPosition || !menuRef.current) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMenuPosition(null);
      return;
    }
    const rect = menuRef.current.getBoundingClientRect();
    const padding = 12;
    let nextX = contextPosition.x;
    let nextY = contextPosition.y;
    if (nextX + rect.width > window.innerWidth - padding) {
      nextX = Math.max(padding, window.innerWidth - rect.width - padding);
    }
    if (nextY + rect.height > window.innerHeight - padding) {
      nextY = Math.max(padding, window.innerHeight - rect.height - padding);
    }
    setMenuPosition({ x: Math.max(padding, nextX), y: Math.max(padding, nextY) });
  }, [contextPosition]);

  if (contextPosition && menuPosition) {
    return (
      <div
        data-file-context-menu="true"
        className="fixed z-50"
        style={{ left: menuPosition.x, top: menuPosition.y }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {menu}
      </div>
    );
  }

  return (
    <details ref={detailsRef} className="relative" onClick={(e) => e.stopPropagation()}>
      <summary
        className="list-none flex cursor-pointer items-center justify-center rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300 [&::-webkit-details-marker]:hidden"
        aria-label="File actions"
      >
        <MoreHorizontal className="h-4 w-4" />
      </summary>
      <div className="absolute right-0 z-10 mt-1">{menu}</div>
    </details>
  );
}

export default FileContextMenu;
