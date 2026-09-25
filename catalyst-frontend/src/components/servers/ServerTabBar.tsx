import { useLayoutEffect, useRef, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
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

const TAB_CLASS =
  'relative flex h-7 shrink-0 items-center gap-1.5 rounded-sm px-2.5 text-mini font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40';

function TabButton({ tab, hidden }: { tab: ServerNavTab; hidden?: boolean }) {
  const Icon = tab.icon;
  return (
    <button
      type="button"
      title={tab.label}
      tabIndex={hidden ? -1 : undefined}
      aria-hidden={hidden || undefined}
      aria-current={!hidden && tab.active ? 'page' : undefined}
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
      <span className="text-mini">{tab.label}</span>
    </button>
  );
}

function measureKey(tabs: ServerNavTab[]) {
  return tabs.map((tab) => `${tab.key}:${tab.label}`).join('|');
}

export default function ServerTabBar({ tabs }: { tabs: ServerNavTab[] }) {
  const { t } = useTranslation('servers');
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const moreMeasureRef = useRef<HTMLButtonElement>(null);
  const [visibleCount, setVisibleCount] = useState(tabs.length);
  const tabsKey = measureKey(tabs);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const fit = () => {
      const items = Array.from(measure.querySelectorAll<HTMLElement>('[data-measure-tab]'));
      if (items.length === 0) {
        setVisibleCount(0);
        return;
      }

      const moreWidth = moreMeasureRef.current?.offsetWidth ?? 68;
      const measureStyles = getComputedStyle(measure);
      const gap = Number.parseFloat(measureStyles.columnGap || '2') || 2;
      const box = getComputedStyle(container);
      const available =
        container.clientWidth -
        (Number.parseFloat(box.paddingLeft) || 0) -
        (Number.parseFloat(box.paddingRight) || 0);

      let used = 0;
      let count = items.length;
      for (let i = 0; i < items.length; i++) {
        const next = used + items[i].offsetWidth + (i > 0 ? gap : 0);
        const remaining = items.length - (i + 1);
        if (remaining === 0) {
          count = next <= available ? items.length : i;
          break;
        }
        if (next + gap + moreWidth > available) {
          count = i;
          break;
        }
        used = next;
      }

      setVisibleCount(Math.max(1, Math.min(items.length, count)));
    };


    const ro = new ResizeObserver(fit);
    ro.observe(container);
    ro.observe(measure);
    fit();
    return () => ro.disconnect();
  }, [tabsKey]);

  const visible = tabs.slice(0, visibleCount);
  const overflow = tabs.slice(visibleCount);
  const overflowActiveTab = overflow.find((tab) => tab.active);
  const overflowActive = Boolean(overflowActiveTab);

  return (
    <div ref={containerRef} className="relative min-w-0 w-full overflow-hidden border-t border-border/50 px-1.5 py-1">
      <div
        ref={measureRef}
        className="pointer-events-none invisible absolute left-1.5 top-1 flex w-max flex-nowrap items-center gap-0.5"
        aria-hidden
      >
        {tabs.map((tab) => (
          <div key={tab.key} data-measure-tab>
            <TabButton tab={tab} hidden />
          </div>
        ))}
        <button ref={moreMeasureRef} type="button" className={TAB_CLASS} tabIndex={-1}>
          <MoreHorizontal className="h-3.5 w-3.5" />
          {t('common:actions.more')}
        </button>
      </div>

      <div className="flex min-w-0 w-full flex-nowrap items-center gap-0.5 overflow-hidden">
        {visible.map((tab) => (
          <TabButton key={tab.key} tab={tab} />
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
                <span className="text-mini">{t('common:actions.more')}</span>
                {overflowActiveTab && (
                  <>
                    <span className="text-micro text-muted-foreground" aria-hidden>
                      ·
                    </span>
                    <span className="text-mini text-foreground">{overflowActiveTab.label}</span>
                  </>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              {overflow.map((tab) => {
                const Icon = tab.icon;
                return (
                  <DropdownMenuItem
                    key={tab.key}
                    className={tab.active ? 'bg-primary/10 text-foreground' : undefined}
                    onSelect={tab.onSelect}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {tab.label}
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
