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

export function useFileManager(serverId?: string, initialPath = '/') {
  const [path, setPathState] = useState(() => normalizePath(initialPath));
  const [activeFile, setActiveFile] = useState<ActiveFile | null>(null);
  const [isFileLoading, setIsFileLoading] = useState(false);

  const setPath = useCallback((nextPath: string) => {
    setPathState(normalizePath(nextPath));
  }, []);

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
    // Long safety poll only — avoids 10s thrash on idle file managers.
    refetchInterval: 60_000,
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
      } catch {
        notifyError('Failed to load file contents');
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
