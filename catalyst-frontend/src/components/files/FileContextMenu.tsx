import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
 Archive,
 ArchiveRestore,
 ClipboardCopy,
 Download,
 FolderOpen,
 FileText,
 Pencil,
 Shield,
 Trash2,
 MoreHorizontal,
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
 const [adjustedPos, setAdjustedPos] = useState<{ x: number; y: number } | null>(null);

 const wrap = (action?: () => void) => () => {
 action?.();
 if (detailsRef.current) detailsRef.current.open = false;
 onRequestClose?.();
 };

 const itemClass =
 'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground';
 const itemIconClass = 'h-3.5 w-3.5 shrink-0';
 const dangerClass =
 'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/5 dark:hover:bg-destructive/10';

 const menu = (
 <div
 ref={menuRef}
 className="w-52 rounded-xl border border-border bg-card p-1 dark:border-border dark:bg-surface-1"
 >
 <button type="button" className={itemClass} onClick={wrap(onOpen)}>
 {entry.isDirectory ? (
 <FolderOpen className={`${itemIconClass} text-primary`} />
 ) : (
 <FileText className={`${itemIconClass} text-info`} />
 )}
 <span className="flex-1 text-left">{entry.isDirectory ? 'Open Folder' : 'Open File'}</span>
 <kbd className="hidden sm:inline text-[10px] text-muted-foreground/40 font-mono">↵</kbd>
 </button>

 {onDownload && (
 <button type="button" className={itemClass} onClick={wrap(onDownload)}>
 <Download className={`${itemIconClass} text-primary`} />
 <span className="flex-1 text-left">Download</span>
 </button>
 )}

 <div className="my-1 border-t border-border dark:border-border/50" />

 {onCopyPath && (
 <button type="button" className={itemClass} onClick={wrap(onCopyPath)}>
 <ClipboardCopy className={`${itemIconClass} text-muted-foreground`} />
 <span className="flex-1 text-left">Copy Path</span>
 </button>
 )}
 {onRename && (
 <button type="button" className={itemClass} onClick={wrap(onRename)}>
 <Pencil className={`${itemIconClass} text-warning`} />
 <span className="flex-1 text-left">Rename</span>
 <kbd className="hidden sm:inline text-[10px] text-muted-foreground/40 font-mono">F2</kbd>
 </button>
 )}

 <div className="my-1 border-t border-border dark:border-border/50" />

 {onCompress && (
 <button type="button" className={itemClass} onClick={wrap(onCompress)}>
 <Archive className={`${itemIconClass} text-amber-500`} />
 <span className="flex-1 text-left">Compress</span>
 </button>
 )}
 {onDecompress && (
 <button type="button" className={itemClass} onClick={wrap(onDecompress)}>
 <ArchiveRestore className={`${itemIconClass} text-amber-500`} />
 <span className="flex-1 text-left">Extract</span>
 </button>
 )}
 {onPermissions && (
 <button type="button" className={itemClass} onClick={wrap(onPermissions)}>
 <Shield className={`${itemIconClass} text-success`} />
 <span className="flex-1 text-left">Permissions</span>
 </button>
 )}

 <div className="my-1 border-t border-border dark:border-border/50" />

 <button type="button" className={dangerClass} onClick={wrap(onDelete)}>
 <Trash2 className={`${itemIconClass} text-destructive`} />
 <span className="flex-1 text-left">Delete</span>
 <kbd className="hidden sm:inline text-[10px] text-destructive/40 font-mono">Del</kbd>
 </button>
 </div>
 );

 // Context-menu mode: measure and adjust position after first paint
 useLayoutEffect(() => {
 if (!contextPosition || !menuRef.current) {
 setAdjustedPos(null);
 return;
 }
 const rect = menuRef.current.getBoundingClientRect();
 const padding = 8;
 let x = contextPosition.x;
 let y = contextPosition.y;

 // Right-edge check
 if (x + rect.width > window.innerWidth - padding) {
 x = window.innerWidth - rect.width - padding;
 }
 // Bottom-edge check
 if (y + rect.height > window.innerHeight - padding) {
 y = window.innerHeight - rect.height - padding;
 }
 // Left/top minimum
 x = Math.max(padding, x);
 y = Math.max(padding, y);

 setAdjustedPos({ x, y });
 }, [contextPosition]);

 // Render as fixed-position context menu
 if (contextPosition) {
 const menuEl = (
 <div
 data-file-context-menu="true"
 className="fixed z-50"
 style={{
 left: adjustedPos?.x ?? contextPosition.x,
 top: adjustedPos?.y ?? contextPosition.y,
 }}
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
 return createPortal(menuEl, document.body);
 }

 // Render as inline dropdown (hover "..." button)
 return (
 <details ref={detailsRef} className="relative" onClick={(e) => e.stopPropagation()}>
 <summary
 className="list-none flex cursor-pointer items-center justify-center rounded-lg p-1 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground [&::-webkit-details-marker]:hidden"
 aria-label="File actions"
 >
 <MoreHorizontal className="h-4 w-4" />
 </summary>
 <div className="absolute right-0 z-10 mt-1">{menu}</div>
 </details>
 );
}

export default FileContextMenu;
