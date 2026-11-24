import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  SlidersHorizontal,
  Search,
  RotateCcw,
  Check,
  Lock,
  RefreshCw,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import TabHeader from '../../components/servers/tabs/TabHeader';
import LastUpdated from '../../components/shared/LastUpdated';
import { qk } from '@/lib/queryKeys';
import { BracketLabel } from '../../components/deck/primitives';
import { Input } from '../../components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Switch } from '../../components/ui/switch';
import { Skeleton } from '../../components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import {
  useEnvSettings,
  useEnvRestartStatus,
  useResetEnvSetting,
  useRestartPanel,
  useUpdateEnvSettings,
} from '../../hooks/useAdmin';
import { notifyError, notifySuccess } from '../../utils/notify';
import ConfirmDialog from '../../components/shared/ConfirmDialog';
import type { EnvCategory, EnvEntry } from '../../types/admin';

const CATEGORY_ORDER: EnvCategory[] = [
  'general',
  'urls',
  'server',
  'database',
  'auth',
  'oauth',
  'limits',
  'suspension',
  'storage',
  'backups',
  'plugins',
  'redis',
  'performance',
  'updates',
  'developer',
];

function sourceVariant(source: EnvEntry['source']): 'default' | 'secondary' | 'outline' {
  if (source === 'database') return 'default';
  if (source === 'environment') return 'secondary';
  return 'outline';
}

