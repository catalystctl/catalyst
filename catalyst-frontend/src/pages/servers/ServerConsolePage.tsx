import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowDown, Check, Copy, Search, Trash2, X } from 'lucide-react';
import ServerStatusBadge from '../../components/servers/ServerStatusBadge';
import CustomConsole from '../../components/console/CustomConsole';
import { useConsole } from '../../hooks/useConsole';
import { useServer } from '../../hooks/useServer';

const ALL_STREAMS = ['stdout', 'stderr', 'system', 'stdin'] as const;
const STREAM_COLORS: Record<string, { dot: string; active: string; inactive: string }> = {
  stdout: {
    dot: 'bg-emerald-400',
    active: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    inactive: 'border-slate-300 text-slate-500 hover:border-slate-400 dark:border-slate-700 dark:hover:border-slate-600',
  },
  stderr: {
    dot: 'bg-rose-400',
    active: 'border-rose-500/50 bg-rose-500/10 text-rose-600 dark:text-rose-400',
    inactive: 'border-slate-300 text-slate-500 hover:border-slate-400 dark:border-slate-700 dark:hover:border-slate-600',
  },
  system: {
    dot: 'bg-sky-400',
    active: 'border-sky-500/50 bg-sky-500/10 text-sky-600 dark:text-sky-400',
    inactive: 'border-slate-300 text-slate-500 hover:border-slate-400 dark:border-slate-700 dark:hover:border-slate-600',
  },
  stdin: {
    dot: 'bg-amber-400',
    active: 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400',
    inactive: 'border-slate-300 text-slate-500 hover:border-slate-400 dark:border-slate-700 dark:hover:border-slate-600',
  },
};

