import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, Check, Copy, Search, Trash2, X } from 'lucide-react';
import CustomConsole from '../../components/console/CustomConsole';
import { formatBytes } from '../../utils/formatters';

interface Props {
  liveMetrics: {
    cpuPercent: number;
    memoryPercent: number;
    memoryUsageMb?: number;
    networkRxBytes?: number;
    networkTxBytes?: number;
  } | null;
  liveDiskUsageMb: number | null | undefined;
  liveDiskTotalMb: number | null | undefined;
  isConnected: boolean;
  canSend: boolean;
  entries: Array<{ stream: string; data: string; id: string }>;
  send: (command: string) => void;
  clearConsole: () => void;
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
}

export default function ServerConsoleTab({
  liveMetrics,
  liveDiskUsageMb,
  liveDiskTotalMb,
  isConnected,
  canSend,
  entries,
  send,
  clearConsole,
  isLoading,
  isError,
  refetch,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const [autoScroll, setAutoScroll] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeStreams, setActiveStreams] = useState<Set<string>>(() => new Set(['stdout', 'stderr', 'system', 'stdin']));
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [copied, setCopied] = useState(false);
  const [scrollback, setScrollback] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem('console.scrollback');
      if (stored) return Number(stored);
    }
    return 1000;
  });

  // Fetch console when scrollback changes
  useEffect(() => {
    refetch().catch(() => {});
  }, [scrollback, refetch]);

  const handleSend = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!canSend) return;
      const value = inputRef.current?.value ?? '';
      const trimmed = value.trim();
      if (!trimmed) return;
      send(trimmed);
      setCommandHistory((prev) => [...prev.slice(-49), trimmed]);
      if (inputRef.current) inputRef.current.value = '';
      setHistoryIndex(-1);
      setAutoScroll(true);
    },
    [canSend, send],
  );

  // Memoize the filtered entries text for copy to avoid rebuilding on every render.
  const copyText = useMemo(
    () =>
      entries
        .filter((e) => activeStreams.has(e.stream))
        .map((e) => e.data)
        .join(''),
    [entries, activeStreams],
  );

  // Memoize search match count at top level (NOT inside conditional JSX).
  const searchMatchCount = useMemo(
    () =>
      searchQuery
        ? entries.filter(
            (e) =>
              activeStreams.has(e.stream) &&
              e.data.toLowerCase().includes(searchQuery.toLowerCase()),
          ).length
        : 0,
    [entries, activeStreams, searchQuery],
  );

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(copyText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [copyText]);

  // Ctrl+F / Escape for search
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchRef.current?.focus(), 50);
      }
      if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false);
        setSearchQuery('');
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [searchOpen]);

  const diskPercent =
    liveDiskUsageMb != null && liveDiskTotalMb
      ? ((liveDiskUsageMb / liveDiskTotalMb) * 100).toFixed(1)
      : '0.0';

  const STREAM_DOT: Record<string, string> = {
    stdout: 'bg-success',
    stderr: 'bg-danger',
    system: 'bg-info',
    stdin: 'bg-warning',
  };
  const STREAM_ACTIVE: Record<string, string> = {
    stdout: 'border-success/50 bg-success-muted text-success',
    stderr: 'border-danger/50 bg-danger-muted text-danger',
    system: 'border-info/50 bg-info-muted text-info',
    stdin: 'border-amber-500/50 bg-warning/10 text-warning',
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Resource Stats */}
      {liveMetrics && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="overflow-hidden rounded-xl border border-border/50 bg-card/80 p-4 backdrop-blur-sm transition-all duration-300 hover:shadow-md">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">CPU</span>
              <span className="text-lg font-bold tabular-nums text-foreground">{liveMetrics.cpuPercent.toFixed(1)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${Math.min(100, liveMetrics.cpuPercent)}%` }} />
            </div>
          </div>
          <div className="overflow-hidden rounded-xl border border-border/50 bg-card/80 p-4 backdrop-blur-sm transition-all duration-300 hover:shadow-md">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Memory</span>
              <span className="text-lg font-bold tabular-nums text-foreground">{liveMetrics.memoryPercent.toFixed(1)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-success transition-all duration-300" style={{ width: `${Math.min(100, liveMetrics.memoryPercent)}%` }} />
            </div>
            <div className="mt-1.5 text-[10px] text-muted-foreground">{liveMetrics.memoryUsageMb} MB</div>
          </div>
          <div className="overflow-hidden rounded-xl border border-border/50 bg-card/80 p-4 backdrop-blur-sm transition-all duration-300 hover:shadow-md">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Disk</span>
              <span className="text-lg font-bold tabular-nums text-foreground">{diskPercent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-warning transition-all duration-300" style={{ width: `${liveDiskUsageMb != null && liveDiskTotalMb ? Math.min(100, (liveDiskUsageMb / liveDiskTotalMb) * 100) : 0}%` }} />
            </div>
            <div className="mt-1.5 text-[10px] text-muted-foreground">{liveDiskUsageMb ?? 0} / {liveDiskTotalMb ?? 0} MB</div>
          </div>
          <div className="overflow-hidden rounded-xl border border-border/50 bg-card/80 p-4 backdrop-blur-sm transition-all duration-300 hover:shadow-md">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Network</span>
              <span className="text-lg font-bold tabular-nums text-foreground">↓↑</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-muted-foreground">RX (total)</span>
                <span className="font-medium text-foreground">{formatBytes(Number(liveMetrics.networkRxBytes ?? 0))}</span>
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-muted-foreground">TX (total)</span>
                <span className="font-medium text-foreground">{formatBytes(Number(liveMetrics.networkTxBytes ?? 0))}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Console */}
      <div className="flex flex-col overflow-hidden rounded-xl border border-border">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2">
          <span className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${isConnected ? 'border-success/50 text-success' : 'border-warning/30 text-warning'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${isConnected ? 'animate-pulse bg-success' : 'bg-warning'}`} />
            {isConnected ? 'Live' : 'Connecting'}
          </span>

          <div className="h-4 w-px bg-surface-3 dark:bg-surface-2" />

          {/* Stream Filters */}
          <div className="flex items-center gap-1">
            {(['stdout', 'stderr', 'system', 'stdin'] as const).map((stream) => {
              const isActive = activeStreams.has(stream);
              return (
                <button
                  key={stream}
                  type="button"
                  onClick={() =>
                    setActiveStreams((prev) => {
                      const next = new Set(prev);
                      if (next.has(stream)) {
                        if (next.size > 1) next.delete(stream);
                      } else next.add(stream);
                      return next;
                    })
                  }
                  className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-all ${isActive ? STREAM_ACTIVE[stream] : 'border-border text-muted-foreground hover:border-primary/30'}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${isActive ? STREAM_DOT[stream] : 'bg-muted-foreground'}`} />
                  {stream}
                </button>
              );
            })}
          </div>

          <div className="h-4 w-px bg-surface-3 dark:bg-surface-2" />

          {/* Search */}
          {searchOpen ? (
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1">
              <Search className="h-3 w-3 text-muted-foreground" />
              <input
                ref={searchRef}
                className="w-40 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter output…"
              />
              {searchQuery && (
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {searchMatchCount}
                </span>
              )}
              <button type="button" onClick={() => { setSearchOpen(false); setSearchQuery(''); }} className="text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => { setSearchOpen(true); setTimeout(() => searchRef.current?.focus(), 50); }} className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition-all hover:border-primary/30">
              <Search className="h-3 w-3" />
              Search
            </button>
          )}

          {/* Scrollback selector */}
          <div className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground">
            <span>Buffer</span>
            <select
              className="bg-transparent text-[11px] text-muted-foreground outline-none"
              value={scrollback}
              onChange={(e) => {
                const v = Number(e.target.value);
                setScrollback(v);
                if (typeof window !== 'undefined') window.localStorage.setItem('console.scrollback', String(v));
              }}
            >
              <option value={500}>500</option>
              <option value={1000}>1K</option>
              <option value={2000}>2K</option>
              <option value={5000}>5K</option>
            </select>
          </div>

          <div className="flex-1" />
          <span className="text-[11px] tabular-nums text-muted-foreground">{entries.length} lines</span>
          <div className="h-4 w-px bg-surface-3 dark:bg-surface-2" />

          <button type="button" onClick={() => setAutoScroll(!autoScroll)} className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-all ${autoScroll ? 'border-primary/30 bg-primary-muted text-primary' : 'border-border text-muted-foreground hover:border-primary/30'}`}>
            <ArrowDown className="h-3 w-3" />
            Auto-scroll
          </button>

          <button type="button" onClick={handleCopy} className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition-all hover:border-primary/30">
            {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>

          <button type="button" onClick={() => { clearConsole(); setAutoScroll(true); }} className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition-all hover:border-danger/30 hover:text-danger">
            <Trash2 className="h-3 w-3" />
            Clear
          </button>
        </div>

        {/* Console Output */}
        <CustomConsole
          entries={entries}
          searchQuery={searchQuery}
          scrollback={scrollback}
          autoScroll={autoScroll}
          streamFilter={activeStreams}
          isLoading={isLoading}
          isError={isError}
          onRetry={refetch}
          onUserScroll={() => setAutoScroll(false)}
          onAutoScrollResume={() => setAutoScroll(true)}
          className="h-[50vh]"
        />

        {/* Command Input */}
        <form onSubmit={handleSend} className="flex items-center gap-3 border-t border-border bg-card px-4 py-2.5">
          <span className="select-none text-sm font-bold text-primary-500">$</span>
          <input
            ref={inputRef}
            defaultValue=""
            className="w-full bg-transparent font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (commandHistory.length === 0) return;
                const next = historyIndex === -1 ? commandHistory.length - 1 : Math.max(0, historyIndex - 1);
                setHistoryIndex(next);
                if (inputRef.current) inputRef.current.value = commandHistory[next];
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (historyIndex === -1) return;
                const next = historyIndex + 1;
                if (next >= commandHistory.length) {
                  setHistoryIndex(-1);
                  if (inputRef.current) inputRef.current.value = '';
                } else {
                  setHistoryIndex(next);
                  if (inputRef.current) inputRef.current.value = commandHistory[next];
                }
              }
            }}
            placeholder={canSend ? 'Type a command… (↑↓ for history)' : 'Connect to send commands'}
            disabled={!canSend}
          />
          <button type="submit" className="rounded-lg bg-primary-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition-all hover:bg-primary-500 disabled:cursor-not-allowed disabled:opacity-50" disabled={!canSend}>
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
