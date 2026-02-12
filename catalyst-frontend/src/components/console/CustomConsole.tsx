import { useEffect, useMemo, useRef, useState } from 'react';
import AnsiToHtml from 'ansi-to-html';
import { ArrowDown, Download, Trash2 } from 'lucide-react';

type ConsoleEntry = {
  id: string;
  stream: string;
  data: string;
  timestamp?: string;
};

type CustomConsoleProps = {
  entries: ConsoleEntry[];
  autoScroll?: boolean;
  scrollback?: number;
  searchQuery?: string;
  streamFilter?: Set<string>;
  showLineNumbers?: boolean;
  onUserScroll?: () => void;
  onAutoScrollResume?: () => void;
  className?: string;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  onClear?: () => void;
  serverId?: string;
};

const streamBorderColors: Record<string, string> = {
  stdout: 'border-l-emerald-400/60',
  stderr: 'border-l-rose-400/60',
  system: 'border-l-sky-400/60',
  stdin: 'border-l-amber-400/60',
};

const ensureLineEnding = (value: string) => (value.endsWith('\n') || value.endsWith('\r') ? value : `${value}\n`);
const normalizeLineEndings = (value: string) => value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

const ansiConverter = new AnsiToHtml({ escapeXML: true, newline: true, stream: true });

const timestampPattern = /^\s*(?:\\x07)?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s*/;
const padTwo = (value: number) => String(value).padStart(2, '0');
const formatTime = (value?: string) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return `${padTwo(parsed.getHours())}:${padTwo(parsed.getMinutes())}:${padTwo(parsed.getSeconds())}`;
};

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Syntax highlighting rules applied to text segments outside HTML tags
const syntaxRules: Array<{ pattern: RegExp; cls: string }> = [
  // Error / fatal keywords
  { pattern: /\b(ERROR|FATAL|SEVERE|EXCEPTION|PANIC|FAIL(?:ED|URE)?)\b/gi, cls: 'chl-error' },
  // Warning keywords
  { pattern: /\b(WARN(?:ING)?|CAUTION|DEPRECATED)\b/gi, cls: 'chl-warn' },
  // Info / debug keywords
  { pattern: /\b(INFO|DEBUG|TRACE|NOTICE)\b/gi, cls: 'chl-info' },
  // UUIDs
  { pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, cls: 'chl-uuid' },
  // Timestamps  (HH:MM:SS or ISO-ish dates)
  { pattern: /\b\d{1,2}:\d{2}(?::\d{2})(?:\.\d+)?\b/g, cls: 'chl-time' },
  { pattern: /\b\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?\b/g, cls: 'chl-time' },
  // IPv4 addresses
  { pattern: /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g, cls: 'chl-ip' },
  // URLs
  { pattern: /https?:\/\/[^\s)>\]]+/gi, cls: 'chl-url' },
];

/** Apply syntax highlighting to text outside of HTML tags */
function applySyntaxHighlighting(html: string): string {
  return processTextSegments(html, (text) => {
    let result = text;
    for (const rule of syntaxRules) {
      result = result.replace(rule.pattern, (m) => `<span class="${rule.cls}">${m}</span>`);
    }
    return result;
  });
}

/**
 * Process only text segments in an HTML string (skip inside tags).
 * Calls `fn` for each text segment and reassembles the result.
 */
function processTextSegments(html: string, fn: (text: string) => string): string {
  let result = '';
  let inTag = false;
  let i = 0;
  while (i < html.length) {
    if (html[i] === '<') {
      inTag = true;
      result += '<';
      i++;
      continue;
    }
    if (html[i] === '>') {
      inTag = false;
      result += '>';
      i++;
      continue;
    }
    if (inTag) {
      result += html[i];
      i++;
      continue;
    }
    let textEnd = html.indexOf('<', i);
    if (textEnd === -1) textEnd = html.length;
    result += fn(html.slice(i, textEnd));
    i = textEnd;
  }
  return result;
}

function highlightSearchInHtml(html: string, query: string): string {
  if (!query) return html;
  const escaped = escapeRegex(query);
  const regex = new RegExp(escaped, 'gi');
  return processTextSegments(html, (text) =>
    text.replace(regex, '<mark class="console-search-match">$&</mark>'),
  );
}

