import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import {
 DropdownMenu,
 DropdownMenuContent,
 DropdownMenuItem,
 DropdownMenuSeparator,
 DropdownMenuTrigger,
} from '../ui/dropdown-menu';
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
 const { t } = useTranslation('server-tabs');
 const menuRef = useRef<HTMLDivElement | null>(null);
 const [adjustedPos, setAdjustedPos] = useState<{ x: number; y: number } | null>(null);
 const [open, setOpen] = useState(false);

 const close = () => {
 setOpen(false);
 onRequestClose?.();
 };

 const wrap = (action?: () => void) => () => {
 action?.();
 close();
 };

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

 // Render as fixed-position context menu (right-click)
 if (contextPosition) {
 const itemClass =
 'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground';
 const itemIconClass = 'h-3.5 w-3.5 shrink-0';
 const dangerClass =
 'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/5 dark:hover:bg-destructive/10';

 const menuEl = (
 <div
 data-file-context-menu="true"
 className="fixed z-[100]"
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
 <div
 ref={menuRef}
 className="w-52 rounded-md border border-border/50 bg-card p-1 shadow-xl"
 >
 <button type="button" className={itemClass} onClick={wrap(onOpen)}>
 {entry.isDirectory ? (
 <FolderOpen className={`${itemIconClass} text-primary`} />
 ) : (
 <FileText className={`${itemIconClass} text-info`} />
 )}
 <span className="flex-1 text-left">{entry.isDirectory ? t('files.contextMenu.openFolder') : t('files.contextMenu.openFile')}</span>
 <kbd className="hidden sm:inline text-[10px] text-muted-foreground/40 font-mono">↵</kbd>
 </button>

 {onDownload && (
 <button type="button" className={itemClass} onClick={wrap(onDownload)}>
 <Download className={`${itemIconClass} text-primary`} />
 <span className="flex-1 text-left">{t('common:actions.download')}</span>
 </button>
 )}

 <div className="my-1 border-t border-border dark:border-border/50" />

 {onCopyPath && (
 <button type="button" className={itemClass} onClick={wrap(onCopyPath)}>
 <ClipboardCopy className={`${itemIconClass} text-muted-foreground`} />
 <span className="flex-1 text-left">{t('files.contextMenu.copyPath')}</span>
 </button>
 )}
 {onRename && (
 <button type="button" className={itemClass} onClick={wrap(onRename)}>
 <Pencil className={`${itemIconClass} text-warning`} />
 <span className="flex-1 text-left">{t('files.contextMenu.rename')}</span>
 <kbd className="hidden sm:inline text-[10px] text-muted-foreground/40 font-mono">F2</kbd>
 </button>
 )}

 <div className="my-1 border-t border-border dark:border-border/50" />

 {onCompress && (
 <button type="button" className={itemClass} onClick={wrap(onCompress)}>
 <Archive className={`${itemIconClass} text-warning`} />
 <span className="flex-1 text-left">{t('files.actions.compress')}</span>
 </button>
 )}
 {onDecompress && (
 <button type="button" className={itemClass} onClick={wrap(onDecompress)}>
 <ArchiveRestore className={`${itemIconClass} text-warning`} />
 <span className="flex-1 text-left">{t('files.actions.extract')}</span>
 </button>
 )}
 {onPermissions && (
 <button type="button" className={itemClass} onClick={wrap(onPermissions)}>
 <Shield className={`${itemIconClass} text-success`} />
 <span className="flex-1 text-left">{t('files.contextMenu.permissions')}</span>
 </button>
 )}

 <div className="my-1 border-t border-border dark:border-border/50" />

 <button type="button" className={dangerClass} onClick={wrap(onDelete)}>
 <Trash2 className={`${itemIconClass} text-destructive`} />
 <span className="flex-1 text-left">{t('common:actions.delete')}</span>
 <kbd className="hidden sm:inline text-[10px] text-destructive/40 font-mono">Del</kbd>
 </button>
 </div>
 </div>
 );
 return createPortal(menuEl, document.body);
 }

 // Inline dropdown ("..." button) uses a portal so the virtualized list's
 // overflow and per-row transform stacking contexts cannot clip it or paint
 // later rows above it.
 const itemIconClass = 'h-3.5 w-3.5 shrink-0';
 return (
 <DropdownMenu open={open} onOpenChange={setOpen}>
 <DropdownMenuTrigger asChild>
 <button
 type="button"
 className="flex cursor-pointer items-center justify-center rounded-lg p-1 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
 aria-label={t('files.contextMenu.fileActions')}
 onClick={(e) => e.stopPropagation()}
 >
 <MoreHorizontal className="h-4 w-4" />
 </button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end" sideOffset={4} className="w-52">
 <DropdownMenuItem className="gap-2.5 text-xs" onClick={wrap(onOpen)}>
 {entry.isDirectory ? (
 <FolderOpen className={`${itemIconClass} text-primary`} />
 ) : (
 <FileText className={`${itemIconClass} text-info`} />
 )}
 <span className="flex-1 text-left">{entry.isDirectory ? t('files.contextMenu.openFolder') : t('files.contextMenu.openFile')}</span>
 <kbd className="hidden sm:inline text-[10px] text-muted-foreground/40 font-mono">↵</kbd>
 </DropdownMenuItem>

 {onDownload && (
 <DropdownMenuItem className="gap-2.5 text-xs" onClick={wrap(onDownload)}>
 <Download className={`${itemIconClass} text-primary`} />
 <span className="flex-1 text-left">{t('common:actions.download')}</span>
 </DropdownMenuItem>
 )}

 {(onCopyPath || onRename) && <DropdownMenuSeparator />}

 {onCopyPath && (
 <DropdownMenuItem className="gap-2.5 text-xs" onClick={wrap(onCopyPath)}>
 <ClipboardCopy className={`${itemIconClass} text-muted-foreground`} />
 <span className="flex-1 text-left">{t('files.contextMenu.copyPath')}</span>
 </DropdownMenuItem>
 )}
 {onRename && (
 <DropdownMenuItem className="gap-2.5 text-xs" onClick={wrap(onRename)}>
 <Pencil className={`${itemIconClass} text-warning`} />
 <span className="flex-1 text-left">{t('files.contextMenu.rename')}</span>
 <kbd className="hidden sm:inline text-[10px] text-muted-foreground/40 font-mono">F2</kbd>
 </DropdownMenuItem>
 )}

 {(onCompress || onDecompress || onPermissions) && <DropdownMenuSeparator />}

 {onCompress && (
 <DropdownMenuItem className="gap-2.5 text-xs" onClick={wrap(onCompress)}>
 <Archive className={`${itemIconClass} text-warning`} />
 <span className="flex-1 text-left">{t('files.actions.compress')}</span>
 </DropdownMenuItem>
 )}
 {onDecompress && (
 <DropdownMenuItem className="gap-2.5 text-xs" onClick={wrap(onDecompress)}>
 <ArchiveRestore className={`${itemIconClass} text-warning`} />
 <span className="flex-1 text-left">{t('files.actions.extract')}</span>
 </DropdownMenuItem>
 )}
 {onPermissions && (
 <DropdownMenuItem className="gap-2.5 text-xs" onClick={wrap(onPermissions)}>
 <Shield className={`${itemIconClass} text-success`} />
 <span className="flex-1 text-left">{t('files.contextMenu.permissions')}</span>
 </DropdownMenuItem>
 )}

 <DropdownMenuSeparator />
 <DropdownMenuItem className="gap-2.5 text-xs text-destructive focus:text-destructive" onClick={wrap(onDelete)}>
 <Trash2 className={`${itemIconClass} text-destructive`} />
 <span className="flex-1 text-left">{t('common:actions.delete')}</span>
 <kbd className="hidden sm:inline text-[10px] text-destructive/40 font-mono">Del</kbd>
 </DropdownMenuItem>
 </DropdownMenuContent>
 </DropdownMenu>
 );
}

export default FileContextMenu;
