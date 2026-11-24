import { useLayoutEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { useQuery } from '@/csync';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export type ServerNavTab = {
  key: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  active: boolean;
  onSelect: () => void;
};

/**
 * Pages an operator uses while working on a server. They stay on the bar at any
 * width — dropping to their icon first, and only ever moving to "More" as a last
 * resort — because Backups and Tasks behind a menu cost a click every visit
 * (audit D-13/overflow). Everything else (Sftp, Databases, Metrics, Admin, …)
 * overflows in order.
 */
const PINNED_TAB_KEYS = ['console', 'files', 'backups', 'tasks'] as const;
const PINNED = new Set<string>(PINNED_TAB_KEYS);

/** Query key written by `hooks/useModUpdates.ts` (mods-config workstream). */
const modUpdatesSummaryKey = (serverId: string) => ['mod-updates-summary', serverId] as const;

const TAB_CLASS =
  'relative flex h-7 min-h-7 shrink-0 items-center gap-1.5 rounded-sm px-2.5 text-mini font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:min-h-8';

function TabButton({
  tab,
  hidden,
  iconOnly,
  badge,
}: {
  tab: ServerNavTab;
  hidden?: boolean;
  iconOnly?: boolean;
  badge?: number;
}) {
  const Icon = tab.icon;
  return (
    <button
      type="button"
      title={tab.label}
      tabIndex={hidden ? -1 : undefined}
      aria-hidden={hidden || undefined}
      aria-current={!hidden && tab.active ? 'page' : undefined}
      // An icon-only pin keeps its name for screen readers and tooltips.
      aria-label={iconOnly ? badge ? `${tab.label} (${badge})` : tab.label : undefined}
      className={cn(
        TAB_CLASS,
        tab.active
          ? 'text-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
      onClick={hidden ? undefined : tab.onSelect}
    >
      {tab.active && (
        <span className="absolute inset-x-1.5 bottom-0 h-[2px] bg-primary" aria-hidden />
      )}
      <Icon className="h-3.5 w-3.5" />
      {iconOnly ? null : <span className="text-mini">{tab.label}</span>}
      {badge ? (
        <span
          className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[10px] leading-none text-primary-foreground tabular-nums"
          aria-hidden
        >
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </button>
  );
}

function measureKey(tabs: ServerNavTab[]) {
  return tabs.map((tab) => `${tab.key}:${tab.label}`).join('|');
}

type Fit = { pinIconOnly: boolean; extraVisible: number };

export default function ServerTabBar({
  tabs,
  serverId,
}: {
  tabs: ServerNavTab[];
  /** Server whose mod-update badge to show; the summary query is read-only. */
  serverId?: string;
}) {
  const { t } = useTranslation('servers');
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const moreMeasureRef = useRef<HTMLButtonElement>(null);
  const [fit, setFit] = useState<Fit>({ pinIconOnly: false, extraVisible: tabs.length });
  const tabsKey = measureKey(tabs);

  // Badge only: the summary is owned by the Mods tab (mods-config workstream),
  // so this query never fetches — it just reads whatever that key already holds.
  const { data: modSummary } = useQuery<{ updates?: number }>({
    queryKey: modUpdatesSummaryKey(serverId ?? ''),
    enabled: false,
  });
  const modUpdateCount = useMemo(() => {
    const value = Number(modSummary?.updates ?? 0);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }, [modSummary]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const fitInto = () => {
      const pinnedLabel = new Map<string, number>();
      const pinnedIcon = new Map<string, number>();
      const others = new Map<string, number>();
      measure.querySelectorAll<HTMLElement>('[data-measure]').forEach((el) => {
        const kind = el.dataset.measure ?? '';
        const key = el.dataset.measureKey ?? '';
        const width = el.offsetWidth;
        if (kind === 'pin-label') pinnedLabel.set(key, width);
        else if (kind === 'pin-icon') pinnedIcon.set(key, width);
        else if (kind === 'other') others.set(key, width);
      });

      const moreWidth = moreMeasureRef.current?.offsetWidth ?? 68;
      const measureStyles = getComputedStyle(measure);
      const gap = Number.parseFloat(measureStyles.columnGap || '2') || 2;
      const box = getComputedStyle(container);
      const available =
        container.clientWidth -
        (Number.parseFloat(box.paddingLeft) || 0) -
        (Number.parseFloat(box.paddingRight) || 0);
      if (available <= 0) return;

      const pinnedTabs = tabs.filter((tab) => PINNED.has(tab.key));
      const otherTabs = tabs.filter((tab) => !PINNED.has(tab.key));
      const total = pinnedTabs.length + otherTabs.length;
      if (total === 0) {
        setFit({ pinIconOnly: false, extraVisible: 0 });
        return;
      }

      const pinnedTotal = (iconOnly: boolean) =>
        pinnedTabs.reduce((sum, tab) => sum + (iconOnly ? pinnedIcon.get(tab.key) ?? 40 : pinnedLabel.get(tab.key) ?? 90), 0) +
        (pinnedTabs.length > 0 ? gap * (pinnedTabs.length - 1) : 0);

      // Count how many non-pinned tabs still fit, keeping room for "More" when
      // anything is left over.
      const extrasFor = (pinnedWidth: number) => {
        let used = pinnedWidth;
        let count = 0;
        for (let i = 0; i < otherTabs.length; i += 1) {
          const width = others.get(otherTabs[i].key) ?? 80;
          const remainingAfter = otherTabs.length - (i + 1);
          const reserve = remainingAfter > 0 || pinnedWidth > 0 ? gap + moreWidth : 0;
          const needed = (pinnedWidth > 0 || count > 0 ? gap : 0) + width;
          if (used + needed + reserve > available) break;
          used += needed;
          count += 1;
        }
        return count;
      };

      // Labels for the pins first. Icon-only is the fallback that keeps them on
      // the bar when labels no longer fit — it is never used to squeeze in a
      // lesser tab while the pins would have shown their names.
      const labelPinnedWidth = pinnedTotal(false);
      const iconPinnedWidth = pinnedTotal(true);
      const labelFits = labelPinnedWidth + (otherTabs.length > 0 ? gap + moreWidth : 0) <= available;
      if (labelFits) {
        setFit({ pinIconOnly: false, extraVisible: extrasFor(labelPinnedWidth) });
        return;
      }
      setFit({ pinIconOnly: true, extraVisible: extrasFor(iconPinnedWidth) });
    };

    const ro = new ResizeObserver(fitInto);
    ro.observe(container);
    ro.observe(measure);
    fitInto();
    return () => ro.disconnect();
  }, [tabsKey]); // eslint-disable-line react-hooks/exhaustive-deps -- keyed re-measure

  const { visible, overflow } = useMemo(() => {
    const shown: ServerNavTab[] = [];
    const hidden: ServerNavTab[] = [];
    let extras = 0;
    for (const tab of tabs) {
      if (PINNED.has(tab.key)) {
        shown.push(tab);
        continue;
      }
      if (extras < fit.extraVisible) {
        shown.push(tab);
        extras += 1;
      } else {
        hidden.push(tab);
      }
    }
    return { visible: shown, overflow: hidden };
  }, [tabs, fit.extraVisible]);

  const overflowActiveTab = overflow.find((tab) => tab.active);
  const overflowActive = Boolean(overflowActiveTab);
  const badgeFor = (key: string) => (key === 'modManager' ? modUpdateCount : 0);

  return (
    <div ref={containerRef} className="relative min-w-0 w-full overflow-hidden border-t border-border/50 px-1.5 py-1">
      <div
        ref={measureRef}
        className="pointer-events-none invisible absolute left-1.5 top-1 flex w-max flex-nowrap items-center gap-0.5"
        aria-hidden
      >
        {tabs.map((tab) =>
          PINNED.has(tab.key) ? (
            <div key={`label-${tab.key}`} data-measure="pin-label" data-measure-key={tab.key}>
              <TabButton tab={tab} hidden />
            </div>
          ) : (
            <div key={`other-${tab.key}`} data-measure="other" data-measure-key={tab.key}>
              <TabButton tab={tab} hidden />
            </div>
          ),
        )}
        {tabs
          .filter((tab) => PINNED.has(tab.key))
          .map((tab) => (
            <div key={`icon-${tab.key}`} data-measure="pin-icon" data-measure-key={tab.key}>
              <TabButton tab={tab} hidden iconOnly />
            </div>
          ))}
        <button ref={moreMeasureRef} type="button" className={TAB_CLASS} tabIndex={-1}>
          <MoreHorizontal className="h-3.5 w-3.5" />
          {t('common:actions.more')}
        </button>
      </div>

      <div className="flex min-w-0 w-full flex-nowrap items-center gap-0.5 overflow-hidden">
        {visible.map((tab) => (
          <TabButton
            key={tab.key}
            tab={tab}
            // Pins drop to their icon first; the pages that still fit keep
            // their label (audit D-13 overflow).
            iconOnly={fit.pinIconOnly && PINNED.has(tab.key)}
            badge={badgeFor(tab.key)}
          />
        ))}
        {overflow.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  TAB_CLASS,
                  overflowActive
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                aria-label={overflowActiveTab?.label ?? t('tabBar.moreTabs')}
                aria-current={overflowActive ? 'page' : undefined}
                title={overflowActiveTab?.label}
              >
                {overflowActive && (
                  <span className="absolute inset-x-1.5 bottom-0 h-[2px] bg-primary" aria-hidden />
                )}
                <MoreHorizontal className="h-3.5 w-3.5" />
                <span className="text-mini">
                  {overflowActiveTab ? overflowActiveTab.label : t('common:actions.more')}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              {overflow.map((tab) => {
                const Icon = tab.icon;
                const badge = badgeFor(tab.key);
                return (
                  <DropdownMenuItem
                    key={tab.key}
                    className={tab.active ? 'bg-primary/10 text-foreground' : undefined}
                    onSelect={tab.onSelect}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {tab.label}
                    {badge ? (
                      <span className="ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[10px] leading-none text-primary-foreground tabular-nums">
                        {badge > 99 ? '99+' : badge}
                      </span>
                    ) : null}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

    </div>
  );
}