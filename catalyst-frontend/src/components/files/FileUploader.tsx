import { useRef, useState } from 'react';
import { Upload, X } from 'lucide-react';

type Props = {
  path: string;
  isUploading: boolean;
  onUpload: (files: File[], onProgress?: (fileIndex: number, progress: number) => void) => void;
  onClose: () => void;
};

function FileUploader({ path, isUploading, onUpload, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [fileProgress, setFileProgress] = useState<Record<number, number>>({});
  const [fileNames, setFileNames] = useState<string[]>([]);

  const handleFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const arr = Array.from(files);
    setFileNames(arr.map((f) => f.name));
    setFileProgress({});
    onUpload(arr, (fileIndex, progress) => {
      setFileProgress((prev) => ({ ...prev, [fileIndex]: progress }));
    });
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="rounded-xl border border-border bg-white p-4 dark:border-border dark:bg-surface-1">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground dark:text-white">Upload Files</h3>
          <p className="text-xs text-muted-foreground dark:text-muted-foreground">Target: {path}</p>
        </div>
        <button
          type="button"
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-muted-foreground dark:hover:bg-surface-2 dark:hover:text-zinc-300"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div
        className={`mt-3 flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-8 transition-colors ${
          isDragActive
            ? 'border-primary-500 bg-primary-500/5 text-primary-600 dark:text-primary-400'
            : 'border-border text-muted-foreground dark:border-border dark:text-muted-foreground'
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragActive(true);
        }}
        onDragLeave={() => setIsDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragActive(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        <Upload className="mb-2 h-8 w-8" />
        <p className="text-sm font-medium">
          {isDragActive ? 'Drop files here' : 'Drag files here'}
        </p>
        <p className="mt-1 text-xs">or select from your device</p>
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
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary-500 disabled:opacity-50"
            onClick={() => inputRef.current?.click()}
            disabled={isUploading}
          >
            {isUploading ? 'Uploading...' : 'Choose Files'}
          </button>
        </div>
      </div>
      {/* Upload progress */}
      {isUploading && fileNames.length > 0 && (
        <div className="mt-3 space-y-2">
          {fileNames.map((name, idx) => {
            const pct = fileProgress[idx] ?? 0;
            return (
              <div key={idx} className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={name}>
                  {name}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {pct}%
                </span>
                <div className="h-1.5 w-24 flex-shrink-0 overflow-hidden rounded-full bg-surface-2 dark:bg-surface-2">
                  <div
                    className="h-full rounded-full bg-primary-600 transition-all duration-200"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default FileUploader;
