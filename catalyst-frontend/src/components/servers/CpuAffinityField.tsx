import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  countCpus,
  cpuAffinityChips,
  normalizeCpuAffinity,
  parseCpuList,
  toggleCpus,
} from '@/lib/cpuAffinity';
import { MAX_CPU_AFFINITY_LENGTH } from '@/lib/serverLimits';

/** Deck field chrome — matches the surrounding resource inputs. */
const fieldClass =
  'h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 font-mono text-mini tabular-nums text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40';

type Props = {
  /**
   * CPU set the node's agent reported, in canonical form. null/undefined means
   * the node has not told us yet, which degrades the control to a text field.
   */
  hostCpuSet?: string | null;
  /** Raw field text: a CPU list, or '' for "no pinning" (all CPUs). */
  value: string;
  onChange: (next: string) => void;
  /** CPUs the server is allocated — a smaller pin is rejected by the API. */
  allocatedCpuCores: number;
  /** Set while the server runs: affinity only takes effect on the next start. */
  appliesOnNextStart?: boolean;
};

/**
 * The CPU-pinning control shared by the create and update dialogs.
 *
 * A node that reported its CPU set gets a picker over exactly those CPUs (one
 * chip per CPU, grouped into runs once the set is large), because the mask is
 * written in the node's own CPU numbering and only that set is pinnable. A node
 * that has not reported one gets a text field with inline validation instead —
 * guessing a topology here would offer CPUs the node may not have. Either way
 * the canonical form of the selection is shown, and the cores rule (a pin may
 * not be smaller than the allocation) is reported inline before the API sees it.
 */
export default function CpuAffinityField({
  hostCpuSet,
  value,
  onChange,
  allocatedCpuCores,
  appliesOnNextStart = false,
}: Props) {
  const { t } = useTranslation('servers');

  // An unparseable reported set is treated as unknown, not as an empty host.
  const hostCpus = useMemo(() => {
    if (!hostCpuSet) return null;
    const parsed = parseCpuList(hostCpuSet);
    return parsed && parsed.length ? parsed : null;
  }, [hostCpuSet]);
  const chips = useMemo(() => (hostCpus ? cpuAffinityChips(hostCpus) : []), [hostCpus]);

  const normalized = normalizeCpuAffinity(value);
  const mask = normalized.ok ? normalized.mask : null;
  const selectedCpus = normalized.ok ? countCpus(mask) : 0;
  const selected = useMemo(() => new Set(mask ? parseCpuList(mask) ?? [] : []), [mask]);
  const belowAllocation =
    normalized.ok &&
    mask !== null &&
    Number.isFinite(allocatedCpuCores) &&
    selectedCpus < allocatedCpuCores;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="type-overline">{t('cpuAffinity.title')}</span>
        <code className="type-numeric text-mini text-foreground">
          {mask ?? t('cpuAffinity.allCpus')}
        </code>
      </div>

      {hostCpus ? (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            aria-pressed={mask === null}
            onClick={() => onChange('')}
            className={cn(
              'h-7 rounded-sm border px-2 text-mini transition-colors',
              mask === null
                ? 'border-primary bg-primary/15 font-medium text-foreground'
                : 'border-border/60 text-muted-foreground hover:border-primary/50 hover:text-foreground',
            )}
          >
            {t('cpuAffinity.allCpus')}
          </button>
          {chips.map((chip) => {
            const active = chip.cpus.every((cpu) => selected.has(cpu));
            return (
              <button
                key={chip.key}
                type="button"
                aria-pressed={active}
                onClick={() => onChange(toggleCpus(mask, chip.cpus) ?? '')}
                className={cn(
                  'h-7 rounded-sm border px-2 font-mono text-mini tabular-nums transition-colors',
                  active
                    ? 'border-primary bg-primary/15 font-medium text-foreground'
                    : 'border-border/60 text-muted-foreground hover:border-primary/50 hover:text-foreground',
                )}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      ) : (
        <input
          className={fieldClass}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={MAX_CPU_AFFINITY_LENGTH}
          placeholder={t('cpuAffinity.placeholder')}
          aria-label={t('cpuAffinity.title')}
          aria-invalid={!normalized.ok}
        />
      )}

      {!normalized.ok ? (
        <p role="alert" className="text-micro text-danger">
          {t('cpuAffinity.invalid')}
        </p>
      ) : null}

      {belowAllocation ? (
        <p role="alert" className="text-micro text-danger">
          {t('cpuAffinity.belowAllocation', {
            cores: allocatedCpuCores,
            cpus: selectedCpus,
          })}
        </p>
      ) : null}

      {hostCpus ? (
        <p className="type-meta">
          {t('cpuAffinity.selection', { cpus: selectedCpus, total: hostCpus.length })}
        </p>
      ) : (
        <p className="type-meta">{t('cpuAffinity.unknownSetHint')}</p>
      )}

      {appliesOnNextStart ? (
        <p className="text-micro text-warning">{t('cpuAffinity.appliesOnNextStart')}</p>
      ) : null}
    </div>
  );
}
