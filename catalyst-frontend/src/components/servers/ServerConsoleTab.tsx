import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, Check, Copy, Download, Search, Trash2, X } from 'lucide-react';


import XtermConsole, { type XtermConsoleHandle } from '../../components/console/XtermConsole';
import { storage } from '../../services/storage/localStorage';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';


interface Props {
  liveMetrics: {
    cpuPercent: number;
    memoryPercent: number;
    memoryUsageMb?: number;
    memoryLimitMb?: number;
    networkRxBytes?: number;
    networkTxBytes?: number;
  } | null;
  liveDiskUsageMb: number | null | undefined;
  liveDiskTotalMb: number | null | undefined;
  allocatedMemoryMb?: number | null;
  allocatedDiskMb?: number | null;
  isConnected: boolean;
  streamStatus?: 'connected' | 'connecting' | 'reconnecting' | 'closed' | 'error';
  canSend: boolean;
  entries: Array<{ stream: string; data: string; id: string }>;
  send: (command: string) => void;
  clearConsole: () => void;
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
}

const ALL_STREAMS = ['stdout', 'stderr', 'system', 'stdin'] as const;

const STREAM_COLORS: Record<string, { dot: string; active: string; inactive: string }> = {
  stdout: {
    dot: 'bg-success',
    active: 'border-success/50 bg-success-muted text-success',
    inactive: 'border-border/30 text-muted-foreground hover:border-primary/30',
  },
  stderr: {
    dot: 'bg-danger',
    active: 'border-danger/50 bg-danger-muted text-danger',
    inactive: 'border-border/30 text-muted-foreground hover:border-primary/30',
  },
  system: {
    dot: 'bg-info',
    active: 'border-info/50 bg-info-muted text-info',
    inactive: 'border-border/30 text-muted-foreground hover:border-primary/30',
  },
  stdin: {
    dot: 'bg-warning',
    active: 'border-warning/50 bg-warning-muted text-warning',
    inactive: 'border-border/30 text-muted-foreground hover:border-primary/30',
  },
};

const SCROLLBACK_OPTIONS = [500, 1000, 2000] as const;


function connectionLabel(status?: Props['streamStatus'], isConnected?: boolean) {
  if (status === 'reconnecting') return { label: 'Reconnecting', tone: 'text-warning' };
  if (status === 'error' || status === 'closed') return { label: 'Disconnected', tone: 'text-muted-foreground' };
  if (status === 'connecting' || !isConnected) return { label: 'Connecting', tone: 'text-warning' };
  return { label: 'Live', tone: 'text-success' };
}

