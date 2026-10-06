import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  SlidersHorizontal,
  Search,
  RotateCcw,
  Check,
  Lock,
  RefreshCw,
  AlertTriangle,
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
}: {
  entry: EnvEntry;
  onSaved: () => void;
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

  const restart = () => {
    restartMutation.mutate(undefined, {
      onSuccess: () => {
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
        <Button size="sm" className="h-8 shrink-0 px-3 text-mini" onClick={restart} disabled={restarting || restartMutation.isPending}>
          <RefreshCw className={`mr-1.5 h-3 w-3 ${restarting ? 'animate-spin' : ''}`} />
          {restarting ? t('restart.restarting') : t('restart.button')}
        </Button>
      </div>
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

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-16 w-full rounded-sm" />
          ))}
        </div>
      )}

      {isError && (
        <div className="deck-panel px-3 py-6 text-center text-mini text-muted-foreground">
          {t('loadError')}
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
                <EnvRow key={entry.key} entry={entry} onSaved={() => refetch()} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export default EnvironmentPage;