function CustomConsole({
  entries,
  autoScroll = true,
  scrollback = 2000,
  searchQuery,
  streamFilter,
  showLineNumbers = false,
  onUserScroll,
  onAutoScrollResume,
  className = '',
  isLoading,
  isError,
  onRetry,
  onClear,
  serverId,
}: CustomConsoleProps) {
  const outputRef = useRef<HTMLDivElement | null>(null);
  const [expandedIds, setExpandedIds] = useState(() => new Set<string>());
  const programmaticScrollRef = useRef(false);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const normalizedEntries = useMemo(() => {
    let filtered = entries.slice(-scrollback);
    if (streamFilter && streamFilter.size > 0) {
      filtered = filtered.filter((e) => streamFilter.has(e.stream));
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((e) => e.data.toLowerCase().includes(q));
    }
    return filtered;
  }, [entries, scrollback, searchQuery, streamFilter]);

  // Export console output to a file
  const handleExport = () => {
    const lines = normalizedEntries.map((entry) => {
      const timestamp = entry.timestamp ? `[${entry.timestamp}] ` : '';
      const stream = entry.stream !== 'stdout' ? `[${entry.stream.toUpperCase()}] ` : '';
      return `${timestamp}${stream}${entry.data}`;
    });
    const content = lines.join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `console-${serverId || 'output'}-${new Date().toISOString().slice(0, 19).replace(/[:-]/g, '')}.log`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (!outputRef.current || !autoScroll) return;
    programmaticScrollRef.current = true;
    outputRef.current.scrollTop = outputRef.current.scrollHeight;
    setTimeout(() => {
      programmaticScrollRef.current = false;
    }, 100);
  }, [autoScroll, normalizedEntries]);

  const handleScroll = () => {
    if (!outputRef.current || programmaticScrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = outputRef.current;
    const nearBottom = scrollHeight - scrollTop - clientHeight < 40;
    setShowScrollButton(!nearBottom);
    if (!nearBottom && onUserScroll) onUserScroll();
  };

  const scrollToBottom = () => {
    if (!outputRef.current) return;
    programmaticScrollRef.current = true;
    outputRef.current.scrollTop = outputRef.current.scrollHeight;
    setShowScrollButton(false);
    setTimeout(() => {
      programmaticScrollRef.current = false;
    }, 100);
    onAutoScrollResume?.();
  };

  return (
    <div className={`relative ${className}`}>
      {/* Console toolbar */}
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
        <button
          type="button"
          onClick={handleExport}
          disabled={normalizedEntries.length === 0}
          title="Export console log"
          className="rounded border border-slate-200 bg-white/90 px-2 py-1 text-xs font-medium text-slate-600 shadow-sm backdrop-blur-sm transition-all hover:border-primary-500 hover:text-slate-900 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-300 dark:hover:border-primary-500/50 dark:hover:text-white"
        >
          <Download className="h-3.5 w-3.5" />
        </button>
        {onClear ? (
          <button
            type="button"
            onClick={onClear}
            disabled={normalizedEntries.length === 0}
            title="Clear console"
            className="rounded border border-slate-200 bg-white/90 px-2 py-1 text-xs font-medium text-slate-600 shadow-sm backdrop-blur-sm transition-all hover:border-rose-500 hover:text-rose-600 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-300 dark:hover:border-rose-500/50 dark:hover:text-rose-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      <div
        ref={outputRef}
        onScroll={handleScroll}
        className="console-output h-full overflow-y-auto font-mono text-[13px] leading-[1.7] text-slate-800 dark:text-slate-300"
      >
        {isLoading ? (
          <div className="flex items-center gap-2 px-4 py-3 text-xs text-slate-500">
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-primary-400 dark:border-slate-600" />
            Loading recent logs…
          </div>
        ) : null}
        {isError ? (
          <div className="mx-4 my-3 flex items-center justify-between rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
            <span>Unable to load historical logs.</span>
            <button
              type="button"
              className="rounded border border-rose-500/30 px-2 py-0.5 text-rose-400 transition-colors hover:bg-rose-500/20"
              onClick={() => onRetry?.()}
            >
              Retry
            </button>
          </div>
        ) : null}
        {!isLoading && normalizedEntries.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-slate-400 dark:text-slate-600">
            No console output yet.
          </div>
        ) : (
          <div className="py-0.5">
            {normalizedEntries.map((entry, index) => {
              const message = normalizeLineEndings(ensureLineEnding(entry.data));
              const tsMatch = message.match(timestampPattern);
              const displayTs = entry.timestamp ?? tsMatch?.[1];
              const cleaned = tsMatch ? message.replace(timestampPattern, '') : message;
              const lines = cleaned.split('\n').filter((l, i, a) => !(i === a.length - 1 && l === ''));
              return (
                <div
                  key={entry.id}
                  className={`console-line group flex border-l-2 ${streamBorderColors[entry.stream] ?? 'border-l-slate-300 dark:border-l-slate-700'}`}
                >
                  {showLineNumbers ? (
                    <span className="flex w-12 shrink-0 select-none items-start justify-end pr-3 pt-px text-[11px] text-slate-400 group-hover:text-slate-500 dark:text-slate-700 dark:group-hover:text-slate-500">
                      {index + 1}
                    </span>
                  ) : null}
                  {displayTs ? (
                    <span className="shrink-0 select-none px-3 pt-px text-[11px] text-slate-400 group-hover:text-slate-500 dark:text-slate-600 dark:group-hover:text-slate-500">
                      {formatTime(displayTs)}
                    </span>
                  ) : (
                    <span className="w-3 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1 pr-4">
                    {lines.map((line, lineIndex) => {
                      const isLong = line.length > 800;
                      const lineKey = `${entry.id}-${lineIndex}`;
                      const expanded = expandedIds.has(lineKey);
                      const display = isLong && !expanded ? line.slice(0, 800) : line;
                      let html = ansiConverter.toHtml(display || ' ');
                      html = applySyntaxHighlighting(html);
                      if (searchQuery) html = highlightSearchInHtml(html, searchQuery);
                      return (
                        <div key={lineKey}>
                          <span
                            className="whitespace-pre-wrap break-words"
                            dangerouslySetInnerHTML={{ __html: html }}
                          />
                          {isLong ? (
                            <button
                              type="button"
                              className="ml-1 text-[10px] text-sky-600/70 hover:text-sky-500 dark:text-sky-400/70 dark:hover:text-sky-300"
                              onClick={() =>
                                setExpandedIds((c) => {
                                  const n = new Set(c);
                                  if (n.has(lineKey)) n.delete(lineKey);
                                  else n.add(lineKey);
                                  return n;
                                })
                              }
                            >
                              {expanded ? '← less' : `… +${line.length - 800} chars`}
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {showScrollButton && !autoScroll ? (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-slate-300 bg-white/95 px-3 py-1.5 text-[11px] text-slate-500 shadow-lg backdrop-blur-sm transition-all hover:border-primary-500/50 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-400 dark:hover:text-slate-200"
        >
          <ArrowDown className="h-3 w-3" />
          New output below
        </button>
      ) : null}
    </div>
  );
}

export default CustomConsole;
