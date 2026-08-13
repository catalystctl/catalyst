/**
 * XtermConsole — game-server console renderer powered by @xterm/xterm.
 *
 * Design (Pterodactyl/Pelican-style):
 *   - xterm is display-only (`disableStdin: true`)
 *   - commands stay on a normal input under the terminal (parent owns that)
 *   - React does NOT virtualize ANSI/HTML rows — SSE/REST entries → terminal.write()
 *
 * Sync strategy (anti-flicker):
 *   Track the last written entry id. On each entries update, find that id in the
 *   new list and ONLY write the tail after it. Full wipe+rewrite only when the
 *   id is gone (clear, filter change, history replace, scrollback that dropped it).
 *   Never treat "prefix of ids" as the signal — scrollback trim shifts the head
 *   and would force a full reset on every live line once the buffer is full.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { ArrowDown } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import { useThemeStore } from '@/stores/themeStore';
import type { RawEntry } from './types';

type XtermConsoleProps = {
  entries: RawEntry[];
  autoScroll?: boolean;
  scrollback?: number;
  searchQuery?: string;
  streamFilter?: Set<string>;
  onUserScroll?: () => void;
  onAutoScrollResume?: () => void;
  className?: string;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  onClear?: () => void;
  serverId?: string;
  showLineNumbers?: boolean;
};

export type XtermConsoleHandle = {
  findNext: (query: string) => void;
  findPrevious: (query: string) => void;
  getSelection: () => string;
};


/**
 * Catalyst theme tokens are HSL *channels* (e.g. `240 12% 9%`), not full colors.
 * xterm needs a real CSS color. Resolve via a probe element so custom themeStore
 * overrides and .dark/.light both work.
 */
let colorProbe: HTMLSpanElement | null = null;

function resolveThemeColor(token: string, fallback: string): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return fallback;
  try {
    if (!colorProbe) {
      colorProbe = document.createElement('span');
      colorProbe.style.cssText =
        'position:fixed;left:-9999px;top:0;width:0;height:0;pointer-events:none;opacity:0;';
      document.documentElement.appendChild(colorProbe);
    }
    // Support both bare channel tokens (`--card`) and already-wrapped values.
    colorProbe.style.color = `hsl(var(${token}))`;
    const resolved = getComputedStyle(colorProbe).color;
    // getComputedStyle returns rgb/rgba; empty/transparent means the var was missing.
    if (!resolved || resolved === 'rgba(0, 0, 0, 0)' || resolved === 'transparent') {
      return fallback;
    }
    return resolved;
  } catch {
    return fallback;
  }
}

/** Mix selection: primary at ~35% over the card background via color-mix when available. */
function resolveSelection(fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  try {
    // Ensure probe exists (resolveThemeColor usually ran first, but be safe).
    resolveThemeColor('--card', fallback);
    if (!colorProbe) return fallback;
    colorProbe.style.color =
      'color-mix(in srgb, hsl(var(--primary)) 35%, hsl(var(--card)))';
    const resolved = getComputedStyle(colorProbe).color;
    if (!resolved || resolved === 'rgba(0, 0, 0, 0)' || resolved === 'transparent') {
      return resolveThemeColor('--primary', fallback);
    }
    return resolved;
  } catch {
    return resolveThemeColor('--primary', fallback);
  }
}

function readXtermTheme(): ITheme {
  // Solid colors only — allowTransparency + semi-transparent selection causes
  // repaint flicker under frequent writes. Map ANSI palette to semantic tokens
  // so stderr/system/stdin tints and agent ANSI follow the active theme.
  const bg = resolveThemeColor('--card', '#0b0f14');
  const fg = resolveThemeColor('--foreground', '#e6edf3');
  const primary = resolveThemeColor('--primary', '#14b8a6');
  const danger = resolveThemeColor('--danger', '#f87171');
  const success = resolveThemeColor('--success', '#4ade80');
  const warning = resolveThemeColor('--warning', '#fbbf24');
  const info = resolveThemeColor('--info', '#60a5fa');
  const muted = resolveThemeColor('--muted-foreground', '#6b7280');
  const surface = resolveThemeColor('--surface-2', '#1f2937');

  return {
    background: bg,
    foreground: fg,
    cursor: primary,
    cursorAccent: bg,
    selectionBackground: resolveSelection(primary),
    selectionInactiveBackground: surface,
    selectionForeground: fg,
    black: resolveThemeColor('--background', '#09090b'),
    red: danger,
    green: success,
    yellow: warning,
    blue: info,
    magenta: primary,
    cyan: info,
    white: fg,
    brightBlack: muted,
    brightRed: danger,
    brightGreen: success,
    brightYellow: warning,
    brightBlue: info,
    brightMagenta: primary,
    brightCyan: info,
    brightWhite: resolveThemeColor('--card-foreground', fg),
  };
}

