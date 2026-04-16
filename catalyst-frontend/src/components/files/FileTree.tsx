import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react';
import { filesApi } from '../../services/api/files';
import type { FileEntry } from '../../types/file';
import { normalizePath } from '../../utils/filePaths';

type Props = {
  serverId: string;
  activePath: string;
  onNavigate: (path: string) => void;
};

const sortDirectories = (entries: FileEntry[]) =>
  entries.filter((entry) => entry.isDirectory).sort((a, b) => a.name.localeCompare(b.name));

type NodeProps = {
  serverId: string;
  entry: FileEntry;
  depth: number;
  activePath: string;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onNavigate: (path: string) => void;
};

function FileTreeNode({ serverId, entry, depth, activePath, expanded, onToggle, onNavigate }: NodeProps) {
  const isExpanded = expanded.has(entry.path);
  const isActive = normalizePath(activePath) === entry.path;
  const { data, isLoading } = useQuery({
    queryKey: qk.files(serverId, entry.path),
    queryFn: () => filesApi.list(serverId, entry.path),
    enabled: Boolean(serverId) && isExpanded,
    refetchOnWindowFocus: false,
  });
  const childDirectories = useMemo(
    () => (data ? sortDirectories(data.files) : []),
    [data],
  );

  return (
    <div>
      <div
        className={`flex items-center gap-1 rounded-md py-0.5 ${
          isActive
            ? 'bg-primary-500/10 text-primary-600 dark:bg-primary-500/15 dark:text-primary-400'
            : 'text-muted-foreground hover:bg-surface-2 dark:text-muted-foreground dark:hover:bg-surface-2/50'
        }`}
        style={{ paddingLeft: depth * 12 }}
      >
        <button
          type="button"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground dark:text-muted-foreground"
          onClick={() => onToggle(entry.path)}
          aria-label={isExpanded ? 'Collapse' : 'Expand'}
        >
          {isExpanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
        </button>
        <button
          type="button"
          className="flex flex-1 items-center gap-1.5 truncate px-1 py-0.5 text-left text-xs"
          onClick={() => onNavigate(entry.path)}
        >
          {isExpanded ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary-500" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground dark:text-muted-foreground" />
          )}
          <span className="truncate">{entry.name}</span>
        </button>
      </div>
      {isExpanded && (
        <div className="mt-0.5 space-y-0.5">
          {isLoading ? (
            <div style={{ paddingLeft: (depth + 1) * 12 + 24 }} className="text-[11px] text-muted-foreground dark:text-muted-foreground">
              Loading...
            </div>
          ) : childDirectories.length ? (
            childDirectories.map((child) => (
              <FileTreeNode
                key={child.path}
                serverId={serverId}
                entry={child}
                depth={depth + 1}
                activePath={activePath}
                expanded={expanded}
                onToggle={onToggle}
                onNavigate={onNavigate}
              />
            ))
          ) : (
            <div style={{ paddingLeft: (depth + 1) * 12 + 24 }} className="text-[11px] text-muted-foreground dark:text-muted-foreground">
              No subfolders
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FileTree({ serverId, activePath, onNavigate }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['/']));
  const { data, isLoading, isError } = useQuery({
    queryKey: qk.files(serverId, '/'),
    queryFn: () => filesApi.list(serverId, '/'),
    enabled: Boolean(serverId),
    refetchOnWindowFocus: false,
  });

  const directories = useMemo(() => (data ? sortDirectories(data.files) : []), [data]);

  const handleToggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div className="space-y-0.5 text-sm">
      <button
        type="button"
        className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs ${
          normalizePath(activePath) === '/'
            ? 'bg-primary-500/10 text-primary-600 dark:bg-primary-500/15 dark:text-primary-400'
            : 'text-muted-foreground hover:bg-surface-2 dark:text-muted-foreground dark:hover:bg-surface-2/50'
        }`}
        onClick={() => onNavigate('/')}
      >
        <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary-500" />
        <span>/</span>
      </button>
      {isLoading ? (
        <div className="px-2 text-[11px] text-muted-foreground dark:text-muted-foreground">Loading...</div>
      ) : isError ? (
        <div className="px-2 text-[11px] text-rose-500">Unable to load.</div>
      ) : directories.length ? (
        directories.map((entry) => (
          <FileTreeNode
            key={entry.path}
            serverId={serverId}
            entry={entry}
            depth={1}
            activePath={activePath}
            expanded={expanded}
            onToggle={handleToggle}
            onNavigate={onNavigate}
          />
        ))
      ) : (
        <div className="px-2 text-[11px] text-muted-foreground dark:text-muted-foreground">No folders found.</div>
      )}
    </div>
  );
}

export default FileTree;
