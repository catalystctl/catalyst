import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@/csync';
import { qk } from '../lib/queryKeys';
import { filesApi } from '../services/api/files';
import type { FileEntry } from '../types/file';
import { notifyError } from '../utils/notify';
import { normalizePath } from '../utils/filePaths';
import { reportSystemError } from '../services/api/systemErrors';

const EMPTY_FILES: FileEntry[] = [];

type ActiveFile = {
  path: string;
  name: string;
  content: string;
  originalContent: string;
};

/**
 * Files-tab state. `path` can be controlled (the URL owns it in the panel, so
 * switching tabs and coming back restores the folder); it falls back to local
 * state where no URL is available (tests, embedded explorers).
 */
export function useFileManager(
  serverId?: string,
  options: { path?: string; onPathChange?: (next: string) => void } = {},
) {
  const { path: controlledPath, onPathChange } = options;
  const [localPath, setLocalPath] = useState('/');
  const path = normalizePath(controlledPath ?? localPath);
  const [activeFile, setActiveFile] = useState<ActiveFile | null>(null);
  const [isFileLoading, setIsFileLoading] = useState(false);

  const setPath = useCallback(
    (nextPath: string) => {
      const normalized = normalizePath(nextPath);
      if (onPathChange) onPathChange(normalized);
      else setLocalPath(normalized);
    },
    [onPathChange],
  );

  const listQuery = useQuery({
    queryKey: qk.files(serverId!, path),
    queryFn: () => {
      if (!serverId) {
        reportSystemError({ level: 'error', component: 'useFileManager', message: 'missing server id', metadata: { context: 'list files query' } });
        throw new Error('missing server id');
      }
      return filesApi.list(serverId, path);
    },
    enabled: Boolean(serverId),
    // server_files_changed SSE (useServerStateUpdates) invalidates file lists.
    // P1-20: 30s safety poll — a missed event left the listing stale for a minute.
    refetchInterval: 30_000,
    staleTime: 30_000,
    refetchIntervalInBackground: false,
  });

  const openFile = useCallback(
    async (entry: FileEntry) => {
      if (!serverId) return;
      setIsFileLoading(true);
      try {
        const content = await filesApi.readText(serverId, entry.path);
        setActiveFile({
          path: entry.path,
          name: entry.name,
          content,
          originalContent: content,
        });
      } catch (err) {
        notifyError(err);
      } finally {
        setIsFileLoading(false);
      }
    },
    [serverId],
  );

  const updateActiveContent = useCallback((content: string) => {
    setActiveFile((prev) => (prev ? { ...prev, content } : prev));
  }, []);

  const markActiveSaved = useCallback(() => {
    setActiveFile((prev) => (prev ? { ...prev, originalContent: prev.content } : prev));
  }, []);

  const closeActiveFile = useCallback(() => {
    setActiveFile(null);
  }, []);

  const isDirty = useMemo(
    () => (activeFile ? activeFile.content !== activeFile.originalContent : false),
    [activeFile],
  );

  return {
    path,
    setPath,
    files: listQuery.data?.files ?? EMPTY_FILES,
    message: listQuery.data?.message,
    isLoading: listQuery.isLoading,
    isError: listQuery.isError,
    refetch: listQuery.refetch,
    activeFile,
    isFileLoading,
    isDirty,
    openFile,
    updateActiveContent,
    markActiveSaved,
    closeActiveFile,
  } as const;
}
