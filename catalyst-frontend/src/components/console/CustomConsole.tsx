/**
 * CustomConsole — Virtualized console output powered by @tanstack/react-virtual.
 *
 * Architecture:
 *   1. @tanstack/react-virtual for scroll virtualization (dynamic row heights)
 *   2. ResizeObserver tracks container width for accurate chars-per-line calc
 *   3. Two-tier processing cache (base + search-highlighted)
 *   4. React.memo on ConsoleRow — rows that remain visible during scroll NEVER re-render
 *   5. Auto-scroll with user-scroll detection and resume button
 */

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, Download, Trash2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { RawEntry, ProcessedEntry } from './types';
import { processEntry } from './processEntry';

// ── Constants ──

const LINE_HEIGHT = 22;
const ROW_PAD = 4;
const MIN_ROW_HEIGHT = LINE_HEIGHT + ROW_PAD;
const OVERSCAN = 15;

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
  const showScrollBtnRef = useRef(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  // Stable callback refs (avoid effect re-registration)
  const onUserScrollRef = useRef(onUserScroll);
  onUserScrollRef.current = onUserScroll;
  const onAutoScrollResumeRef = useRef(onAutoScrollResume);
  onAutoScrollResumeRef.current = onAutoScrollResume;

  // ── Container width → chars-per-line ──
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      if (w > 0) setContainerWidth(w);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [showLineNumbers]);

  const charsPerLine = useMemo(() => {
    if (!containerWidth) return 100;
    return calcCharsPerLine(containerWidth, showLineNumbers);
  }, [containerWidth, showLineNumbers]);

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

  // ── Step 3: Process entries with base cache ──
  const baseCacheRef = useRef<Map<string, ProcessedEntry>>(new Map());

  const processedEntries = useMemo(() => {
    const cache = baseCacheRef.current;
    for (const entry of searchableEntries) {
      if (!cache.has(entry.id)) cache.set(entry.id, processEntry(entry, ''));
    }
    // Evict stale entries
    if (cache.size > scrollback * 2) {
      const activeIds = new Set(searchableEntries.map((e) => e.id));
      for (const key of cache.keys()) {
        if (!activeIds.has(key)) cache.delete(key);
      }
    }
    // Return base entries or search-highlighted variants
    if (!deferredSearch) {
      return searchableEntries.map((e) => cache.get(e.id)!);
    }
    return searchableEntries.map((e) => {
      const base = cache.get(e.id)!;
      return { ...base, html: highlightSearchInHtml(base.html, deferredSearch) };
    });
  }, [searchableEntries, deferredSearch, scrollback]);

  // ── Step 4: Virtualizer (dynamic heights via estimateSize) ──
  const estimateSize = useCallback(
    (index: number) => {
      const entry = processedEntries[index];
      if (!entry) return MIN_ROW_HEIGHT;
      const wrappedLines = Math.max(1, Math.ceil(entry.textLength / charsPerLine));
      return wrappedLines * MIN_ROW_HEIGHT;
    },
    [processedEntries, charsPerLine],
  );

  const getItemKey = useCallback(
    (index: number) => processedEntries[index]?.id ?? `console-row-${index}`,
    [processedEntries],
  );

  const measureElement = useCallback((el: Element) => el.getBoundingClientRect().height, []);

  const virtualizer = useVirtualizer({
    count: processedEntries.length,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan: OVERSCAN,
    getItemKey,
    measureElement,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  // ── Auto-scroll to bottom when new entries arrive ──
  const prevCountRef = useRef(0);

  useEffect(() => {
    const count = processedEntries.length;
    if (!autoScrollProp || count === 0 || count <= prevCountRef.current) return;

    // Defer to next frame so the virtualizer's DOM has been laid out
    const raf = requestAnimationFrame(() => {
      const el = parentRef.current;
      if (!el) return;
      isProgrammaticScroll.current = true;
      virtualizer.scrollToIndex(count - 1, { align: 'end', behavior: 'auto' });
    });

    prevCountRef.current = count;
    return () => cancelAnimationFrame(raf);
  }, [autoScrollProp, processedEntries.length, virtualizer]);

  // ── User-scroll detection ──
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;

    const handleScroll = () => {
      if (isProgrammaticScroll.current) {
        isProgrammaticScroll.current = false;
        return;
      }
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
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
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  // ── Scroll to bottom (button click) ──
  const scrollToBottom = useCallback(() => {
    showScrollBtnRef.current = false;
    setShowScrollBtn(false);
    isProgrammaticScroll.current = true;
    virtualizer.scrollToIndex(processedEntries.length - 1, { align: 'end' });
    onAutoScrollResumeRef.current?.();
  }, [processedEntries.length, virtualizer]);

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

  // ── Render ──
  const hasContent = processedEntries.length > 0;

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
          {/* Loading / Error / Empty states */}
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

          {/* Virtualized rows */}
          {hasContent && (
            <div style={{ height: totalSize, position: 'relative', width: '100%' }}>
              {virtualItems.map((virtualRow) => {
                const entry = processedEntries[virtualRow.index];
                return (
                  <div
                    key={virtualRow.key}
                    ref={virtualizer.measureElement}
                    data-index={virtualRow.index}
                    className="absolute left-0 right-0 top-0"
                    style={{ transform: `translateY(${virtualRow.start}px)`, willChange: 'transform' }}
                  >
                    <ConsoleRow
                      entry={entry}
                      index={virtualRow.index}
                      showLineNumbers={showLineNumbers}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Scroll-to-bottom button */}
        {showScrollBtn && !autoScrollProp && hasContent && (
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
