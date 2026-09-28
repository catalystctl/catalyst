import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@/csync';
import {
  ArrowUpCircle,
  Container,
  Clock,
  Tag,
  CheckCircle2,
  XCircle,
  Loader2,
  Info,
  RefreshCw,
  Server,
  Save,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { qk } from '@/lib/queryKeys';
import { formatDateTime } from '@/i18n/format';
import { adminApi } from '../../services/api/admin';
import { nodesApi } from '../../services/api/nodes';
import { notifyError, notifySuccess } from '../../utils/notify';
import UpdateProgressModal from './UpdateProgressModal';

/** Poll cadences the UI offers; the backend accepts any value in its range. */
const INTERVAL_OPTIONS = [
  { value: 60 * 60 * 1000, labelKey: 'update.auto.intervalOptions.hourly' },
  { value: 6 * 60 * 60 * 1000, labelKey: 'update.auto.intervalOptions.sixHours' },
  { value: 12 * 60 * 60 * 1000, labelKey: 'update.auto.intervalOptions.twelveHours' },
  { value: 24 * 60 * 60 * 1000, labelKey: 'update.auto.intervalOptions.daily' },
] as const;

function InfoRow({
  icon,
  label,
  value,
  badge,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <span className="text-mini text-muted-foreground">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-mini tabular-nums text-foreground">{value}</span>
        {badge}
      </div>
    </div>
  );
}

/** Compare two dotted versions; true when `latest` is newer than `current`. */
function isVersionBehind(current: string | null | undefined, latest: string | null | undefined): boolean {
  if (!current || !latest) return false;
  const cur = current.replace(/^v/i, '').split('.').map(Number);
  const lat = latest.replace(/^v/i, '').split('.').map(Number);
  for (let i = 0; i < Math.max(cur.length, lat.length); i++) {
    const a = cur[i] || 0;
    const b = lat[i] || 0;
    if (b > a) return true;
    if (b < a) return false;
  }
  return false;
}

export default function UpdateSettings() {
  const { t } = useTranslation('admin');
  const queryClient = useQueryClient();
  const [progressOpen, setProgressOpen] = useState(false);

  const { data: status, isLoading } = useQuery({
    queryKey: qk.adminUpdateStatus(),
    queryFn: adminApi.updateStatus,
    staleTime: 15_000,
    refetchInterval: 60_000,
  });

  const { data: settings } = useQuery({
    queryKey: qk.adminUpdateSettings(),
    queryFn: adminApi.updateSettings,
    staleTime: 30_000,
  });

  const { data: nodes, isLoading: nodesLoading } = useQuery({
    queryKey: qk.nodes(),
    queryFn: nodesApi.list,
    staleTime: 30_000,
  });

  // ── Panel update automation ──────────────────────────────────────────
  const enabled = settings?.enabled ?? status?.autoUpdateEnabled ?? false;
  const autoTrigger = settings?.autoTrigger ?? status?.autoUpdateAutoTrigger ?? false;
  const intervalMs = settings?.intervalMs ?? status?.autoUpdateIntervalMs ?? INTERVAL_OPTIONS[0].value;

  const settingsMutation = useMutation({
    mutationFn: adminApi.saveUpdateSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.adminUpdateSettings() });
      queryClient.invalidateQueries({ queryKey: qk.adminUpdateStatus() });
    },
    onError: (error: unknown) => notifyError(error, t('update.toast.saveFailed')),
  });

  const checkMutation = useMutation({
    mutationFn: adminApi.checkForUpdate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.adminUpdateStatus() });
      queryClient.invalidateQueries({ queryKey: qk.updateCheck() });
    },
    onError: (error: unknown) => notifyError(error, t('update.toast.checkFailed')),
  });

  const triggerMutation = useMutation({
    mutationFn: adminApi.triggerUpdate,
    onSuccess: (result) => {
      // Modal is already open (opened on click so logs stream from the start);
      // the backend state endpoint reports pull/restart progress or the failure.
      if (!result.success) {
        notifyError(result.message || t('update.toast.failed'));
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.adminUpdateStatus() });
    },
    onError: (error: any) => {
      notifyError(error);
    },
  });

  const canTrigger = status?.isDocker && status?.updateAvailable;

  // ── Per-node automatic updates ───────────────────────────────────────
  // The draft is seeded from the server once and edits stay local until saved,
  // so toggling a row never sends a request on its own.
  const [nodeDraft, setNodeDraft] = useState<Record<string, boolean>>({});
  const seededRef = useRef(false);

  useEffect(() => {
    if (nodesLoading || !nodes || seededRef.current) return;
    const next: Record<string, boolean> = {};
    for (const node of nodes) next[node.id] = node.autoUpdateEnabled === true;
    setNodeDraft(next);
    seededRef.current = true;
  }, [nodes, nodesLoading]);

  const pendingChanges = useMemo(() => {
    if (!nodes) return [] as { id: string; enabled: boolean }[];
    const changes: { id: string; enabled: boolean }[] = [];
    for (const node of nodes) {
      const draft = nodeDraft[node.id];
      if (draft === undefined) continue;
      if (draft !== (node.autoUpdateEnabled === true)) {
        changes.push({ id: node.id, enabled: draft });
      }
    }
    return changes;
  }, [nodes, nodeDraft]);

  const nodesMutation = useMutation({
    mutationFn: ({ nodeIds, enabled: next }: { nodeIds: string[]; enabled: boolean }) =>
      adminApi.setNodeAutoUpdate(nodeIds, next),
    onSuccess: (_result, variables) => {
      seededRef.current = false;
      queryClient.invalidateQueries({ queryKey: qk.nodes() });
      notifySuccess(
        variables.enabled
          ? t('update.auto.toast.enabled', { count: variables.nodeIds.length })
          : t('update.auto.toast.disabled', { count: variables.nodeIds.length }),
      );
    },
    onError: (error: unknown) => notifyError(error, t('update.auto.toast.failed')),
  });

  const setDraft = (nodeId: string, next: boolean) => {
    setNodeDraft((prev) => ({ ...prev, [nodeId]: next }));
  };

  const bulkSet = (next: boolean) => {
    if (!nodes) return;
    setNodeDraft(Object.fromEntries(nodes.map((node) => [node.id, next])));
  };

  const selectedCount = Object.values(nodeDraft).filter(Boolean).length;
  const visibleNodes = nodes ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isLoading ? (
            <Skeleton className="h-5 w-20" />
          ) : status?.updateAvailable ? (
            <Badge variant="success" className="text-micro">
              {t('update.available')}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-micro">
              {t('update.upToDate')}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-3 text-mini"
            disabled={checkMutation.isPending}
            onClick={() => checkMutation.mutate()}
          >
            {checkMutation.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            {t('update.checkNow')}
          </Button>
          <Button
            size="sm"
            className="h-8 px-3 text-mini"
            disabled={isLoading || triggerMutation.isPending || !canTrigger}
            onClick={() => {
              setProgressOpen(true);
              triggerMutation.mutate();
            }}
          >
            {triggerMutation.isPending ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                {t('update.triggering')}
              </>
            ) : (
              <>
                <ArrowUpCircle className="mr-1.5 h-3.5 w-3.5" />
                {t('update.trigger')}
              </>
            )}
          </Button>
        </div>
      </div>

      {!isLoading && !status?.isDocker && (
        <div className="flex items-start gap-2 rounded-sm border border-warning/20 bg-warning/5 px-3 py-1.5 text-mini text-warning">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{t('update.standaloneNotice')}</span>
        </div>
      )}

      <div className="divide-y divide-border/40">
        {isLoading ? (
          <>
            <div className="py-1.5">
              <Skeleton className="h-5 w-full" />
            </div>
            <div className="py-1.5">
              <Skeleton className="h-5 w-full" />
            </div>
            <div className="py-1.5">
              <Skeleton className="h-5 w-full" />
            </div>
            <div className="py-1.5">
              <Skeleton className="h-5 w-full" />
            </div>
          </>
        ) : (
          <>
            <InfoRow
              icon={<Tag className="h-3.5 w-3.5" />}
              label={t('update.currentVersion')}
              value={status?.currentVersion ?? t('common:actions.unknown')}
            />
            <InfoRow
              icon={<Tag className="h-3.5 w-3.5" />}
              label={t('update.latestVersion')}
              value={status?.latestVersion ?? t('common:actions.unknown')}
              badge={
                status?.updateAvailable ? (
                  <Badge variant="success" className="text-micro">
                    {t('update.new')}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-micro">
                    {t('update.latest')}
                  </Badge>
                )
              }
            />
            <InfoRow
              icon={<Clock className="h-3.5 w-3.5" />}
              label={t('update.lastChecked')}
              value={status?.lastCheckedAt ? formatDateTime(status.lastCheckedAt) : t('update.never')}
            />
            <InfoRow
              icon={<Container className="h-3.5 w-3.5" />}
              label={t('update.environment')}
              value={status?.isDocker ? 'Docker' : t('update.standalone')}
              badge={
                status?.isDocker ? (
                  <Badge variant="secondary" className="text-micro">
                    {t('update.container')}
                  </Badge>
                ) : undefined
              }
            />
            <InfoRow
              icon={
                status?.updateAvailable ? (
                  <XCircle className="h-3.5 w-3.5" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )
              }
              label={t('update.updateStatus')}
              value={status?.updateAvailable ? t('update.available') : t('update.upToDate')}
              badge={
                status?.updateAvailable ? (
                  <Badge variant="destructive" className="text-micro">
                    {t('update.actionRequired')}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-micro">
                    {t('update.ok')}
                  </Badge>
                )
              }
            />
          </>
        )}
      </div>

      {/* ── Panel update automation ── */}
      <div className="space-y-3 rounded-sm border border-border/50 px-3 py-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <div className="text-mini font-medium text-foreground">{t('update.auto.title')}</div>
            <p className="text-micro text-muted-foreground">{t('update.auto.description')}</p>
          </div>
          <Switch
            checked={enabled}
            disabled={settingsMutation.isPending}
            aria-label={t('update.auto.title')}
            onCheckedChange={(next) => settingsMutation.mutate({ enabled: next })}
          />
        </div>

        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <div className="text-mini font-medium text-foreground">{t('update.auto.autoTrigger')}</div>
            <p className="text-micro text-muted-foreground">{t('update.auto.autoTriggerHint')}</p>
          </div>
          <Switch
            checked={autoTrigger}
            disabled={!enabled || settingsMutation.isPending}
            aria-label={t('update.auto.autoTrigger')}
            onCheckedChange={(next) => settingsMutation.mutate({ autoTrigger: next })}
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="text-mini font-medium text-foreground">{t('update.auto.intervalLabel')}</div>
            <p className="text-micro text-muted-foreground">{t('update.auto.intervalHint')}</p>
          </div>
          <Select
            value={String(intervalMs)}
            disabled={!enabled || settingsMutation.isPending}
            onValueChange={(next) => settingsMutation.mutate({ intervalMs: Number(next) })}
          >
            <SelectTrigger className="h-8 w-40 rounded-sm border-border/40 text-mini">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INTERVAL_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={String(option.value)} className="text-mini">
                  {t(option.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── Per-node automatic agent updates ── */}
      <div className="space-y-2 rounded-sm border border-border/50 px-3 py-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5 text-mini font-medium text-foreground">
              <Server className="h-3.5 w-3.5" />
              {t('update.auto.nodes.title')}
            </div>
            <p className="text-micro text-muted-foreground">{t('update.auto.nodes.description')}</p>
          </div>
          <Badge variant="secondary" className="text-micro">
            {t('update.auto.nodes.enabledCount', { count: selectedCount })}
          </Badge>
        </div>

        {visibleNodes.length > 0 && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-micro"
              onClick={() => bulkSet(true)}
            >
              {t('update.auto.nodes.selectAll')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-micro"
              onClick={() => bulkSet(false)}
            >
              {t('update.auto.nodes.selectNone')}
            </Button>
          </div>
        )}

        <div className="divide-y divide-border/40 rounded-sm border border-border/40">
          {nodesLoading ? (
            <div className="px-3 py-2">
              <Skeleton className="h-5 w-full" />
            </div>
          ) : visibleNodes.length === 0 ? (
            <div className="px-3 py-2 text-mini text-muted-foreground">
              {t('update.auto.nodes.empty')}
            </div>
          ) : (
            visibleNodes.map((node) => {
              const checked = nodeDraft[node.id] ?? node.autoUpdateEnabled === true;
              const behind = isVersionBehind(node.agentVersion, status?.latestVersion);
              return (
                <div key={node.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Checkbox
                      checked={checked}
                      aria-label={t('update.auto.nodes.toggleLabel', { name: node.name })}
                      onCheckedChange={(value) => setDraft(node.id, value === true)}
                    />
                    <div className="min-w-0">
                      <div className="truncate text-mini text-foreground">{node.name}</div>
                      <div className="font-mono text-micro tabular-nums text-muted-foreground">
                        v{String(node.agentVersion ?? '?').replace(/^v/i, '')}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {behind && (
                      <Badge variant="destructive" className="text-micro">
                        {t('update.auto.nodes.updateAvailable')}
                      </Badge>
                    )}
                    {!node.isOnline && (
                      <Badge variant="outline" className="text-micro">
                        {t('update.auto.nodes.offline')}
                      </Badge>
                    )}
                    <Badge variant={checked ? 'secondary' : 'outline'} className="text-micro">
                      {checked ? t('update.auto.nodes.automatic') : t('update.auto.nodes.manual')}
                    </Badge>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {pendingChanges.length > 0 && (
          <div className="flex items-center justify-between gap-3 rounded-sm border border-primary/30 bg-primary/5 px-3 py-2">
            <span className="text-mini text-foreground">
              {t('update.auto.nodes.unsaved', { count: pendingChanges.length })}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-micro"
                disabled={nodesMutation.isPending}
                onClick={() => {
                  seededRef.current = false;
                  setNodeDraft(
                    Object.fromEntries((nodes ?? []).map((node) => [node.id, node.autoUpdateEnabled === true])),
                  );
                }}
              >
                {t('common:actions.cancel')}
              </Button>
              <Button
                size="sm"
                className="h-7 gap-1.5 px-2 text-micro"
                disabled={nodesMutation.isPending}
                onClick={() => {
                  const toEnable = pendingChanges.filter((c) => c.enabled).map((c) => c.id);
                  const toDisable = pendingChanges.filter((c) => !c.enabled).map((c) => c.id);
                  if (toEnable.length) nodesMutation.mutate({ nodeIds: toEnable, enabled: true });
                  if (toDisable.length) nodesMutation.mutate({ nodeIds: toDisable, enabled: false });
                }}
              >
                {nodesMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Save className="h-3 w-3" />
                )}
                {t('update.auto.nodes.save')}
              </Button>
            </div>
          </div>
        )}
      </div>

      <UpdateProgressModal open={progressOpen} onClose={() => setProgressOpen(false)} />
    </div>
  );
}
