/**
 * CustomConsole — High-performance virtualized console output component.
 *
 * Architecture:
 *   1. Custom spacer-based virtualizer (no library)
 *   2. Pre-computed Float64Array of cumulative heights — binary search (O(log n))
 *   3. React.memo on ConsoleRow — rows that remain visible during scroll NEVER re-render
 *   4. requestAnimationFrame-throttled scroll handler
 *   5. ResizeObserver tracks container width for accurate chars-per-line calculation
 *   6. Two-tier processing cache (base + search)
 *   7. useLayoutEffect for auto-scroll
 */

import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, Download, Trash2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { RawEntry, ProcessedEntry } from './types';
import { processEntry } from './processEntry';

// ── Constants ──

const LINE_HEIGHT = 22;
const ROW_PAD = 4;
const MIN_ROW_HEIGHT = LINE_HEIGHT + ROW_PAD;
const OVERSCAN = 200;

const STREAM_BORDER: Record<string, string> = {
  stdout: 'border-l-emerald-400/60',
  stderr: 'border-l-rose-400/60',
  system: 'border-l-sky-400/60',
  stdin: 'border-l-amber-400/60',
};

// ── One-time monospace char width measurement ──

const CHAR_WIDTH = (() => {
  try {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    if (!ctx) return 7.8;
    ctx.font = '13px "JetBrains Mono", "Fira Code", ui-monospace, monospace';
    return ctx.measureText('M').width;
  } catch {
    return 7.8;
  }
})();

function calcCharsPerLine(containerWidth: number, showLineNumbers: boolean): number {
  const textAreaWidth =
    containerWidth -
    2 -
    (showLineNumbers ? 60 : 0) -
    80 -
    16;
  return Math.max(20, Math.floor(textAreaWidth / CHAR_WIDTH) - 3);
}

// ── Search highlighting (text-nodes only) ──

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightSearchInHtml(html: string, query: string): string {
  if (!query) return html;
  const regex = new RegExp(escapeRegex(query), 'gi');
  let result = '';
  let inTag = false;
  let i = 0;
  while (i < html.length) {
    if (html[i] === '<') { inTag = true; result += '<'; i++; continue; }
    if (html[i] === '>') { inTag = false; result += '>'; i++; continue; }
    if (inTag) { result += html[i]; i++; continue; }
    const textEnd = html.indexOf('<', i);
    if (textEnd === -1) {
      result += html.slice(i).replace(regex, '<mark class="console-search-match">$&</mark>');
      break;
    }
    result += html.slice(i, textEnd).replace(regex, '<mark class="console-search-match">$&</mark>');
    i = textEnd;
  }
  return result;
}

// ── Row component ──

const ConsoleRow = memo(function ConsoleRow({
  entry,
  index,
  showLineNumbers,
}: {
  entry: ProcessedEntry;
  index: number;
  showLineNumbers: boolean;
}) {
  return (
    <div
      className={`console-line flex border-l-2 ${STREAM_BORDER[entry.stream] ?? 'border-l-border dark:border-l-border'}`}
    >
      {showLineNumbers && (
        <span className="flex w-12 shrink-0 select-none items-start justify-end pr-3 pt-px text-[11px] text-muted-foreground">
          {index + 1}
        </span>
      )}
      {entry.timestamp ? (
        <span className="flex shrink-0 select-none items-start px-3 pt-px text-[11px] text-muted-foreground">
          {entry.timestamp}
        </span>
      ) : (
        <span className="w-3 shrink-0" />
      )}
      <div
        className="min-w-0 flex-1 whitespace-pre-wrap break-all pr-4"
        dangerouslySetInnerHTML={{ __html: entry.html }}
      />
    </div>
  );
}, (prev, next) => prev.entry === next.entry && prev.showLineNumbers === next.showLineNumbers);

// ── Types ──

