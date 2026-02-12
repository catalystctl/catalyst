import { useEffect, useMemo } from 'react';
import Editor from '@monaco-editor/react';
import { Download, RotateCcw, Save, X } from 'lucide-react';

type FileDraft = {
  path: string;
  name: string;
  content: string;
  originalContent: string;
};

type Props = {
  file: FileDraft | null;
  isLoading: boolean;
  isSaving: boolean;
  isDirty: boolean;
  isSuspended?: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onDownload?: () => void;
  onReset: () => void;
  onClose: () => void;
};

const resolveLanguage = (fileName: string) => {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  switch (extension) {
    case 'json':
      return 'json';
    case 'yml':
    case 'yaml':
      return 'yaml';
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'sh':
    case 'bash':
      return 'shell';
    case 'properties':
    case 'cfg':
    case 'ini':
      return 'ini';
    case 'toml':
      return 'toml';
    case 'xml':
      return 'xml';
    case 'html':
    case 'htm':
      return 'html';
    case 'css':
      return 'css';
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'sql':
      return 'sql';
    case 'py':
      return 'python';
    case 'rs':
      return 'rust';
    case 'java':
      return 'java';
    case 'log':
    case 'txt':
    default:
      return 'plaintext';
  }
};

function FileEditor({
  file,
  isLoading,
  isSaving,
  isDirty,
  isSuspended = false,
  onChange,
  onSave,
  onDownload,
  onReset,
  onClose,
}: Props) {
  const language = useMemo(() => (file ? resolveLanguage(file.name) : 'plaintext'), [file]);

  // Ctrl+S keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (isDirty && !isSaving && !isSuspended) onSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDirty, isSaving, isSuspended, onSave]);

  // Warn before closing page with unsaved changes
  useEffect(() => {
    if (!isDirty) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers ignore the custom message and show a generic one
      e.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  // Handle close with unsaved changes confirmation
  const handleClose = () => {
    if (isDirty) {
      const confirmed = window.confirm('You have unsaved changes. Are you sure you want to close this file?');
      if (!confirmed) return;
    }
    onClose();
  };

  if (!file) return null;

  const btnSecondary =
    'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white';
  const btnPrimary =
    'inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary-500 disabled:opacity-50';

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
              {file.name}
            </h3>
            {isDirty && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                Unsaved
              </span>
            )}
            {isSuspended && (
              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">
                Suspended
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-400 dark:text-slate-500">{file.path}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={btnSecondary}
            onClick={onReset}
            disabled={!isDirty || isSaving || isLoading || isSuspended}
            title="Revert changes"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Revert
          </button>
          {onDownload && (
            <button
              type="button"
              className={btnSecondary}
              onClick={onDownload}
              disabled={isSaving || isLoading}
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </button>
          )}
          <button
            type="button"
            className={btnPrimary}
            onClick={onSave}
            disabled={!isDirty || isSaving || isLoading || isSuspended}
            title="Save (Ctrl+S)"
          >
            <Save className="h-3.5 w-3.5" />
            Save
          </button>
          <button
            type="button"
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            onClick={handleClose}
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div
        className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800"
      >
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500 dark:text-slate-400">
            Loading file contents...
          </div>
        ) : (
          <Editor
            height="100%"
            theme="vs-dark"
            language={language}
            value={file.content}
            onChange={(value) => onChange(value ?? '')}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              padding: { top: 12 },
              lineNumbers: 'on',
              renderLineHighlight: 'line',
              bracketPairColorization: { enabled: true },
            }}
          />
        )}
      </div>
    </div>
  );
}

export default FileEditor;