/** Keep lone CR so installer/progress lines overwrite instead of stacking. */
function normalizeChunk(data: string): string {
  let s = data.replace(/\r\n/g, '\n');
  if (!s.endsWith('\n') && !s.endsWith('\r')) s += '\n';
  return s;
}


function streamPrefix(stream: string): string {
  switch (stream) {
    case 'stderr':
      return '\x1b[31m';
    case 'system':
      return '\x1b[36m';
    case 'stdin':
      return '\x1b[33m';
    default:
      return '';
  }
}

function streamSuffix(stream: string): string {
  return stream === 'stdout' ? '' : '\x1b[0m';
}

function formatEntry(entry: RawEntry): string {
  const body = normalizeChunk(entry.data);
  // Preserve embedded ANSI from the agent; only tint whole non-stdout streams.
  return `${streamPrefix(entry.stream)}${body}${streamSuffix(entry.stream)}`;
}

/** Stable signature of the active stream filter (order-independent). */
function filterSignature(filter: Set<string> | undefined): string {
  if (!filter || filter.size === 0) return '';
  return [...filter].sort().join(',');
}
const XtermConsole = forwardRef<XtermConsoleHandle, XtermConsoleProps>(function XtermConsole({
  entries,
  autoScroll: autoScrollProp = true,
  scrollback = 2000,
  searchQuery = '',
  streamFilter,
  onUserScroll,
  onAutoScrollResume,
  className = '',
  isLoading,
  isError,
  onRetry,
}, ref) {

  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  useImperativeHandle(ref, () => ({
    findNext: (query: string) => {
      if (!query) return;
      searchRef.current?.findNext(query, { caseSensitive: false, incremental: false });
    },
    findPrevious: (query: string) => {
      if (!query) return;
      searchRef.current?.findPrevious(query, { caseSensitive: false, incremental: false });
    },
    getSelection: () => termRef.current?.getSelection() ?? '',
  }), []);

  const isProgrammaticScroll = useRef(false);
  const autoScrollRef = useRef(autoScrollProp);
  autoScrollRef.current = autoScrollProp;

  // Subscribe so brand/primary/surface customizations re-paint the terminal.
  // themeStore.applyThemeToDOM also toggles .light/.dark on <html>, which the
  // MutationObserver below covers for mode flips without a store write race.
  const appTheme = useThemeStore((s) => s.theme);
  const themeSettings = useThemeStore((s) => s.themeSettings);

  const onUserScrollRef = useRef(onUserScroll);
  onUserScrollRef.current = onUserScroll;
  const onAutoScrollResumeRef = useRef(onAutoScrollResume);
  onAutoScrollResumeRef.current = onAutoScrollResume;

  /** Last entry id successfully written to the terminal (append cursor). */
  const lastWrittenIdRef = useRef<string | null>(null);
  /** Filter signature used for the content currently in the terminal. */
  const writtenFilterRef = useRef<string>('');
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const showScrollBtnRef = useRef(false);
  /** Bumps when the Terminal instance is ready so the sync effect re-runs. */
  const [termEpoch, setTermEpoch] = useState(0);

  const filterSig = useMemo(() => filterSignature(streamFilter), [streamFilter]);

  const visibleEntries = useMemo(() => {
    let result = entries.slice(-scrollback);
    if (streamFilter && streamFilter.size > 0 && streamFilter.size < 4) {
      result = result.filter((e) => streamFilter.has(e.stream));
    }
    return result;
  }, [entries, scrollback, streamFilter]);

  // ── Create terminal once ──
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      disableStdin: true,
      convertEol: true,
      scrollback: Math.max(500, scrollback),
      fontSize: 13,
      fontFamily:
        '"JetBrains Mono Variable", "JetBrains Mono", "Fira Code", ui-monospace, monospace',
      lineHeight: 1.35,
      cursorBlink: false,
      cursorStyle: 'bar',
      cursorInactiveStyle: 'none',
      theme: readXtermTheme(),
      // Solid background — transparency forces expensive compositing on every write.
      allowTransparency: false,
      // Smooths rapid write bursts (SSE can dump dozens of lines per frame).
      smoothScrollDuration: 0,
    });

    const fit = new FitAddon();
    const search = new SearchAddon();
    const links = new WebLinksAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(links);
    term.open(host);

    // Kill xterm.css's hardcoded #000 viewport immediately (theme effect also
    // re-applies after first paint / theme changes).
    const initialBg = readXtermTheme().background || resolveThemeColor('--card', '#0b0f14');
    host.style.backgroundColor = initialBg;
    const initialViewport = host.querySelector('.xterm-viewport') as HTMLElement | null;
    if (initialViewport) initialViewport.style.backgroundColor = initialBg;
    const initialXterm = host.querySelector('.xterm') as HTMLElement | null;
    if (initialXterm) initialXterm.style.backgroundColor = initialBg;

    // Hide the block cursor entirely for a log viewer (display-only).
    term.write('\x1b[?25l');

    const fitSoon = () => {
      try {
        fit.fit();
      } catch {
        /* host may be display:none */
      }
    };
    fitSoon();
    // Debounce resize fits — raw ResizeObserver fires during layout and
    // causes visible reflow flicker while output is streaming.
    let fitTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleFit = () => {
      if (fitTimer) clearTimeout(fitTimer);
      fitTimer = setTimeout(() => {
        fitTimer = null;
        fitSoon();
      }, 50);
    };
    const fitRaf = requestAnimationFrame(fitSoon);

    const onScroll = () => {
      if (isProgrammaticScroll.current) {
        isProgrammaticScroll.current = false;
        return;
      }
      const leftover =
        term.buffer.active.length - term.buffer.active.viewportY - term.rows;
      const nearBottom = leftover <= 1;
      if (nearBottom) {
        if (showScrollBtnRef.current) {
          showScrollBtnRef.current = false;
          setShowScrollBtn(false);
          onAutoScrollResumeRef.current?.();
        }
      } else if (autoScrollRef.current || !showScrollBtnRef.current) {
        if (!showScrollBtnRef.current) {
          showScrollBtnRef.current = true;
          setShowScrollBtn(true);
        }
        onUserScrollRef.current?.();
      }
    };
    const scrollDisp = term.onScroll(onScroll);

    const ro = new ResizeObserver(() => scheduleFit());
    ro.observe(host);

    termRef.current = term;
    fitRef.current = fit;
    searchRef.current = search;
    lastWrittenIdRef.current = null;
    writtenFilterRef.current = '';
    setTermEpoch((n) => n + 1);

    return () => {
      cancelAnimationFrame(fitRaf);
      if (fitTimer) clearTimeout(fitTimer);
      scrollDisp.dispose();
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
      lastWrittenIdRef.current = null;
      writtenFilterRef.current = '';
    };
    // Create once; scrollback option is updated below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep scrollback option in sync (no rebuild).
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.scrollback = Math.max(500, scrollback);
  }, [scrollback]);

  // Keep xterm palette in lockstep with Catalyst theme tokens.
  // Triggers: light/dark class, themeStore brand colors, themeSettings surfaces.
  useEffect(() => {
    const apply = () => {
      const t = termRef.current;
      if (!t) return;
      // Defer one frame so themeStore's DOM writes (setProperty) have flushed.
      requestAnimationFrame(() => {
        const term = termRef.current;
        const host = hostRef.current;
        if (!term || !host) return;
        const theme = readXtermTheme();
        term.options.theme = theme;
        // xterm.css hardcodes `.xterm-viewport { background-color: #000 }` — that
        // is the black letterbox/frame around the cell grid. Paint host + viewport
        // with the resolved card color (and leave canvas theme bg in sync).
        const bg = theme.background || resolveThemeColor('--card', '#0b0f14');
        host.style.backgroundColor = bg;
        const viewport = host.querySelector('.xterm-viewport') as HTMLElement | null;
        if (viewport) viewport.style.backgroundColor = bg;
        const xtermEl = host.querySelector('.xterm') as HTMLElement | null;
        if (xtermEl) xtermEl.style.backgroundColor = bg;
      });
    };
    apply();

    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        apply();
      }, 50);
    };

    const mo = new MutationObserver(schedule);
    mo.observe(document.documentElement, {
      attributes: true,
      // class: .light/.dark; style: themeStore setProperty writes
      attributeFilter: ['class', 'style', 'data-theme'],
    });

    // Also react to OS preference flips if someone uses prefers-color-scheme CSS
    // without going through the store (defensive).
    const mql = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onScheme = () => schedule();
    mql?.addEventListener?.('change', onScheme);

    return () => {
      mo.disconnect();
      mql?.removeEventListener?.('change', onScheme);
      if (timer) clearTimeout(timer);
    };
  }, [appTheme, themeSettings, termEpoch]);

  const pinBottom = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    isProgrammaticScroll.current = true;
    term.scrollToBottom();
  }, []);

  /**
   * Wipe terminal buffer without the heavier RIS reset (avoids theme/cursor flash).
   * CSI 3J clears scrollback; 2J clears screen; H homes cursor.
   */
  const wipeTerminal = useCallback((term: Terminal) => {
    term.write('\x1b[3J\x1b[2J\x1b[H\x1b[?25l');
  }, []);

  // ── Sync entries → terminal (append-only when possible) ──
  useLayoutEffect(() => {
    const term = termRef.current;
    if (!term) return;

    const filterChanged = writtenFilterRef.current !== filterSig;
    const lastId = lastWrittenIdRef.current;

    // Empty buffer
    if (visibleEntries.length === 0) {
      if (lastId !== null) {
        wipeTerminal(term);
        lastWrittenIdRef.current = null;
        writtenFilterRef.current = filterSig;
      }
      return;
    }

    // Locate append point: first entry AFTER the last one we already wrote.
    let startIdx = 0;
    let needFullRewrite = filterChanged || lastId === null;

    if (!needFullRewrite && lastId !== null) {
      // Search from the end — lastId is almost always near the tail.
      let found = -1;
      for (let i = visibleEntries.length - 1; i >= 0; i--) {
        if (visibleEntries[i].id === lastId) {
          found = i;
          break;
        }
      }
      if (found === -1) {
        // lastId dropped (history replace, clear+reload, aggressive trim) → rebuild
        needFullRewrite = true;
      } else {
        startIdx = found + 1;
      }
    }

    if (needFullRewrite) {
      wipeTerminal(term);
      startIdx = 0;
    }

    if (startIdx >= visibleEntries.length) {
      // Nothing new (same tail). Filter sig may still need recording.
      writtenFilterRef.current = filterSig;
      return;
    }

    const chunk = visibleEntries
      .slice(startIdx)
      .map(formatEntry)
      .join('');

    const shouldPin = autoScrollRef.current;
    // Single write; pin after the parser drains so we don't scroll mid-chunk
    // (mid-chunk pin + reflow = flicker).
    term.write(chunk, () => {
      if (shouldPin) {
        isProgrammaticScroll.current = true;
        term.scrollToBottom();
      }
    });

    lastWrittenIdRef.current = visibleEntries[visibleEntries.length - 1].id;
    writtenFilterRef.current = filterSig;
  }, [visibleEntries, filterSig, termEpoch, wipeTerminal]);

  // Auto-scroll prop re-enabled → jump to bottom (no rewrite).
  useEffect(() => {
    if (!autoScrollProp) return;
    pinBottom();
    if (showScrollBtnRef.current) {
      showScrollBtnRef.current = false;
      setShowScrollBtn(false);
    }
  }, [autoScrollProp, pinBottom]);

  // Search highlight — query only. Re-running on every entries tick re-paints
  // decorations and is a major flicker source under live output.
  useEffect(() => {
    const search = searchRef.current;
    if (!search) return;
    if (!searchQuery) {
      search.clearDecorations();
      return;
    }
    const warning = resolveThemeColor('--warning', '#facc15');
    const warningStrong = resolveThemeColor('--warning', '#eab308');
    search.findNext(searchQuery, {
      caseSensitive: false,
      incremental: true,
      decorations: {
        matchBackground: warning,
        matchOverviewRuler: warning,
        activeMatchBackground: warningStrong,
        activeMatchColorOverviewRuler: warningStrong,
      },
    });
  }, [searchQuery, appTheme, themeSettings]);

  const scrollToBottom = useCallback(() => {
    showScrollBtnRef.current = false;
    setShowScrollBtn(false);
    pinBottom();
    onAutoScrollResumeRef.current?.();
  }, [pinBottom]);

  const hasContent = visibleEntries.length > 0;

  return (
    <div className={`relative flex min-h-0 flex-1 flex-col ${className}`}>
      <div
        ref={hostRef}
        role="log"
        aria-label="Server console output"
        aria-live="polite"
        className="console-output xterm-console-host min-h-0 w-full flex-1 overflow-hidden bg-card [&_.xterm]:h-full [&_.xterm]:w-full"
      />


      {isLoading && !hasContent && (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-border border-t-primary" />
          Loading recent logs…
        </div>
      )}

      {isError && !hasContent && (
        <div className="absolute inset-x-4 top-3 z-10 flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <span>Unable to load historical logs.</span>
          <button
            type="button"
            className="pointer-events-auto rounded border border-destructive/30 px-2 py-0.5 transition-colors hover:bg-destructive/20"
            onClick={() => onRetry?.()}
          >
            Retry
          </button>
        </div>
      )}

      {!isLoading && !hasContent && !isError && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          No console output yet.
        </div>
      )}

      {showScrollBtn && !autoScrollProp && hasContent && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-card/95 px-3 py-1.5 text-[11px] font-medium text-muted-foreground backdrop-blur-sm transition-all hover:border-primary/40 hover:text-foreground"
        >
          <ArrowDown className="h-3 w-3" />
          New output
        </button>
      )}
    </div>
  );
});

export default XtermConsole;

