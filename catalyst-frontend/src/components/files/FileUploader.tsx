import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
 const { t } = useTranslation('server-tabs');
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
 <div>
 <h3 className="font-display text-data font-semibold text-foreground">{t('files.uploader.title')}</h3>
 <p className="text-micro text-muted-foreground">{t('files.uploader.target')} <span className="font-mono tabular-nums">{path}</span></p>
 </div>
 </div>
 <button
 type="button"
 className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-1/40 hover:text-foreground"
 onClick={onClose}
 >
 <X className="h-4 w-4" />
 </button>
 </div>
 )}

 <div
 className={`flex flex-col items-center justify-center rounded-sm border border-dashed px-6 py-8 transition-colors ${
 isDragActive
 ? 'border-primary bg-primary/10'
 : 'border-border/60 bg-surface-1/40 hover:border-primary/40'
 } ${inModal ? '' : 'mt-3'}`}
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
 <Upload className={`mb-2 h-5 w-5 ${isDragActive ? 'text-primary' : 'text-muted-foreground/50'}`} />
 <p className={`text-mini font-medium ${isDragActive ? 'text-primary' : 'text-muted-foreground'}`}>
 {isDragActive ? t('files.uploader.dropHere') : t('files.uploader.dragHere')}
 </p>
 <p className="mt-0.5 text-micro text-muted-foreground/60">{t('files.uploader.orSelect')}</p>
 <div className="mt-3 flex items-center gap-2">
 <input
 ref={inputRef}
 type="file"
 multiple
 className="hidden"
 onChange={(e) => handleFiles(e.target.files)}
 />
 <button
 type="button"
 className="inline-flex h-8 items-center gap-1.5 rounded-sm bg-primary px-3 text-mini font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
 onClick={() => inputRef.current?.click()}
 disabled={isUploading}
 >
 {isUploading ? t('files.uploader.uploading') : t('files.uploader.chooseFiles')}
 </button>
 {isUploading && (
 <button
 type="button"
 className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-danger/30 px-3 text-mini font-semibold text-danger transition-colors hover:bg-danger/10"
 onClick={handleCancel}
 >
 <X className="h-3.5 w-3.5" />
 {t('common:actions.cancel')}
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
 className="mt-3 overflow-hidden rounded-sm border border-border/40"
 >
 {fileNames.map((name, idx) => {
 const pct = fileProgress[idx] ?? 0;
 const isDone = pct >= 100;
 return (
 <div
 key={idx}
 className={`flex items-center gap-2 px-3 py-1.5 ${idx > 0 ? 'border-t border-border/40' : ''}`}
 >
 {isDone ? (
 <Check className="h-4 w-4 text-success" />
 ) : (
 <FileTypeIcon name={name} className="h-4 w-4" />
 )}
 <span className="min-w-0 flex-1 truncate text-mini text-muted-foreground" title={name}>
 {name}
 </span>
 <span className="w-10 text-right font-mono text-micro tabular-nums text-muted-foreground">
 {isDone ? t('files.uploader.done') : `${pct}%`}
 </span>
 <div className="h-1 w-20 flex-shrink-0 overflow-hidden rounded-sm bg-surface-3">
 <motion.div
 className={`h-full rounded-sm ${isDone ? 'bg-success' : 'bg-info'}`}
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
 className="mt-2 flex items-center gap-1.5 text-mini text-success"
 >
 <Check className="h-3.5 w-3.5" />
 {t('files.uploader.allUploaded')}
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
 className="deck-panel p-3"
 >
 {content}
 </motion.div>
 );
}

export default FileUploader;