export default function ServerConsoleTab({
  isConnected,
  streamStatus,
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
  const xtermRef = useRef<XtermConsoleHandle>(null);
  const draftRef = useRef('');

  const [autoScroll, setAutoScroll] = useState(() => storage.get<boolean>('console.follow') ?? true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeStreams, setActiveStreams] = useState<Set<string>>(() => new Set(ALL_STREAMS));
  const [commandHistory, setCommandHistory] = useState<string[]>(() => storage.get<string[]>('console.history') ?? []);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [copied, setCopied] = useState(false);


  const [scrollback, setScrollback] = useState(() => {
    const stored = storage.get<number>('console.scrollback');
    if (stored && SCROLLBACK_OPTIONS.includes(stored as (typeof SCROLLBACK_OPTIONS)[number])) return stored;
    return 1000;
  });


  const handleSend = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!canSend) return;
      const value = inputRef.current?.value ?? '';
      const trimmed = value.trim();
      if (!trimmed) return;
      void Promise.resolve(send(trimmed)).catch(() => undefined);
      setCommandHistory((prev) => {
        const next = [...prev.filter((item) => item !== trimmed), trimmed].slice(-50);
        storage.set('console.history', next);
        return next;
      });
      if (inputRef.current) inputRef.current.value = '';
      draftRef.current = '';
      setHistoryIndex(-1);
      setAutoScroll(true);
      storage.set('console.follow', true);
    },
    [canSend, send],
  );

  const visibleEntries = useMemo(
    () => entries.filter((entry) => activeStreams.has(entry.stream)),
    [entries, activeStreams],
  );

  const copyText = useMemo(
    () => visibleEntries.map((entry) => entry.data).join(''),
    [visibleEntries],
  );

  const searchMatchCount = useMemo(
    () =>
      searchQuery
        ? visibleEntries.filter((entry) => entry.data.toLowerCase().includes(searchQuery.toLowerCase())).length
        : 0,
    [visibleEntries, searchQuery],
  );

  const handleCopy = useCallback(async () => {
    const selected = xtermRef.current?.getSelection().trim();
    try {
      await navigator.clipboard.writeText(selected || copyText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [copyText]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([copyText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `console-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.log`;
    link.click();
    URL.revokeObjectURL(url);
  }, [copyText]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'f') {
        const target = event.target as HTMLElement | null;
        if (target?.closest('.xterm-console-host') || target === inputRef.current || target === searchRef.current) {
          event.preventDefault();
          setSearchOpen(true);
          window.setTimeout(() => searchRef.current?.focus(), 50);
        }
      }
      if (event.key === 'Escape' && searchOpen) {
        setSearchOpen(false);
        setSearchQuery('');
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [searchOpen]);


  const connection = connectionLabel(streamStatus, isConnected);
  const commandPlaceholder = !canSend
    ? streamStatus === 'reconnecting'
      ? 'Reconnecting…'
      : 'Connect to send commands'
    : 'Type a command…';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/50 bg-card">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border/70 bg-card px-2 py-1.5">



          <span className={cn('flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium', connection.tone)}>
            <span className={cn('h-1.5 w-1.5 rounded-full', isConnected ? 'animate-pulse bg-success' : 'bg-warning')} />
            {connection.label}
          </span>

          <div className="h-3.5 w-px bg-border" />

          {ALL_STREAMS.map((stream) => {
            const isActive = activeStreams.has(stream);
            const styles = STREAM_COLORS[stream];
            return (
              <button
                key={stream}
                type="button"
                aria-pressed={isActive}
                onClick={() =>
                  setActiveStreams((prev) => {
                    const next = new Set(prev);
                    if (next.has(stream)) {
                      if (next.size > 1) next.delete(stream);
                    } else next.add(stream);
                    return next;
                  })
                }
                className={cn('flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium transition-colors', isActive ? styles.active : styles.inactive)}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', isActive ? styles.dot : 'bg-muted-foreground')} />
                {stream}
              </button>
            );
          })}

          {searchOpen ? (
            <div className="flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-0.5">
              <Search className="h-3 w-3 text-muted-foreground" />
              <input
                ref={searchRef}
                className="w-32 bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-0 sm:w-40"
                value={searchQuery}
                aria-label="Find in console"
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    if (event.shiftKey) xtermRef.current?.findPrevious(searchQuery);
                    else xtermRef.current?.findNext(searchQuery);
                  }
                }}
                placeholder="Find…"
              />
              {searchQuery ? (
                <span className="type-numeric text-[10px] text-muted-foreground">{searchMatchCount}</span>
              ) : null}
              <button
                type="button"
                aria-label="Close find"
                onClick={() => {
                  setSearchOpen(false);
                  setSearchQuery('');
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              aria-label="Find in console"
              title="Find (Ctrl+F)"
              onClick={() => {
                setSearchOpen(true);
                window.setTimeout(() => searchRef.current?.focus(), 50);
              }}
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <Search className="h-3.5 w-3.5" />
            </button>
          )}

          <label className="sr-only" htmlFor="console-scrollback">
            Buffer size
          </label>
          <select
            id="console-scrollback"
            className="h-6 rounded-md border border-border bg-transparent px-1.5 text-[10px] text-muted-foreground outline-none hover:border-border"
            value={scrollback}
            onChange={(event) => {
              const value = Number(event.target.value);
              setScrollback(value);
              storage.set('console.scrollback', value);
            }}
          >
            {SCROLLBACK_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option === 1000 ? '1K' : option === 2000 ? '2K' : option}
              </option>
            ))}
          </select>

          <div className="flex-1" />

          <span className="type-numeric text-[10px] text-muted-foreground">{visibleEntries.length} lines</span>

          <button
            type="button"
            aria-pressed={autoScroll}
            aria-label={autoScroll ? 'Follow output on' : 'Follow output off'}
            onClick={() => {
              const next = !autoScroll;
              setAutoScroll(next);
              storage.set('console.follow', next);
            }}
            className={cn(
              'flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium transition-colors',
              autoScroll ? 'bg-primary-muted text-primary' : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
            )}
          >
            <ArrowDown className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Follow</span>
          </button>

          <Button type="button" variant="ghost" size="icon-sm" aria-label={copied ? 'Copied' : 'Copy output'} onClick={() => void handleCopy()}>
            {copied ? <Check className="text-success" /> : <Copy />}
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Download output" onClick={handleDownload}>
            <Download />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Clear console"
            onClick={() => {
              clearConsole();
              setAutoScroll(true);
              storage.set('console.follow', true);
            }}
          >
            <Trash2 />
          </Button>
        </div>

        <XtermConsole
          ref={xtermRef}
          entries={entries}
          searchQuery={searchQuery}
          scrollback={scrollback}
          autoScroll={autoScroll}
          streamFilter={activeStreams}
          isLoading={isLoading}
          isError={isError}
          onRetry={refetch}
          onUserScroll={() => {
            setAutoScroll(false);
            storage.set('console.follow', false);
          }}
          onAutoScrollResume={() => {
            setAutoScroll(true);
            storage.set('console.follow', true);
          }}
          className="min-h-[280px] flex-1"
        />

        <form onSubmit={handleSend} className="flex items-center gap-2 border-t border-border/70 bg-card px-3 py-2">
          <span className="select-none font-mono text-sm font-semibold text-primary" aria-hidden>
            $
          </span>
          <input
            ref={inputRef}
            defaultValue=""
            aria-label="Console command"
            className="w-full bg-transparent font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50"
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
              if (event.key === 'Tab' && commandHistory.length > 0) {
                const prefix = inputRef.current?.value ?? '';
                const match = [...commandHistory].reverse().find((item) => item.startsWith(prefix));
                if (match) {
                  event.preventDefault();
                  if (inputRef.current) inputRef.current.value = match;
                }
                return;
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                if (commandHistory.length === 0) return;
                if (historyIndex === -1) draftRef.current = inputRef.current?.value ?? '';
                const next = historyIndex === -1 ? commandHistory.length - 1 : Math.max(0, historyIndex - 1);
                setHistoryIndex(next);
                if (inputRef.current) inputRef.current.value = commandHistory[next];
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                if (historyIndex === -1) return;
                const next = historyIndex + 1;
                if (next >= commandHistory.length) {
                  setHistoryIndex(-1);
                  if (inputRef.current) inputRef.current.value = draftRef.current;
                } else {
                  setHistoryIndex(next);
                  if (inputRef.current) inputRef.current.value = commandHistory[next];
                }
              }
            }}
            placeholder={commandPlaceholder}
            disabled={!canSend}
          />
          <Button type="submit" size="sm" disabled={!canSend}>
            Send
          </Button>
        </form>
      </div>
    </div>
  );
}

