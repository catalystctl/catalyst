import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { qk } from '../lib/queryKeys';
import { filesApi } from '../services/api/files';
import type { FileEntry } from '../types/file';
import { notifyError } from '../utils/notify';
import { normalizePath } from '../utils/filePaths';

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
      if (!serverId) throw new Error('missing server id');
      return filesApi.list(serverId, path);
    },
    enabled: Boolean(serverId),
    // Refresh files when user switches back to the tab (server state may have changed)
    refetchOnWindowFocus: true,
    // Treat file listings as stale after 30s so refetchOnWindowFocus triggers refresh
    staleTime: 30_000,
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
    files: listQuery.data?.files ?? [],
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
