import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AnsiToHtml from 'ansi-to-html';
import DOMPurify from 'dompurify';
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

const ensureLineEnding = (value: string) =>
  value.endsWith('\n') || value.endsWith('\r') ? value : `${value}\n`;
const normalizeLineEndings = (value: string) =>
  value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

// Shared converter instance (stateless, safe to reuse)
const ansiConverter = new AnsiToHtml({
  escapeXML: true,
  newline: true,
  stream: true,
});

const timestampPattern =
  /^\s*(?:\\x07)?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s*/;
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
  { pattern: /\b(ERROR|FATAL|SEVERE|EXCEPTION|PANIC|FAIL(?:ED|URE)?)\b/gi, cls: 'chl-error' },
  { pattern: /\b(WARN(?:ING)?|CAUTION|DEPRECATED)\b/gi, cls: 'chl-warn' },
  { pattern: /\b(INFO|DEBUG|TRACE|NOTICE)\b/gi, cls: 'chl-info' },
  { pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, cls: 'chl-uuid' },
  { pattern: /\b\d{1,2}:\d{2}(?::\d{2})(?:\.\d+)?\b/g, cls: 'chl-time' },
  { pattern: /\b\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?\b/g, cls: 'chl-time' },
  { pattern: /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g, cls: 'chl-ip' },
  { pattern: /https?:\/\/[^\s)>\]]+/gi, cls: 'chl-url' },
];

/** Process only text segments in an HTML string (skip inside tags). */
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

/** Apply syntax highlighting to text outside of HTML tags */
function applySyntaxHighlighting(html: string): string {
  return processTextSegments(html, (text) => {
    let result = text;
    for (const rule of syntaxRules) {
      result = result.replace(
        rule.pattern,
        (m) => `<span class="${rule.cls}">${m}</span>`,
      );
    }
    return result;
  });
}

function highlightSearchInHtml(html: string, query: string): string {
  if (!query) return html;
  const escaped = escapeRegex(query);
  const regex = new RegExp(escaped, 'gi');
  return processTextSegments(html, (text) =>
    text.replace(regex, '<mark class="console-search-match">$&</mark>'),
  );
}



// ── Process a single console entry into render-ready data ──
// This is intentionally a plain function (not a hook) so it can be
// called outside of React's render cycle for virtualization.
function processEntry(
  entry: ConsoleEntry,
  searchQuery: string,
): {
  id: string;
  stream: string;
  timestamp: string;
  htmlLines: string[];
  isLongFlags: boolean[];
  rawLineLengths: number[];
} {
  const message = normalizeLineEndings(ensureLineEnding(entry.data));
  const tsMatch = message.match(timestampPattern);
  const displayTs = entry.timestamp ?? tsMatch?.[1];
  const cleaned = tsMatch ? message.replace(timestampPattern, '') : message;
  const lines = cleaned
    .split('\n')
    .filter((l, i, a) => !(i === a.length - 1 && l === ''));

  const htmlLines: string[] = [];
  const isLongFlags: boolean[] = [];
  const rawLineLengths: number[] = [];

  for (const line of lines) {
    rawLineLengths.push(line.length);
    const isLong = line.length > 800;
    isLongFlags.push(isLong);
    const display = isLong ? line.slice(0, 800) : line;
    let html = ansiConverter.toHtml(display || ' ');
    html = applySyntaxHighlighting(html);
    if (searchQuery) html = highlightSearchInHtml(html, searchQuery);
    html = DOMPurify.sanitize(html);
    htmlLines.push(html);
  }

  return {
    id: entry.id,
    stream: entry.stream,
    timestamp: displayTs ?? '',
    htmlLines,
    isLongFlags,
    rawLineLengths,
  };
}

