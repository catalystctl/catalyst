import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { ChevronDown, ChevronRight, Folder, FolderOpen, Server } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
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
    refetchInterval: 10000,
  });
  const childDirectories = useMemo(
    () => (data ? sortDirectories(data.files) : []),
    [data],
  );

  return (
    <div className="relative">
      {/* Indentation guide line */}
      {depth > 0 && (
        <div
          className="absolute top-0 bottom-0 w-px bg-border/40 dark:bg-border/20"
          style={{ left: depth * 12 + 6 }}
        />
      )}
      <div
        className={`flex items-center gap-0.5 rounded-md py-1 transition-all duration-150 ${
          isActive
            ? 'bg-primary-500/10 text-primary-600 dark:bg-primary-500/15 dark:text-primary-400 shadow-[inset_2px_0_0_0_hsl(var(--primary))]'
            : 'text-muted-foreground hover:bg-surface-2 dark:text-muted-foreground dark:hover:bg-surface-2/50'
        }`}
        style={{ paddingLeft: depth * 12 }}
      >
        <button
          type="button"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-transform duration-150 hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(entry.path);
          }}
          aria-label={isExpanded ? 'Collapse' : 'Expand'}
        >
          <motion.div
            animate={{ rotate: isExpanded ? 0 : -90 }}
            transition={{ duration: 0.15 }}
          >
            <ChevronDown className="h-3 w-3" />
          </motion.div>
        </button>
        <button
          type="button"
          className="flex flex-1 items-center gap-1.5 truncate px-1 py-0.5 text-left text-xs"
          onClick={() => onNavigate(entry.path)}
        >
          {isExpanded ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground dark:text-muted-foreground/70" />
          )}
          <span className="truncate font-medium">{entry.name}</span>
          {childDirectories.length > 0 && isExpanded && (
            <span className="ml-auto mr-1 text-[9px] text-muted-foreground/50 tabular-nums">
              {childDirectories.length}
            </span>
          )}
        </button>
      </div>
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-0.5 space-y-0.5">
              {isLoading ? (
                <div style={{ paddingLeft: (depth + 1) * 12 + 24 }} className="flex items-center gap-1.5 py-1">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary/40 animate-pulse" />
                  <span className="text-[11px] text-muted-foreground/60">Scanning…</span>
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
                <div style={{ paddingLeft: (depth + 1) * 12 + 24 }} className="text-[11px] text-muted-foreground/50 py-1">
                  Empty folder
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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
    refetchInterval: 10000,
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
      {/* Root */}
      <button
        type="button"
        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-all duration-150 ${
          normalizePath(activePath) === '/'
            ? 'bg-primary-500/10 text-primary-600 dark:bg-primary-500/15 dark:text-primary-400 shadow-[inset_2px_0_0_0_hsl(var(--primary))]'
            : 'text-muted-foreground hover:bg-surface-2 dark:text-muted-foreground dark:hover:bg-surface-2/50'
        }`}
        onClick={() => onNavigate('/')}
      >
        <Server className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="font-medium">Server Root</span>
      </button>

      {isLoading ? (
        <div className="space-y-1 px-2 py-1">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-2 py-1.5">
              <div className="h-3.5 w-3.5 rounded-sm bg-muted animate-pulse" />
              <div className="h-3 w-20 rounded-sm bg-muted animate-pulse" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="px-2 py-2 text-[11px] text-destructive">Unable to load directory tree.</div>
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
        <div className="px-2 py-2 text-[11px] text-muted-foreground/60">No folders found</div>
      )}
    </div>
  );
}

export default FileTree;
