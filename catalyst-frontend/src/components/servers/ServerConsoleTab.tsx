import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowDownLeft, ArrowUpRight, Check, Copy, Search, Trash2, X } from 'lucide-react';
import CustomConsole from '../../components/console/CustomConsole';
import { formatBytes } from '../../utils/formatters';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

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

const ALL_STREAMS = ['stdout', 'stderr', 'system', 'stdin'] as const;

const STREAM_STYLES: Record<string, { dot: string; active: string; inactive: string }> = {
  stdout: {
    dot: 'bg-success/50',
    active: 'bg-success/50/15 text-success dark:text-success border-success/30',
    inactive: 'border-transparent text-muted-foreground hover:bg-surface-2',
  },
  stderr: {
    dot: 'bg-destructive/50',
    active: 'bg-destructive/50/15 text-destructive dark:text-destructive border-destructive/30',
    inactive: 'border-transparent text-muted-foreground hover:bg-surface-2',
  },
  system: {
    dot: 'bg-sky-500',
    active: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30',
    inactive: 'border-transparent text-muted-foreground hover:bg-surface-2',
  },
  stdin: {
    dot: 'bg-warning/50',
    active: 'bg-warning/50/15 text-warning dark:text-warning border-warning/30',
    inactive: 'border-transparent text-muted-foreground hover:bg-surface-2',
  },
};

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
  const [activeStreams, setActiveStreams] = useState<Set<string>>(() => new Set(ALL_STREAMS));
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

  const copyText = useMemo(
    () =>
      entries
        .filter((e) => activeStreams.has(e.stream))
        .map((e) => e.data)
        .join(''),
    [entries, activeStreams],
  );

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

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-row flex-nowrap gap-3 items-stretch">
        {/* Resource Stats */}
        <div className="flex flex-col gap-2 self-stretch w-44 lg:w-52 shrink-0">
          {liveMetrics ? (
            <>
              <StatCard
                label="CPU"
                value={`${liveMetrics.cpuPercent.toFixed(1)}%`}
                percent={liveMetrics.cpuPercent}
                color="text-primary"
                strokeColor="stroke-primary"
              />
              <StatCard
                label="Memory"
                value={`${liveMetrics.memoryPercent.toFixed(1)}%`}
                percent={liveMetrics.memoryPercent}
                color="text-success"
                strokeColor="stroke-emerald-500"
                subtext={`${liveMetrics.memoryUsageMb ?? 0} MB`}
              />
              <StatCard
                label="Disk"
                value={`${diskPercent}%`}
                percent={liveDiskUsageMb != null && liveDiskTotalMb ? (liveDiskUsageMb / liveDiskTotalMb) * 100 : 0}
                color="text-warning"
                strokeColor="stroke-amber-500"
                subtext={`${liveDiskUsageMb ?? 0} / ${liveDiskTotalMb ?? 0} MB`}
              />
              <div className="flex flex-col justify-center gap-3 rounded-lg border border-border bg-card px-3 py-2 md:flex-1 md:justify-center md:gap-4 min-h-0">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Network</span>
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success/50/10 text-success">
                    <ArrowDownLeft className="h-3 w-3" />
                  </span>
                  <div className="flex min-w-0 flex-col">
                    <span className="text-[10px] text-muted-foreground">RX</span>
                    <span className="font-medium tabular-nums text-foreground">{formatBytes(Number(liveMetrics.networkRxBytes ?? 0))}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-500/10 text-sky-500">
                    <ArrowUpRight className="h-3 w-3" />
                  </span>
                  <div className="flex min-w-0 flex-col">
                    <span className="text-[10px] text-muted-foreground">TX</span>
                    <span className="font-medium tabular-nums text-foreground">{formatBytes(Number(liveMetrics.networkTxBytes ?? 0))}</span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <StatSkeleton label="CPU" />
              <StatSkeleton label="Memory" />
              <StatSkeleton label="Disk" />
              <div className="flex flex-col justify-center gap-3 rounded-lg border border-border bg-card px-3 py-2 md:flex-1 md:justify-center md:gap-4 min-h-0">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Network</span>
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success/50/10 text-success">
                    <ArrowDownLeft className="h-3 w-3" />
                  </span>
                  <div className="flex min-w-0 flex-col">
                    <span className="text-[10px] text-muted-foreground">RX</span>
                    <span className="inline-block h-3 w-12 animate-pulse rounded bg-surface-3" />
                  </div>
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-500/10 text-sky-500">
                    <ArrowUpRight className="h-3 w-3" />
                  </span>
                  <div className="flex min-w-0 flex-col">
                    <span className="text-[10px] text-muted-foreground">TX</span>
                    <span className="inline-block h-3 w-12 animate-pulse rounded bg-surface-3" />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Console */}
        <div className="flex flex-col overflow-hidden rounded-lg border border-border flex-1 min-w-0">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-card px-2 py-1.5">
            {/* Left: Status + Streams */}
            <div className="flex items-center gap-1.5">
              <span className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${isConnected ? 'text-success dark:text-success' : 'text-warning dark:text-warning'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${isConnected ? 'animate-pulse bg-success/50' : 'bg-warning/50'}`} />
                {isConnected ? 'Live' : 'Connecting'}
              </span>

              <div className="h-3.5 w-px bg-border" />

              {/* Stream toggles */}
              {ALL_STREAMS.map((stream) => {
                const isActive = activeStreams.has(stream);
                const styles = STREAM_STYLES[stream];
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
                    className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium transition-colors ${isActive ? styles.active : styles.inactive}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${isActive ? styles.dot : 'bg-muted-foreground'}`} />
                    {stream}
                  </button>
                );
              })}
            </div>

            {/* Center: Search */}
            {searchOpen ? (
              <div className="flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-0.5">
                <Search className="h-3 w-3 text-muted-foreground" />
                <input
                  ref={searchRef}
                  className="w-32 bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted-foreground sm:w-40"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter…"
                />
                {searchQuery ? (
                  <span className="text-[10px] tabular-nums text-muted-foreground">{searchMatchCount}</span>
                ) : null}
                <button
                  type="button"
                  onClick={() => { setSearchOpen(false); setSearchQuery(''); }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => { setSearchOpen(true); setTimeout(() => searchRef.current?.focus(), 50); }}
                    className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                  >
                    <Search className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Search (Ctrl+F)</TooltipContent>
              </Tooltip>
            )}

            {/* Buffer select */}
            <select
              className="h-6 rounded border border-border bg-transparent px-1.5 text-[10px] text-muted-foreground outline-none hover:border-muted-foreground/40"
              value={scrollback}
              onChange={(e) => {
                const v = Number(e.target.value);
                setScrollback(v);
                if (typeof window !== 'undefined') window.localStorage.setItem('console.scrollback', String(v));
              }}
              title="Buffer size"
            >
              <option value={500}>500</option>
              <option value={1000}>1K</option>
              <option value={2000}>2K</option>
              <option value={5000}>5K</option>
            </select>

            <div className="flex-1" />

            {/* Right: Meta + Actions */}
            <span className="hidden text-[10px] tabular-nums text-muted-foreground sm:inline">{entries.length} lines</span>

            <div className="hidden h-3.5 w-px bg-border sm:block" />

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setAutoScroll(!autoScroll)}
                  className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${autoScroll ? 'text-primary hover:bg-primary/10' : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground'}`}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{autoScroll ? 'Auto-scroll on' : 'Auto-scroll off'}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{copied ? 'Copied!' : 'Copy output'}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => { clearConsole(); setAutoScroll(true); }}
                  className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/50/10 hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Clear console</TooltipContent>
            </Tooltip>
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
            className="h-[50vh] min-h-[280px]"
          />

          {/* Command Input */}
          <form onSubmit={handleSend} className="flex items-center gap-2 border-t border-border bg-card px-3 py-2">
            <span className="select-none font-mono text-sm font-bold text-primary">$</span>
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
            <button
              type="submit"
              className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canSend}
            >
              Send
            </button>
          </form>
        </div>
      </div>
    </TooltipProvider>
  );
}

