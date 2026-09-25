import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowDown,
  Check,
  Copy,
  Download,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';


import XtermConsole, { type XtermConsoleHandle } from '../../components/console/XtermConsole';
import { storage } from '../../services/storage/localStorage';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StatusLed } from '../deck/primitives';
import { cn } from '@/lib/utils';
import { consoleStreamLabel } from '../../utils/constants';


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

const STREAM_COLORS: Record<string, string> = {
  stdout: 'bg-success',
  stderr: 'bg-danger',
  system: 'bg-info',
  stdin: 'bg-warning',
};

const SCROLLBACK_OPTIONS = [500, 1000, 2000] as const;


/** Tone for the stream state pill; the label is picked next to the t() call. */
function connectionTone(status?: Props['streamStatus'], isConnected?: boolean): string {
  if (status === 'reconnecting') return 'text-warning';
  if (status === 'error' || status === 'closed') return 'text-muted-foreground';
  if (status === 'connecting' || !isConnected) return 'text-warning';
  return 'text-success';
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
  const { t } = useTranslation('servers');

  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const xtermRef = useRef<XtermConsoleHandle>(null);
  const draftRef = useRef('');

  const [autoScroll, setAutoScroll] = useState(() => storage.get<boolean>('console.follow') ?? true);
  const [searchOpen, setSearchOpen] = useState(false);
  // Full-screen console: on a phone the chrome above the terminal ate half the
  // viewport, so the console can take the whole screen instead.
  const [focusMode, setFocusMode] = useState(false);
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


  const connectionLabel =
    streamStatus === 'reconnecting'
      ? t('console.connection.reconnecting')
      : streamStatus === 'error' || streamStatus === 'closed'
        ? t('console.connection.disconnected')
        : streamStatus === 'connecting' || !isConnected
          ? t('console.connection.connecting')
          : t('console.connection.live');
  const connection = { label: connectionLabel, tone: connectionTone(streamStatus, isConnected) };
  const connectionLed: 'go' | 'hazard' | 'idle' =
    streamStatus === 'error' || streamStatus === 'closed'
      ? 'idle'
      : streamStatus === 'reconnecting' || streamStatus === 'connecting' || !isConnected
        ? 'hazard'
        : 'go';
  const commandPlaceholder = !canSend
    ? streamStatus === 'reconnecting'
      ? t('console.placeholderReconnecting')
      : t('console.placeholderConnectToSend')
    : t('console.placeholderTypeCommand');

  const toggleStream = (stream: (typeof ALL_STREAMS)[number]) =>
    setActiveStreams((prev) => {
      const next = new Set(prev);
      if (next.has(stream)) {
        if (next.size > 1) next.delete(stream);
      } else {
        next.add(stream);
      }
      return next;
    });

  useEffect(() => {
    if (!focusMode) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setFocusMode(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusMode]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={cn(
          'relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
          focusMode
            ? 'fixed inset-0 z-50 h-[100dvh] w-full border-0 bg-background'
            : 'deck-panel',
        )}
      >
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border/50 bg-surface-1/40 px-2 py-1.5">
          <span className={cn('flex items-center gap-1.5 text-mini font-medium', connection.tone)}>
            <StatusLed
              tone={connectionLed}
              pulse={streamStatus !== 'error' && streamStatus !== 'closed' && isConnected}
            />
            {connection.label}
          </span>

          <div className="hidden h-3.5 w-px bg-border sm:block" />

          {/* Stream chips fit one row on desktop; on a phone four chips alone
              wrapped the toolbar onto a second line, so they collapse into a
              checkbox menu with the active count on the trigger. */}
          <div className="hidden items-center gap-1 sm:flex">
            {ALL_STREAMS.map((stream) => {
              const isActive = activeStreams.has(stream);
              return (
                <button
                  key={stream}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => toggleStream(stream)}
                  className={cn(
                    'flex h-7 items-center gap-1.5 rounded-sm border px-2 text-mini font-medium transition-colors',
                    isActive
                      ? 'border-border/70 bg-surface-2/60 text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      isActive ? STREAM_COLORS[stream] : 'bg-muted-foreground',
                    )}
                  />
                  {consoleStreamLabel(t, stream)}
                </button>
              );
            })}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t('console.tab.streams')}
                className="flex h-7 items-center gap-1.5 rounded-sm border border-border/60 px-2 text-mini text-muted-foreground transition-colors hover:text-foreground sm:hidden"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                <span className="type-numeric">{activeStreams.size}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-44">
              <DropdownMenuLabel>{t('console.tab.streams')}</DropdownMenuLabel>
              {ALL_STREAMS.map((stream) => (
                <DropdownMenuCheckboxItem
                  key={stream}
                  checked={activeStreams.has(stream)}
                  onCheckedChange={() => toggleStream(stream)}
                  onSelect={(event) => event.preventDefault()}
                >
                  <span
                    className={cn(
                      'mr-2 h-1.5 w-1.5 rounded-full',
                      activeStreams.has(stream) ? STREAM_COLORS[stream] : 'bg-muted-foreground',
                    )}
                  />
                  {consoleStreamLabel(t, stream)}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {searchOpen ? (
            <div className="flex h-7 items-center gap-1 rounded-sm border border-border/60 bg-surface-2 px-2">
              <Search className="h-3 w-3 text-muted-foreground" />
              <input
                ref={searchRef}
                className="w-32 bg-transparent text-mini text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-0 sm:w-40"
                value={searchQuery}
                aria-label={t('console.tab.findAriaLabel')}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    if (event.shiftKey) xtermRef.current?.findPrevious(searchQuery);
                    else xtermRef.current?.findNext(searchQuery);
                  }
                }}
                placeholder={t('console.tab.findPlaceholder')}
              />
              {searchQuery ? (
                <span className="type-numeric text-micro text-muted-foreground">{searchMatchCount}</span>
              ) : null}
              <button
                type="button"
                aria-label={t('console.tab.closeFind')}
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
              aria-label={t('console.tab.findAriaLabel')}
              title={t('console.tab.findTitle')}
              onClick={() => {
                setSearchOpen(true);
                window.setTimeout(() => searchRef.current?.focus(), 50);
              }}
              className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <Search className="h-3.5 w-3.5" />
            </button>
          )}

          <label className="sr-only" htmlFor="console-scrollback">
            {t('console.tab.bufferSize')}
          </label>
          <select
            id="console-scrollback"
            className="hidden h-7 rounded-sm border border-border/60 bg-transparent px-1.5 text-micro text-muted-foreground outline-none hover:border-border sm:block"
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

          <span className="type-numeric hidden text-micro text-muted-foreground sm:inline">
            {t('console.lines', { count: visibleEntries.length })}
          </span>

          <button
            type="button"
            aria-pressed={autoScroll}
            aria-label={autoScroll ? t('console.tab.followOn') : t('console.tab.followOff')}
            onClick={() => {
              const next = !autoScroll;
              setAutoScroll(next);
              storage.set('console.follow', next);
            }}
            className={cn(
              'flex h-7 items-center gap-1 rounded-sm px-2 text-mini font-medium transition-colors',
              autoScroll
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
            )}
          >
            <ArrowDown className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t('console.tab.follow')}</span>
          </button>

          {/* One control on phones, three inline on larger screens. */}
          <div className="flex items-center gap-0.5">
            <Button
              className="rounded-sm"
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={copied ? t('common:actions.copied') : t('console.tab.copyOutput')}
              onClick={() => void handleCopy()}
            >
              {copied ? <Check className="text-success" /> : <Copy />}
            </Button>
            <Button
              className="hidden rounded-sm sm:inline-flex"
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('console.tab.downloadOutput')}
              onClick={handleDownload}
            >
              <Download />
            </Button>
            <Button
              className="hidden rounded-sm sm:inline-flex"
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('console.tab.clearConsole')}
              onClick={() => {
                clearConsole();
                setAutoScroll(true);
                storage.set('console.follow', true);
              }}
            >
              <Trash2 />
            </Button>
          </div>

          <button
            type="button"
            aria-label={focusMode ? t('console.tab.collapse') : t('console.tab.expand')}
            title={focusMode ? t('console.tab.collapse') : t('console.tab.expand')}
            aria-pressed={focusMode}
            onClick={() => setFocusMode((prev) => !prev)}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-sm transition-colors',
              focusMode
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
            )}
          >
            {focusMode ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t('common:actions.more')}
                className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground sm:hidden"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuLabel className="type-numeric text-micro text-muted-foreground">
                {t('console.lines', { count: visibleEntries.length })}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{t('console.tab.bufferSize')}</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={String(scrollback)}
                onValueChange={(value) => {
                  const next = Number(value);
                  setScrollback(next);
                  storage.set('console.scrollback', next);
                }}
              >
                {SCROLLBACK_OPTIONS.map((option) => (
                  <DropdownMenuRadioItem
                    key={option}
                    value={String(option)}
                    onSelect={(event) => event.preventDefault()}
                    className="type-numeric"
                  >
                    {option === 1000 ? '1K' : option === 2000 ? '2K' : option}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void handleCopy()}>
                <Copy className="mr-2 h-3.5 w-3.5" />
                {t('console.tab.copyOutput')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => handleDownload()}>
                <Download className="mr-2 h-3.5 w-3.5" />
                {t('console.tab.downloadOutput')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  clearConsole();
                  setAutoScroll(true);
                  storage.set('console.follow', true);
                }}
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                {t('console.tab.clearConsole')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
          className="min-h-0 flex-1"
        />

        {!autoScroll && (
          <button
            type="button"
            onClick={() => {
              setAutoScroll(true);
              storage.set('console.follow', true);
            }}
            className="absolute bottom-20 right-3 z-10 flex h-8 items-center gap-1.5 rounded-sm border border-border/70 bg-card px-2.5 text-mini text-foreground shadow-elevated transition-colors hover:border-primary/50"
          >
            <ArrowDown className="h-3.5 w-3.5" />
            {t('console.tab.follow')}
          </button>
        )}

        <form
          onSubmit={handleSend}
          className="flex items-center gap-2 border-t border-border/50 bg-surface-1/40 px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
        >
          <span className="select-none font-mono text-sm font-semibold text-primary" aria-hidden>
            $
          </span>
          <input
            ref={inputRef}
            defaultValue=""
            aria-label={t('console.tab.commandInput')}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="send"
            className="h-8 w-full bg-transparent font-mono text-mini text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm"
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
            {t('console.send')}
          </Button>
        </form>
      </div>
    </div>
  );
}

