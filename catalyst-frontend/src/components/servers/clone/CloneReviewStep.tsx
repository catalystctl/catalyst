import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowRight, Info, Loader2, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import type { ClonePlan } from '../../../types/server';

const blockClass = 'rounded-sm border border-border/50 bg-surface-1/40 p-3';

function formatBytes(bytes: number | null): string | null {
  if (!bytes || bytes <= 0) return null;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatFieldValue(value: string | number | null): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

type Props = {
  plan: ClonePlan;
  acknowledgedWarnings: string[];
  onToggleWarning: (code: string) => void;
  onBack: () => void;
  onConfirm: () => void;
  submitting: boolean;
  stopSourcePending?: boolean;
  onStopSource?: () => void;
};

function CloneReviewStep({
  plan,
  acknowledgedWarnings,
  onToggleWarning,
  onBack,
  onConfirm,
  submitting,
  stopSourcePending = false,
  onStopSource,
}: Props) {
  const { t } = useTranslation('servers');

  const blockers = plan.blockers;
  const warnings = plan.warnings;
  const hasBlockers = blockers.length > 0;
  const unacknowledged = warnings.filter((w) => !acknowledgedWarnings.includes(w.code));
  const canConfirm = !hasBlockers && unacknowledged.length === 0 && !submitting;
  const notStoppedBlocker = blockers.some((b) => b.code === 'CLONE_SOURCE_NOT_STOPPED');
  const sizeLabel = formatBytes(plan.source.dataSizeBytes);

  return (
    <div className="space-y-3">
      <div className={cn(blockClass, 'space-y-1')}>
        <p className="type-overline">{t('cloneServer.review.summaryTitle')}</p>
        <p className="type-meta">
          {plan.mode === 'full'
            ? t('cloneServer.review.fullSummary')
            : t('cloneServer.review.configurationSummary')}
        </p>
        <p className="type-meta">
          {plan.crossNode
            ? t('cloneServer.review.crossNodeTarget', {
                source: plan.source.nodeName,
                target: plan.target.nodeName,
              })
            : t('cloneServer.review.sameNodeTarget', { target: plan.target.nodeName })}
        </p>
        {plan.requirements.installWillRun && (
          <p className="type-meta">{t('cloneServer.review.installWillRun')}</p>
        )}
        {plan.mode === 'full' && (
          <p className="type-meta">
            {sizeLabel
              ? t('cloneServer.review.estimatedSize', { size: sizeLabel })
              : t('cloneServer.review.estimatedSizeUnknown')}
            {typeof plan.requirements.estimatedDurationSec === 'number'
              ? ` · ${t('cloneServer.review.estimatedDuration', {
                  seconds: plan.requirements.estimatedDurationSec,
                })}`
              : ''}
          </p>
        )}
      </div>

      {hasBlockers && (
        <div className="rounded-sm border border-danger/40 bg-danger/10 p-3">
          <p className="mb-2 flex items-center gap-2 type-overline text-danger">
            <ShieldAlert className="h-3.5 w-3.5" />
            {t('cloneServer.review.blockersTitle')}
          </p>
          <ul className="space-y-1.5">
            {blockers.map((blocker) => (
              <li key={blocker.code} className="flex items-start gap-2 text-mini text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
                <span>
                  {t(`cloneServer.blockers.${blocker.code}`, { defaultValue: blocker.message })}
                </span>
              </li>
            ))}
          </ul>
          {notStoppedBlocker && onStopSource && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3 h-8 px-3 text-mini"
              onClick={onStopSource}
              disabled={stopSourcePending}
            >
              {stopSourcePending
                ? t('cloneServer.review.stoppingSource')
                : t('cloneServer.review.stopSourceAndContinue')}
            </Button>
          )}
        </div>
      )}

      <div className={cn(blockClass, 'space-y-2')}>
        <p className="type-overline">{t('cloneServer.review.changesTitle')}</p>
        <div className="overflow-hidden rounded-sm border border-border/50">
          <table className="w-full text-mini">
            <thead className="bg-surface-2/40 text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">
                  {t('cloneServer.review.changeField')}
                </th>
                <th className="px-2 py-1.5 text-left font-medium">
                  {t('cloneServer.review.changeFrom')}
                </th>
                <th className="px-2 py-1.5 text-left font-medium">
                  {t('cloneServer.review.changeTo')}
                </th>
              </tr>
            </thead>
            <tbody>
              {plan.changes.map((change) => (
                <tr key={change.field} className="border-t border-border/40">
                  <td className="px-2 py-1.5 align-top">
                    <span className="flex items-center gap-1.5">
                      {t(`cloneServer.changeLabels.${change.field}`, { defaultValue: change.label })}
                      {change.nodeSpecific && (
                        <span className="rounded-sm bg-warning/15 px-1 py-0.5 text-micro text-warning">
                          {t('cloneServer.review.nodeSpecific')}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 align-top font-mono text-micro break-all text-muted-foreground">
                    {formatFieldValue(change.from)}
                  </td>
                  <td className="px-2 py-1.5 align-top font-mono text-micro break-all">
                    {formatFieldValue(change.to)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="rounded-sm border border-warning/40 bg-warning/10 p-3">
          <p className="mb-2 flex items-center gap-2 type-overline text-warning">
            <Info className="h-3.5 w-3.5" />
            {t('cloneServer.review.warningsTitle')}
          </p>
          <ul className="space-y-2">
            {warnings.map((warning) => (
              <li key={warning.code} className="flex items-start gap-2 text-mini text-muted-foreground">
                <Checkbox
                  id={`clone-warning-${warning.code}`}
                  checked={acknowledgedWarnings.includes(warning.code)}
                  onCheckedChange={() => onToggleWarning(warning.code)}
                  className="mt-0.5"
                />
                <label htmlFor={`clone-warning-${warning.code}`} className="cursor-pointer">
                  {t(`cloneServer.warnings.${warning.code}`, { defaultValue: warning.message })}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-2 text-micro text-muted-foreground">
        <ArrowRight className="h-3 w-3" />
        <span>
          {t('cloneServer.review.targetHint', {
            node: plan.target.nodeName,
            location: plan.target.locationName,
          })}
        </span>
      </div>

      <div className="flex justify-between gap-2 pt-1">
        <Button
          variant="outline"
          size="sm"
          className="h-8 px-3 text-mini"
          onClick={onBack}
          disabled={submitting}
        >
          {t('cloneServer.review.back')}
        </Button>
        <Button
          size="sm"
          className="h-8 px-3 text-mini"
          onClick={onConfirm}
          disabled={!canConfirm}
        >
          {submitting && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
          {submitting
            ? t('cloneServer.cloning')
            : plan.crossNode
              ? t('cloneServer.review.confirmCrossNode', { node: plan.target.nodeName })
              : t('cloneServer.review.confirmSameNode')}
        </Button>
      </div>
    </div>
  );
}

export default CloneReviewStep;