function ServerConsolePage() {
  const { serverId } = useParams();
  const { data: server } = useServer(serverId);
  const { entries, send, isConnected, isLoading, isError, refetch, clear } = useConsole(serverId);

  const [command, setCommand] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeStreams, setActiveStreams] = useState<Set<string>>(() => new Set(ALL_STREAMS));
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [copied, setCopied] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const title = server?.name ?? serverId ?? 'Unknown server';
  const isSuspended = server?.status === 'suspended';
  const canSend = Boolean(serverId) && isConnected && server?.status === 'running' && !isSuspended;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAutoScroll(true);
  }, [serverId]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSend || !command.trim()) return;
    send(command);
    setCommandHistory((prev) => [...prev.slice(-49), command]);
    setCommand('');
    setHistoryIndex(-1);
    setAutoScroll(true);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length === 0) return;
      const next = historyIndex === -1 ? commandHistory.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(next);
      setCommand(commandHistory[next]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex === -1) return;
      const next = historyIndex + 1;
      if (next >= commandHistory.length) {
        setHistoryIndex(-1);
        setCommand('');
      } else {
        setHistoryIndex(next);
        setCommand(commandHistory[next]);
      }
    }
  };

  const toggleStream = (stream: string) => {
    setActiveStreams((prev) => {
      const next = new Set(prev);
      if (next.has(stream)) {
        if (next.size > 1) next.delete(stream);
      } else {
        next.add(stream);
      }
      return next;
    });
  };

  const handleCopy = async () => {
    const text = entries
      .filter((e) => activeStreams.has(e.stream))
      .map((e) => e.data)
      .join('');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClear = () => {
    clear();
    setAutoScroll(true);
  };

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

  return (
    <div className="flex h-[calc(100vh-10rem)] flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Console</h1>
            <span className="text-lg text-slate-300 dark:text-slate-700">—</span>
            <span className="text-lg font-medium text-slate-600 dark:text-slate-300">{title}</span>
            {server?.status ? <ServerStatusBadge status={server.status} /> : null}
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Real-time output and command input
          </p>
          {isSuspended ? (
            <div className="mt-2 rounded-md border border-rose-200 bg-rose-100/60 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
              Server suspended — console input disabled.
            </div>
          ) : null}
        </div>
      </div>

      {/* Console Container */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 shadow-surface-light dark:shadow-surface-dark dark:border-slate-800">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
          {/* Connection Status */}
          <span
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
              isConnected
                ? 'border-emerald-200 text-emerald-600 dark:border-emerald-500/30 dark:text-emerald-400'
                : 'border-amber-200 text-amber-600 dark:border-amber-500/30 dark:text-amber-400'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${isConnected ? 'animate-pulse bg-emerald-500' : 'bg-amber-500'}`}
            />
            {isConnected ? 'Live' : 'Connecting'}
          </span>

          <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />

          {/* Stream Filters */}
          <div className="flex items-center gap-1">
            {ALL_STREAMS.map((stream) => {
              const colors = STREAM_COLORS[stream];
              const isActive = activeStreams.has(stream);
              return (
                <button
                  key={stream}
                  type="button"
                  onClick={() => toggleStream(stream)}
                  className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-all ${
                    isActive ? colors.active : colors.inactive
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${isActive ? colors.dot : 'bg-slate-300 dark:bg-slate-600'}`} />
                  {stream}
                </button>
              );
            })}
          </div>

          <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />

          {/* Search */}
          {searchOpen ? (
            <div className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 dark:border-slate-700 dark:bg-slate-800">
              <Search className="h-3 w-3 text-slate-400" />
              <input
                ref={searchRef}
                className="w-40 bg-transparent text-xs text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-200"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter output…"
              />
              {searchQuery ? (
                <span className="text-[10px] tabular-nums text-slate-500">
                  {entries.filter((e) => activeStreams.has(e.stream) && e.data.toLowerCase().includes(searchQuery.toLowerCase())).length}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setSearchOpen(false);
                  setSearchQuery('');
                }}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setSearchOpen(true);
                setTimeout(() => searchRef.current?.focus(), 50);
              }}
              className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-500 transition-all hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600"
            >
              <Search className="h-3 w-3" />
              Search
            </button>
          )}

          <div className="flex-1" />

          {/* Right-side actions */}
          <span className="text-[11px] tabular-nums text-slate-400 dark:text-slate-600">
            {entries.length} lines
          </span>

          <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />

          <button
            type="button"
            onClick={() => setAutoScroll(!autoScroll)}
            className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-all ${
              autoScroll
                ? 'border-primary-500/30 bg-primary-500/10 text-primary-500 dark:text-primary-400'
                : 'border-slate-200 text-slate-500 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600'
            }`}
          >
            <ArrowDown className="h-3 w-3" />
            Auto-scroll
          </button>

          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-500 transition-all hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>

          <button
            type="button"
            onClick={handleClear}
            className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-500 transition-all hover:border-rose-300 hover:text-rose-500 dark:border-slate-700 dark:hover:border-rose-500/30 dark:hover:text-rose-400"
          >
            <Trash2 className="h-3 w-3" />
            Clear
          </button>
        </div>

        {/* Console Output */}
        <CustomConsole
          entries={entries}
          autoScroll={autoScroll}
          searchQuery={searchQuery}
          streamFilter={activeStreams}
          isLoading={isLoading}
          isError={isError}
          onRetry={refetch}
          onUserScroll={() => setAutoScroll(false)}
          onAutoScrollResume={() => setAutoScroll(true)}
          className="min-h-0 flex-1"
        />

        {/* Command Input */}
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-3 border-t border-slate-200 bg-white px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900"
        >
          <span className="select-none text-sm font-bold text-primary-500">$</span>
          <input
            ref={inputRef}
            className="w-full bg-transparent font-mono text-sm text-slate-900 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200"
            value={command}
            onChange={(e) => {
              setCommand(e.target.value);
              setHistoryIndex(-1);
            }}
            onKeyDown={handleKeyDown}
            placeholder={
              isSuspended
                ? 'Server suspended'
                : canSend
                  ? 'Type a command… (↑↓ for history)'
                  : 'Connect to send commands'
            }
            disabled={!canSend}
          />
          <button
            type="submit"
            className="rounded-lg bg-primary-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition-all hover:bg-primary-500 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canSend || !command.trim()}
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

export default ServerConsolePage;