function EnvRow({
  entry,
  onSaved,
  reportDraft = () => {},
}: {
  entry: EnvEntry;
  onSaved: () => void;
  /**
   * Reports this row's pending value (or `null` when clean) so the page's
   * "Save all changed" can send every changed key in one PATCH.
   */
  reportDraft?: (key: string, value: string | null) => void;
}) {
  const { t } = useTranslation('admin-environment');
  // Literal t() calls so the extractor sees every label key.
  const sourceLabels: Record<EnvEntry['source'], string> = {
    database: t('source.database'),
    environment: t('source.environment'),
    default: t('source.default'),
    unset: t('source.unset'),
  };
  const updateMutation = useUpdateEnvSettings();
  const resetMutation = useResetEnvSetting();
  const [draft, setDraft] = useState(entry.secret ? '' : (entry.value ?? ''));
  const [syncedValue, setSyncedValue] = useState(entry.value);

  // Re-sync the field when the server sends a new value (e.g. after reset).
  if (entry.value !== syncedValue) {
    setSyncedValue(entry.value);
    setDraft(entry.secret ? '' : (entry.value ?? ''));
  }

  const original = entry.secret ? '' : (entry.value ?? '');
  const dirty = entry.editable && draft !== original && !(entry.secret && draft === '');

  const save = () => {
    updateMutation.mutate(
      { [entry.key]: draft },
      {
        onSuccess: () => {
          setDraft(entry.secret ? '' : draft);
          notifySuccess(t('toast.saved', { key: entry.key }));
          if (entry.secret) setDraft('');
          onSaved();
        },
        onError: (error: any) => notifyError(error),
      },
    );
  };

  // Report the dirty draft upward so the page can batch every changed value in
  // one PATCH. The callback only touches a ref + a count, so typing never
  // re-renders the whole page.
  useEffect(() => {
    reportDraft(entry.key, dirty ? draft : null);
  }, [entry.key, draft, dirty, reportDraft]);

  const reset = () => {
    resetMutation.mutate(entry.key, {
      onSuccess: () => {
        notifySuccess(t('toast.reset', { key: entry.key }));
        onSaved();
      },
      onError: (error: any) => notifyError(error),
    });
  };

  const busy = updateMutation.isPending || resetMutation.isPending;

  const control = (() => {
    if (!entry.editable) {
      // Bootstrap-only: the value must be set in .env before startup.
      const display = entry.secret
        ? entry.isSet
          ? t('value.configured')
          : t('value.unset')
        : (entry.value ?? t('value.unset'));
      return (
        <span className="flex items-center gap-1.5 font-mono text-mini text-muted-foreground">
          <Lock className="h-3 w-3" />
          {display}
        </span>
      );
    }
    if (entry.type === 'boolean') {
      return (
        <div className="flex items-center gap-2">
          <Switch
            checked={draft === 'true'}
            onCheckedChange={(checked) => setDraft(checked ? 'true' : 'false')}
            disabled={busy}
            aria-label={entry.key}
          />
          <span className="font-mono text-mini text-muted-foreground">
            {draft === 'true' ? t('value.true') : t('value.false')}
          </span>
        </div>
      );
    }
    if (entry.type === 'enum' && entry.options?.length) {
      return (
        <Select value={draft || entry.options[0]} onValueChange={setDraft} disabled={busy}>
          <SelectTrigger className="h-8 w-full rounded-sm border-border/40 text-mini sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {entry.options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    return (
      <Input
        type={entry.secret ? 'password' : entry.type === 'number' ? 'number' : 'text'}
        autoComplete="off"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        disabled={busy}
        placeholder={
          entry.secret && entry.isSet
            ? t('value.secretUnchanged')
            : (entry.placeholder ?? entry.default ?? '')
        }
        min={entry.min}
        max={entry.max}
        className="h-8 w-full rounded-sm border-border/40 font-mono text-mini sm:w-56"
      />
    );
  })();

  return (
    <div className="deck-panel px-3 py-2.5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <BracketLabel>{entry.key}</BracketLabel>
            <Badge variant={sourceVariant(entry.source)} className="text-micro">
              {sourceLabels[entry.source]}
            </Badge>
            {!entry.editable && (
              <Badge variant="outline" className="text-micro">
                {t('badge.envOnly')}
              </Badge>
            )}
            {entry.changedSinceBoot && entry.restartRequired && (
              <Badge variant="destructive" className="text-micro">
                {t('badge.restartPending')}
              </Badge>
            )}
          </div>
          <p className="text-mini text-muted-foreground">{entry.title}</p>
          {entry.description && (
            <p className="max-w-2xl text-micro text-muted-foreground/80">{entry.description}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
          <div className="flex items-center gap-2">
            {control}
            {entry.editable && (
              <>
                <Button
                  size="sm"
                  className="h-8 px-2 text-mini"
                  disabled={!dirty || busy}
                  onClick={save}
                >
                  <Check className="mr-1 h-3 w-3" />
                  {t('actions.save')}
                </Button>
                {entry.hasOverride && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2 text-mini text-muted-foreground"
                    disabled={busy}
                    onClick={reset}
                    title={t('actions.reset')}
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span className="sr-only">{t('actions.reset')}</span>
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RestartCta() {
  const { t } = useTranslation('admin-environment');
  const restartMutation = useRestartPanel();
  const { data: status } = useEnvRestartStatus(true);
  const strategy = status?.strategy ?? 'supervised';
  const [restarting, setRestarting] = useState(false);
  // Restarting takes the panel offline for every user, so it is confirmed.
  const [confirming, setConfirming] = useState(false);

  const restart = () => {
    restartMutation.mutate(undefined, {
      onSuccess: () => {
        setConfirming(false);
        setRestarting(true);
        notifySuccess(t('restart.started'));
      },
      onError: (error: any) => notifyError(error),
    });
  };

  return (
    <div className="deck-panel border-l-2 border-l-primary px-3 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 text-primary" />
          <div>
            <p className="text-mini font-medium text-foreground">{t('restart.title')}</p>
            <p className="text-micro text-muted-foreground">
              {strategy === 'standalone'
                ? t('restart.standaloneHint')
                : t('restart.description')}
            </p>
          </div>
        </div>
        <Button
          size="sm"
          className="h-8 shrink-0 gap-1.5 px-3 text-mini"
          onClick={() => setConfirming(true)}
          disabled={restarting || restartMutation.isPending}
        >
          {restarting || restartMutation.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          {restarting ? t('restart.restarting') : t('restart.button')}
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        title={t('restart.confirmTitle')}
        message={t('restart.confirmMessage')}
        confirmText={t('restart.button')}
        cancelText={t('common:actions.cancel')}
        loading={restartMutation.isPending}
        onConfirm={restart}
        onCancel={() => {
          if (!restartMutation.isPending) setConfirming(false);
        }}
      />
    </div>
  );
}

function EnvironmentPage() {
  const { t } = useTranslation('admin-environment');
  // Literal t() calls so the extractor sees every label key.
  const categoryLabels: Record<EnvCategory, string> = {
    general: t('categories.general'),
    urls: t('categories.urls'),
    server: t('categories.server'),
    database: t('categories.database'),
    auth: t('categories.auth'),
    oauth: t('categories.oauth'),
    limits: t('categories.limits'),
    suspension: t('categories.suspension'),
    storage: t('categories.storage'),
    backups: t('categories.backups'),
    plugins: t('categories.plugins'),
    redis: t('categories.redis'),
    performance: t('categories.performance'),
    updates: t('categories.updates'),
    developer: t('categories.developer'),
  };
  const { data: overview, isLoading, isError, refetch } = useEnvSettings();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'all' | EnvCategory>('all');

  // Changed (but unsaved) values, reported by each row. Kept in a ref plus a
  // counter so typing does not re-render every field on the page.
  const changedRef = useRef<Map<string, string>>(new Map());
  const [changedCount, setChangedCount] = useState(0);
  const reportDraft = useCallback((key: string, value: string | null) => {
    const map = changedRef.current;
    if (value === null) {
      if (map.delete(key)) setChangedCount(map.size);
      return;
    }
    if (map.get(key) === value) return;
    map.set(key, value);
    setChangedCount(map.size);
  }, []);

  const batchSaveMutation = useUpdateEnvSettings();
  const saveAllChanged = () => {
    const values = Object.fromEntries(changedRef.current);
    if (Object.keys(values).length === 0) return;
    batchSaveMutation.mutate(values, {
      onSuccess: () => {
        changedRef.current.clear();
        setChangedCount(0);
        notifySuccess(t('toast.savedAll', { count: Object.keys(values).length }));
        refetch();
      },
      onError: (error: any) => notifyError(error),
    });
  };

  const entries = useMemo(() => {
    const list = overview?.entries ?? [];
    const needle = query.trim().toLowerCase();
    return list.filter((entry) => {
      if (category !== 'all' && entry.category !== category) return false;
      if (!needle) return true;
      return (
        entry.key.toLowerCase().includes(needle) ||
        entry.title.toLowerCase().includes(needle) ||
        (entry.description ?? '').toLowerCase().includes(needle)
      );
    });
  }, [overview?.entries, query, category]);

  const groups = useMemo(() => {
    const byCategory = new Map<EnvCategory, EnvEntry[]>();
    for (const entry of entries) {
      const bucket = byCategory.get(entry.category) ?? [];
      bucket.push(entry);
      byCategory.set(entry.category, bucket);
    }
    return CATEGORY_ORDER.filter((cat) => byCategory.has(cat)).map((cat) => ({
      category: cat,
      entries: byCategory.get(cat)!,
    }));
  }, [entries]);

  const overriddenCount = (overview?.entries ?? []).filter((entry) => entry.hasOverride).length;

  return (
    <div className="space-y-5">
      <TabHeader
        icon={SlidersHorizontal}
        title={t('title')}
        description={t('description', { overridden: overriddenCount })}
        actions={<LastUpdated queryKey={qk.adminEnv()} />}
      />

      {overview?.restartRequired && <RestartCta />}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('searchPlaceholder')}
            className="h-8 rounded-sm border-border/40 pl-7 text-mini"
          />
        </div>
        <Select value={category} onValueChange={(next) => setCategory(next as typeof category)}>
          <SelectTrigger className="h-8 w-full rounded-sm border-border/40 text-mini sm:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('categories.all')}</SelectItem>
            {CATEGORY_ORDER.map((cat) => (
              <SelectItem key={cat} value={cat}>
                {categoryLabels[cat]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 px-2 text-mini text-muted-foreground"
          onClick={() => refetch()}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span className="sr-only">{t('actions.refresh')}</span>
        </Button>
        </div>

      {/* Batch save: one PATCH for every changed row, instead of one click per
          field. Disabled while nothing is dirty or a save is in flight. */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border/50 bg-surface-1/30 px-3 py-2">
        <span className="text-mini text-muted-foreground">
          {changedCount > 0
            ? t('actions.changedCount', { count: changedCount })
            : t('actions.noChanges')}
        </span>
        <Button
          size="sm"
          className="h-8 gap-1.5 px-3 text-mini"
          disabled={changedCount === 0 || batchSaveMutation.isPending}
          onClick={saveAllChanged}
        >
          {batchSaveMutation.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Check className="h-3 w-3" />
          )}
          {batchSaveMutation.isPending ? t('actions.savingAll') : t('actions.saveAll')}
        </Button>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-16 w-full rounded-sm" />
          ))}
        </div>
      )}

      {isError && (
        <div className="deck-panel flex flex-col items-center gap-3 px-3 py-6 text-center text-mini text-muted-foreground">
          <span>{t('loadError')}</span>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 px-3 text-mini"
            onClick={() => refetch()}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t('common:actions.retry')}
          </Button>
        </div>
      )}

      {!isLoading && !isError && groups.length === 0 && (
        <div className="deck-panel px-3 py-6 text-center text-mini text-muted-foreground">
          {t('empty')}
        </div>
      )}

      <div className="space-y-5">
        {groups.map((group) => (
          <section key={group.category} className="space-y-2">
            <BracketLabel>{categoryLabels[group.category]}</BracketLabel>
            <div className="space-y-2">
              {group.entries.map((entry) => (
                <EnvRow key={entry.key} entry={entry} onSaved={() => refetch()} reportDraft={reportDraft} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export default EnvironmentPage;