// ── Row component — rendered per visible entry ──
function ConsoleRow({
  entry,
  index,
  showLineNumbers,
  expandedIds,
  onToggleExpand,
}: {
  entry: ReturnType<typeof processEntry>;
  index: number;
  showLineNumbers: boolean;
  expandedIds: Set<string>;
  onToggleExpand: (key: string) => void;
}) {
  return (
    <div
      className={`console-line group flex border-l-2 ${streamBorderColors[entry.stream] ?? 'border-l-zinc-300 dark:border-l-zinc-700'}`}
    >
      {showLineNumbers ? (
        <span className="flex w-12 shrink-0 select-none items-start justify-end pr-3 pt-px text-[11px] text-muted-foreground group-hover:text-muted-foreground dark:text-foreground dark:group-hover:text-muted-foreground">
          {index + 1}
        </span>
      ) : null}
      {entry.timestamp ? (
        <span className="shrink-0 select-none px-3 pt-px text-[11px] text-muted-foreground group-hover:text-muted-foreground dark:text-muted-foreground dark:group-hover:text-muted-foreground">
          {formatTime(entry.timestamp)}
        </span>
      ) : (
        <span className="w-3 shrink-0" />
      )}
      <div className="min-w-0 flex-1 pr-4">
        {entry.htmlLines.map((html, lineIndex) => {
          const lineKey = `${entry.id}-${lineIndex}`;
          const isLong = entry.isLongFlags[lineIndex];
          const rawLen = entry.rawLineLengths[lineIndex];
          const expanded = expandedIds.has(lineKey);
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
                  onClick={() => onToggleExpand(lineKey)}
                >
                  {expanded
                    ? '← less'
                    : `… +${rawLen - 800} chars`}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
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

  // ── Filter entries ──
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

  // ── Process all entries into render-ready data (memoized) ──
  // This runs once per batch of new entries instead of during render.
  const processedEntries = useMemo(
    () =>
      normalizedEntries.map((entry) =>
        processEntry(entry, searchQuery ?? ''),
      ),
    [normalizedEntries, searchQuery],
  );



  // ── Auto-scroll ──
  useEffect(() => {
    if (!outputRef.current || !autoScroll) return;
    programmaticScrollRef.current = true;
    outputRef.current.scrollTop = outputRef.current.scrollHeight;
    setTimeout(() => {
      programmaticScrollRef.current = false;
    }, 100);
  }, [autoScroll, normalizedEntries.length]);

  // ── Scroll handler ──
  const handleScroll = useCallback(() => {
    if (!outputRef.current || programmaticScrollRef.current) return;
    const { scrollTop: st, scrollHeight, clientHeight } = outputRef.current;
    const nearBottom = scrollHeight - st - clientHeight < 40;
    setShowScrollButton(!nearBottom);
    if (!nearBottom && onUserScroll) onUserScroll();
  }, [onUserScroll]);

  const scrollToBottom = useCallback(() => {
    if (!outputRef.current) return;
    programmaticScrollRef.current = true;
    outputRef.current.scrollTop = outputRef.current.scrollHeight;
    setShowScrollButton(false);
    setTimeout(() => {
      programmaticScrollRef.current = false;
    }, 100);
    onAutoScrollResume?.();
  }, [onAutoScrollResume]);

  const handleToggleExpand = useCallback((key: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // ── Export ──
  const handleExport = useCallback(() => {
    const lines = normalizedEntries.map((entry) => {
      const timestamp = entry.timestamp ? `[${entry.timestamp}] ` : '';
      const stream =
        entry.stream !== 'stdout' ? `[${entry.stream.toUpperCase()}] ` : '';
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
  }, [normalizedEntries, serverId]);

  return (
    <div className={`relative ${className}`}>
      {/* Console toolbar */}
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
        <button
          type="button"
          onClick={handleExport}
          disabled={normalizedEntries.length === 0}
          title="Export console log"
          className="rounded border border-border bg-white/90 px-2 py-1 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur-sm transition-all hover:border-primary-500 hover:text-foreground disabled:opacity-50 dark:border-border dark:bg-surface-1/90 dark:text-zinc-300 dark:hover:border-primary-500/50 dark:hover:text-foreground"
        >
          <Download className="h-3.5 w-3.5" />
        </button>
        {onClear ? (
          <button
            type="button"
            onClick={onClear}
            disabled={normalizedEntries.length === 0}
            title="Clear console"
            className="rounded border border-border bg-white/90 px-2 py-1 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur-sm transition-all hover:border-rose-500 hover:text-rose-600 disabled:opacity-50 dark:border-border dark:bg-surface-1/90 dark:text-zinc-300 dark:hover:border-rose-500/50 dark:hover:text-rose-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      <div
        ref={outputRef}
        onScroll={handleScroll}
        className="console-output h-full overflow-y-auto font-mono text-[13px] leading-[1.7] text-foreground dark:text-zinc-300"
      >
        {isLoading ? (
          <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-border border-t-primary-400 dark:border-zinc-600" />
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
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground dark:text-muted-foreground">
            No console output yet.
          </div>
        ) : null}

        {/* Render all entries — memoized processing keeps this fast */}
        {normalizedEntries.length > 0 &&
          processedEntries.map((entry, index) => (
            <ConsoleRow
              key={entry.id}
              entry={entry}
              index={index}
              showLineNumbers={showLineNumbers}
              expandedIds={expandedIds}
              onToggleExpand={handleToggleExpand}
            />
          ))}
      </div>

      {showScrollButton && !autoScroll ? (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-white/95 px-3 py-1.5 text-[11px] text-muted-foreground shadow-lg backdrop-blur-sm transition-all hover:border-primary-500/50 hover:text-foreground dark:border-border dark:bg-surface-1/95 dark:text-muted-foreground dark:hover:text-zinc-200"
        >
          <ArrowDown className="h-3 w-3" />
          New output below
        </button>
      ) : null}
    </div>
  );
}

export default CustomConsole;