// ── Stat card with ring gauge ──

function StatCard({
  label,
  value,
  percent,
  color,
  strokeColor,
  subtext,
}: {
  label: string;
  value: string;
  percent: number;
  color: string;
  strokeColor: string;
  subtext?: string;
}) {
  const clamped = Math.min(100, Math.max(0, percent));
  const r = 16;
  const c = 2 * Math.PI * r;
  const dash = c - (clamped / 100) * c;

  return (
    <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 md:flex-1">
      {/* Mobile: horizontal compact */}
      <div className="flex w-full items-center justify-between md:hidden">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className={`text-sm font-bold tabular-nums ${color}`}>{value}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3 md:hidden">
        <div className={`h-full rounded-full ${strokeColor.replace('stroke-', 'bg-')} transition-all duration-300`} style={{ width: `${clamped}%` }} />
      </div>
      {subtext && <span className="w-full text-[10px] text-muted-foreground md:hidden">{subtext}</span>}

      {/* Desktop: ring gauge */}
      <div className="hidden flex-col items-center justify-center gap-2 md:flex md:flex-1">
        <div className="relative">
          <svg width="72" height="72" viewBox="0 0 36 36" className="-rotate-90">
            <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" className="text-surface-3" strokeWidth="3" />
            <circle
              cx="18"
              cy="18"
              r={r}
              fill="none"
              className={`${strokeColor} transition-all duration-500`}
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={dash}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`text-sm font-bold tabular-nums ${color}`}>{value}</span>
          </div>
        </div>
        <div className="text-center">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
          {subtext && <p className="text-[10px] tabular-nums text-muted-foreground">{subtext}</p>}
        </div>
      </div>
    </div>
  );
}

// ── Skeleton stat card ──

function StatSkeleton({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 md:flex-1">
      {/* Mobile */}
      <div className="flex w-full items-center justify-between md:hidden">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className="inline-block h-4 w-10 animate-pulse rounded bg-surface-3" />
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3 md:hidden" />

      {/* Desktop */}
      <div className="hidden flex-col items-center justify-center gap-2 md:flex md:flex-1">
        <div className="relative">
          <svg width="72" height="72" viewBox="0 0 36 36" className="-rotate-90">
            <circle cx="18" cy="18" r="16" fill="none" stroke="currentColor" className="text-surface-3" strokeWidth="3" />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="inline-block h-3.5 w-10 animate-pulse rounded bg-surface-3" />
          </div>
        </div>
        <div className="text-center">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        </div>
      </div>
    </div>
  );
}
