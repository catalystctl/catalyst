import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { adminApi } from '../../services/api/admin';
import { notifyError, notifySuccess } from '../../utils/notify';

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
  const queryClient = useQueryClient();

  const { data: status, isLoading } = useQuery({
    queryKey: qk.adminUpdateStatus(),
    queryFn: adminApi.updateStatus,
    refetchInterval: 30000,
  });

  const triggerMutation = useMutation({
    mutationFn: adminApi.triggerUpdate,
    onSuccess: (result) => {
      if (result.success) {
        notifySuccess(result.message || 'Update triggered');
      } else {
        notifyError(result.message || 'Update failed');
      }
      queryClient.invalidateQueries({ queryKey: qk.adminUpdateStatus() });
    },
    onError: (error: any) => {
      notifyError(error?.message || 'Failed to trigger update');
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
            <Badge
              variant="default"
              className="bg-emerald-600 text-xs text-white hover:bg-emerald-700"
            >
              Update available
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs">
              Up to date
            </Badge>
          )}
        </div>
        <Button
          size="sm"
          disabled={isLoading || triggerMutation.isPending || !canTrigger}
          onClick={() => triggerMutation.mutate()}
        >
          {triggerMutation.isPending ? (
            <>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              Triggering…
            </>
          ) : (
            <>
              <ArrowUpCircle className="mr-1.5 h-3.5 w-3.5" />
              Trigger Update
            </>
          )}
        </Button>
      </div>

      {!isLoading && !status?.isDocker && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Auto-update is only available when running in Docker. Please update
            Catalyst manually.
          </span>
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
              label="Current version"
              value={status?.currentVersion ?? 'Unknown'}
            />
            <InfoRow
              icon={<Tag className="h-3.5 w-3.5" />}
              label="Latest version"
              value={status?.latestVersion ?? 'Unknown'}
              badge={
                status?.updateAvailable ? (
                  <Badge
                    variant="default"
                    className="bg-emerald-600 text-[10px] text-white hover:bg-emerald-700"
                  >
                    New
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px]">
                    Latest
                  </Badge>
                )
              }
            />
            <InfoRow
              icon={<Clock className="h-3.5 w-3.5" />}
              label="Last checked"
              value={
                status?.lastCheckedAt
                  ? new Date(status.lastCheckedAt).toLocaleString()
                  : 'Never'
              }
            />
            <InfoRow
              icon={<Container className="h-3.5 w-3.5" />}
              label="Environment"
              value={status?.isDocker ? 'Docker' : 'Standalone'}
              badge={
                status?.isDocker ? (
                  <Badge variant="secondary" className="text-[10px]">
                    Container
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
              label="Update status"
              value={status?.updateAvailable ? 'Update available' : 'Up to date'}
              badge={
                status?.updateAvailable ? (
                  <Badge variant="destructive" className="text-[10px]">
                    Action required
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px]">
                    OK
                  </Badge>
                )
              }
            />
          </>
        )}
      </div>
    </div>
  );
}