type CustomConsoleProps = {
  entries: RawEntry[];
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

// ── Main Component ──

function CustomConsole({
  entries,
  autoScroll: autoScrollProp = true,
  scrollback = 2000,
  searchQuery: searchQueryProp = '',
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
  const parentRef = useRef<HTMLDivElement | null>(null);
  const isProgrammaticScroll = useRef(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const onUserScrollRef = useRef(onUserScroll);
  onUserScrollRef.current = onUserScroll;
  const onAutoScrollResumeRef = useRef(onAutoScrollResume);
  onAutoScrollResumeRef.current = onAutoScrollResume;

  // ── Container width → chars-per-line ──
  const [charsPerLine, setCharsPerLine] = useState(100);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      if (w > 0) setCharsPerLine(calcCharsPerLine(w, showLineNumbers));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [showLineNumbers]);

  // ── Deferred search ──
  const deferredSearch = useDeferredValue(searchQueryProp);

  // ── Step 1: Filter entries ──
  const filteredEntries = useMemo(() => {
    let result = entries.slice(-scrollback);
    if (streamFilter && streamFilter.size > 0) {
      result = result.filter((e) => streamFilter.has(e.stream));
    }
    return result;
  }, [entries, scrollback, streamFilter]);

  // ── Step 2: Search filter ──
  const searchableEntries = useMemo(() => {
    if (!deferredSearch) return filteredEntries;
    const q = deferredSearch.toLowerCase();
    return filteredEntries.filter((e) => e.data.toLowerCase().includes(q));
  }, [filteredEntries, deferredSearch]);

  // ── Step 3: Process entries with cache ──
  const baseCacheRef = useRef<Map<string, ProcessedEntry>>(new Map());

  const processedEntries = useMemo(() => {
    const cache = baseCacheRef.current;
    for (const entry of searchableEntries) {
      if (!cache.has(entry.id)) cache.set(entry.id, processEntry(entry, ''));
    }
    if (cache.size > scrollback * 2) {
      const activeIds = new Set(searchableEntries.map((e) => e.id));
      for (const key of cache.keys()) {
        if (!activeIds.has(key)) cache.delete(key);
      }
    }
    if (!deferredSearch) {
      return searchableEntries.map((e) => cache.get(e.id)!);
    }
    return searchableEntries.map((e) => {
      const base = cache.get(e.id)!;
      return { ...base, html: highlightSearchInHtml(base.html, deferredSearch) };
    });
  }, [searchableEntries, deferredSearch, scrollback]);

  // ── Step 4: Pre-compute heights ──
  const { cumulative, totalSize } = useMemo(() => {
    const n = processedEntries.length;
    const c = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
      const entry = processedEntries[i];
      const wrappedLines = Math.max(1, Math.ceil((entry?.textLength ?? 0) / charsPerLine));
      c[i + 1] = c[i] + wrappedLines * MIN_ROW_HEIGHT;
    }
    return { cumulative: c, totalSize: c[n] };
  }, [processedEntries, charsPerLine]);

  // ── Step 5: Visible range ──
  const [range, setRange] = useState({ start: 0, end: 0 });
  const showScrollBtnRef = useRef(false);

  useEffect(() => {
    const el = parentRef.current;
    if (!el || cumulative.length <= 1) return;

    let rafId = 0;

    const update = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        const scrollTop = el.scrollTop;
        const viewBottom = scrollTop + el.clientHeight;
        const bufferPx = OVERSCAN * MIN_ROW_HEIGHT;

        let lo = 0;
        let hi = cumulative.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (cumulative[mid] <= scrollTop) lo = mid + 1;
          else hi = mid;
        }
        const anchorIdx = lo > 0 ? lo - 1 : 0;
        const start = Math.max(0, anchorIdx - OVERSCAN);

        let end = anchorIdx + 1;
        while (end < cumulative.length - 1 && cumulative[end] < viewBottom + bufferPx) {
          end++;
        }

        setRange((prev) =>
          prev.start === start && prev.end === end ? prev : { start, end },
        );

        if (isProgrammaticScroll.current) {
          isProgrammaticScroll.current = false;
          return;
        }
        const nearBottom = el.scrollHeight - scrollTop - el.clientHeight < 40;
        if (nearBottom) {
          if (showScrollBtnRef.current) {
            showScrollBtnRef.current = false;
            setShowScrollBtn(false);
            onAutoScrollResumeRef.current?.();
          }
        } else {
          if (!showScrollBtnRef.current) {
            showScrollBtnRef.current = true;
            setShowScrollBtn(true);
            onUserScrollRef.current?.();
          }
        }
      });
    };

    update();
    el.addEventListener('scroll', update, { passive: true });
    return () => {
      el.removeEventListener('scroll', update);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [cumulative]);

  // ── Auto-scroll ──
  const prevCountRef = useRef(processedEntries.length);

  useLayoutEffect(() => {
    if (autoScrollProp && processedEntries.length > prevCountRef.current) {
      const el = parentRef.current;
      if (el) {
        isProgrammaticScroll.current = true;
        const prev = el.scrollTop;
        el.scrollTop = el.scrollHeight;
        if (el.scrollTop === prev) {
          isProgrammaticScroll.current = false;
        }
      }
    }
    prevCountRef.current = processedEntries.length;
  }, [autoScrollProp, processedEntries.length]);

  // ── Scroll to bottom ──
  const scrollToBottom = useCallback(() => {
    showScrollBtnRef.current = false;
    setShowScrollBtn(false);
    const el = parentRef.current;
    if (el) {
      isProgrammaticScroll.current = true;
      const prev = el.scrollTop;
      el.scrollTop = el.scrollHeight;
      if (el.scrollTop === prev) {
        isProgrammaticScroll.current = false;
      }
    }
    onAutoScrollResumeRef.current?.();
  }, []);

  // ── Export ──
  const handleExport = useCallback(() => {
    const lines = filteredEntries.map((entry) => {
      const timestamp = entry.timestamp ? `[${entry.timestamp}] ` : '';
      const stream = entry.stream !== 'stdout' ? `[${entry.stream.toUpperCase()}] ` : '';
      return `${timestamp}${stream}${entry.data}`;
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `console-${serverId || 'output'}-${new Date().toISOString().slice(0, 19).replace(/[:-]/g, '')}.log`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [filteredEntries, serverId]);

  const hasContent = processedEntries.length > 0;
  const topSpacer = cumulative[range.start] ?? 0;
  const bottomSpacer = totalSize - (cumulative[range.end] ?? totalSize);

  return (
    <TooltipProvider delayDuration={300}>
      <div className={`relative ${className}`}>
        {/* Compact floating toolbar */}
        <div className="absolute right-2 top-2 z-10 flex items-center gap-0.5 rounded-md border border-border/80 bg-card/90 p-0.5 shadow-sm backdrop-blur-sm">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleExport}
                disabled={!hasContent}
                className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground disabled:opacity-40"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Export log</TooltipContent>
          </Tooltip>
          {onClear && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onClear}
                  disabled={!hasContent}
                  className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Clear console</TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Console output */}
        <div
          ref={parentRef}
          className="console-output h-full overflow-y-auto font-mono text-[13px] leading-[1.7] text-foreground dark:text-foreground"
        >
          {isLoading && !hasContent && (
            <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-border border-t-primary-400 dark:border-muted" />
              Loading recent logs…
            </div>
          )}

          {isError && !hasContent && (
            <div className="mx-4 my-3 flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/50/10 px-3 py-2 text-xs text-destructive">
              <span>Unable to load historical logs.</span>
              <button
                type="button"
                className="rounded border border-destructive/30 px-2 py-0.5 text-destructive transition-colors hover:bg-destructive/50/20"
                onClick={() => onRetry?.()}
              >
                Retry
              </button>
            </div>
          )}

          {!isLoading && !hasContent && (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              No console output yet.
            </div>
          )}

          {hasContent && (
            <>
              <div style={{ height: topSpacer }} aria-hidden="true" />
              {processedEntries.slice(range.start, range.end).map((entry, i) => (
                <ConsoleRow
                  key={entry.id}
                  entry={entry}
                  index={range.start + i}
                  showLineNumbers={showLineNumbers}
                />
              ))}
              <div style={{ height: bottomSpacer }} aria-hidden="true" />
            </>
          )}
        </div>

        {/* Scroll-to-bottom button */}
        {showScrollBtn && !autoScrollProp && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-card/95 px-3 py-1.5 text-[11px] font-medium text-muted-foreground shadow-md backdrop-blur-sm transition-all hover:border-primary/40 hover:text-foreground"
          >
            <ArrowDown className="h-3 w-3" />
            New output
          </button>
        )}
      </div>
    </TooltipProvider>
  );
}

export default CustomConsole;
