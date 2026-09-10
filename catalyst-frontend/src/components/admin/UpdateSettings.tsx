import { useState } from 'react';
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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { qk } from '@/lib/queryKeys';
import { formatDateTime } from '@/i18n/format';
import { adminApi } from '../../services/api/admin';
import { notifyError } from '../../utils/notify';
import UpdateProgressModal from './UpdateProgressModal';

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
 <div className="flex items-center justify-between py-2.5">
 <div className="flex items-center gap-2.5">
 <div className="flex h-7 w-7 items-center justify-center rounded-md bg-surface-2 text-muted-foreground">
 {icon}
 </div>
 <span className="text-sm text-muted-foreground">{label}</span>
 </div>
 <div className="flex items-center gap-2">
 <span className="text-sm font-medium text-foreground">{value}</span>
 {badge}
 </div>
 </div>
 );
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

 return (
 <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isLoading ? (
            <Skeleton className="h-5 w-20" />
          ) : status?.updateAvailable ? (
            <Badge variant="success" className="text-xs">
              {t('update.available')}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs">
              {t('update.upToDate')}
            </Badge>
          )}
        </div>
        <Button
          size="sm"
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

      {!isLoading && !status?.isDocker && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/20 bg-warning/5 px-3 py-2 text-xs text-warning">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{t('update.standaloneNotice')}</span>
        </div>
      )}

 <div className="divide-y divide-border/50">
 {isLoading ? (
 <>
 <div className="py-3">
 <Skeleton className="h-5 w-full" />
 </div>
 <div className="py-3">
 <Skeleton className="h-5 w-full" />
 </div>
 <div className="py-3">
 <Skeleton className="h-5 w-full" />
 </div>
 <div className="py-3">
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
 <Badge variant="success" className="text-[10px]">
 {t('update.new')}
 </Badge>
 ) : (
 <Badge variant="outline" className="text-[10px]">
 {t('update.latest')}
 </Badge>
 )
 }
 />
 <InfoRow
 icon={<Clock className="h-3.5 w-3.5" />}
 label={t('update.lastChecked')}
 value={
 status?.lastCheckedAt
 ? formatDateTime(status.lastCheckedAt)
 : t('update.never')
 }
 />
 <InfoRow
 icon={<Container className="h-3.5 w-3.5" />}
 label={t('update.environment')}
 value={status?.isDocker ? 'Docker' : t('update.standalone')}
 badge={
 status?.isDocker ? (
 <Badge variant="secondary" className="text-[10px]">
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
 <Badge variant="destructive" className="text-[10px]">
 {t('update.actionRequired')}
 </Badge>
 ) : (
 <Badge variant="outline" className="text-[10px]">
 {t('update.ok')}
 </Badge>
 )
 }
 />
 </>
 )}
 </div>

 <UpdateProgressModal open={progressOpen} onClose={() => setProgressOpen(false)} />
 </div>
 );
}
