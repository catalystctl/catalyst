import { useRef, useState } from 'react';
import { Upload, X, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileTypeIcon } from './FileTypeIcon';
import { collectDroppedFiles, isFileDrag } from '../../utils/droppedFiles';

type Props = {
 path: string;
 isUploading: boolean;
 onUpload: (files: File[], onProgress?: (fileIndex: number, progress: number) => void, signal?: AbortSignal) => void;
 onClose: () => void;
 inModal?: boolean;
};

function FileUploader({ path, isUploading, onUpload, onClose, inModal = false }: Props) {
 const inputRef = useRef<HTMLInputElement | null>(null);
 const abortRef = useRef<AbortController | null>(null);
 const [isDragActive, setIsDragActive] = useState(false);
 const [fileProgress, setFileProgress] = useState<Record<number, number>>({});
 const [fileNames, setFileNames] = useState<string[]>([]);

 const handleFiles = (files: File[] | FileList | null) => {
 if (!files?.length) return;
 const arr = Array.from(files);
 setFileNames(arr.map((f) => f.name));
 setFileProgress({});
 const controller = new AbortController();
 abortRef.current = controller;
 onUpload(
 arr,
 (fileIndex, progress) => {
 setFileProgress((prev) => ({ ...prev, [fileIndex]: progress }));
 },
 controller.signal,
 );
 if (inputRef.current) inputRef.current.value = '';
 };

 const handleCancel = () => {
 abortRef.current?.abort();
 };

 const allComplete = fileNames.length > 0 && fileNames.every((_, i) => (fileProgress[i] ?? 0) >= 100);

 const content = (
 <>
 {!inModal && (
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2">
 <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
 <Upload className="h-4 w-4 text-primary" />
 </div>
 <div>
 <h3 className="text-sm font-semibold text-foreground dark:text-foreground">Upload Files</h3>
 <p className="text-[11px] text-muted-foreground">Target: <span className="font-mono">{path}</span></p>
 </div>
 </div>
 <button
 type="button"
 className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
 onClick={onClose}
 >
 <X className="h-4 w-4" />
 </button>
 </div>
 )}

 <div
 className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-8 transition-all duration-200 ${
 isDragActive
 ? 'border-primary bg-primary-500/5 scale-[1.02]'
 : 'border-border bg-surface-1/50 hover:border-primary/40 hover:bg-surface-1 dark:border-border dark:bg-surface-2/30 dark:hover:border-primary/30'
 } ${inModal ? '' : 'mt-4'}`}
 onDragEnter={(e) => {
 if (!isFileDrag(e.dataTransfer)) return;
 e.preventDefault();
 e.stopPropagation();
 setIsDragActive(true);
 }}
 onDragOver={(e) => {
 if (!isFileDrag(e.dataTransfer)) return;
 e.preventDefault();
 e.stopPropagation();
 e.dataTransfer.dropEffect = 'copy';
 setIsDragActive(true);
 }}
 onDragLeave={(e) => {
 e.preventDefault();
 setIsDragActive(false);
 }}
 onDrop={(e) => {
 e.preventDefault();
 e.stopPropagation();
 setIsDragActive(false);
 void collectDroppedFiles(e.dataTransfer).then((dropped) => {
 handleFiles(dropped.map((item) => item.file));
 });
 }}
 >
 <motion.div
 animate={isDragActive ? { scale: 1.1, y: -4 } : { scale: 1, y: 0 }}
 transition={{ duration: 0.2 }}
 >
 <Upload className={`mb-3 h-10 w-10 ${isDragActive ? 'text-primary' : 'text-muted-foreground/40'}`} />
 </motion.div>
 <p className={`text-sm font-medium ${isDragActive ? 'text-primary' : 'text-muted-foreground'}`}>
 {isDragActive ? 'Drop files here' : 'Drag files here'}
 </p>
 <p className="mt-1 text-xs text-muted-foreground/60">or select from your device</p>
 <div className="mt-4">
 <input
 ref={inputRef}
 type="file"
 multiple
 className="hidden"
 onChange={(e) => handleFiles(e.target.files)}
 />
 <button
 type="button"
 className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50"
 onClick={() => inputRef.current?.click()}
 disabled={isUploading}
 >
 {isUploading ? 'Uploading…' : 'Choose Files'}
 </button>
 {isUploading && (
 <button
 type="button"
 className="inline-flex items-center gap-1.5 rounded-lg border border-danger/30 px-4 py-2 text-xs font-semibold text-danger transition-colors hover:bg-danger-muted"
 onClick={handleCancel}
 >
 <X className="h-3.5 w-3.5" />
 Cancel
 </button>
 )}
 </div>
 </div>

 {/* Upload progress */}
 <AnimatePresence>
 {fileNames.length > 0 && (
 <motion.div
 initial={{ opacity: 0, height: 0 }}
 animate={{ opacity: 1, height: 'auto' }}
 exit={{ opacity: 0, height: 0 }}
 className="mt-4 space-y-2 overflow-hidden"
 >
 {fileNames.map((name, idx) => {
 const pct = fileProgress[idx] ?? 0;
 const isDone = pct >= 100;
 return (
 <div
 key={idx}
 className="flex items-center gap-3 rounded-lg border border-border bg-surface-1 px-3 py-2 dark:border-border dark:bg-surface-2/50"
 >
 <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-2 dark:bg-surface-3">
 {isDone ? (
 <Check className="h-4 w-4 text-success" />
 ) : (
 <FileTypeIcon name={name} className="h-4 w-4" />
 )}
 </div>
 <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={name}>
 {name}
 </span>
 <span className="text-[11px] tabular-nums text-muted-foreground w-8 text-right">
 {isDone ? 'Done' : `${pct}%`}
 </span>
 <div className="h-1.5 w-20 flex-shrink-0 overflow-hidden rounded-full bg-surface-3 dark:bg-surface-3">
 <motion.div
 className={`h-full rounded-full ${isDone ? 'bg-success' : 'bg-primary'}`}
 initial={{ width: 0 }}
 animate={{ width: `${pct}%` }}
 transition={{ duration: 0.2 }}
 />
 </div>
 </div>
 );
 })}
 </motion.div>
 )}
 </AnimatePresence>

 {allComplete && (
 <motion.div
 initial={{ opacity: 0 }}
 animate={{ opacity: 1 }}
 className="mt-3 flex items-center gap-1.5 text-xs text-success"
 >
 <Check className="h-3.5 w-3.5" />
 All files uploaded successfully
 </motion.div>
 )}
 </>
 );

 if (inModal) return content;

 return (
 <motion.div
 initial={{ opacity: 0, y: -8 }}
 animate={{ opacity: 1, y: 0 }}
 exit={{ opacity: 0, y: -8 }}
 transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
 className="rounded-xl border border-border bg-card p-4 dark:border-border dark:bg-surface-1 shadow-sm"
 >
 {content}
 </motion.div>
 );
}

export default FileUploader;
