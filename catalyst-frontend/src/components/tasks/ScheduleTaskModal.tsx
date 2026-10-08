import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { tasksApi } from '../../services/api/tasks';
import { notifyError, notifySuccess } from '../../utils/notify';
import { reportSystemError } from '../../services/api/systemErrors';
import type { Task } from '../../types/task';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { BracketLabel } from '@/components/deck/primitives';
import { FormSection } from '@/components/ui/form-section';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  DEFAULT_SPEC,
  WEEKDAYS,
  buildCron,
  describeSpec,
  fromTimeValue,
  normalizeSpec,
  specFromCron,
  toTimeValue,
  type RepeatMode,
  type ScheduleSpec,
} from './scheduleBuilder';
import { actionOptions } from './taskActions';

/** Deck field chrome — 4px radius, 32px control height, mini type ramp. */
const selectClass =
  'h-8 min-h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2 text-mini text-foreground outline-none transition-colors [color-scheme:dark] focus:border-primary';

const REPEAT_ORDER: RepeatMode[] = [
  'minute',
  'minutes',
  'hour',
  'daily',
  'weekly',
  'monthly',
  'custom',
];

interface ScheduleTaskModalProps {
  serverId: string;
  /** Present in edit mode; omitted when creating a task. */
  task?: Omit<Task, 'serverId'>;
  /** `primary` renders the green "Create task" action, `default` the row-level Edit button. */
  trigger?: 'primary' | 'default';
  disabled?: boolean;
}

/**
 * One dialog for both creating and editing a scheduled task.
 *
 * Previously the create dialog assembled a cron from a one-off "start time"
 * while only the edit dialog exposed the raw expression, so nailing a schedule
 * meant creating a task and immediately reopening it. Here the schedule is a
 * preset picker (with the raw cron one toggle away) and every other field is
 * present in both modes.
 */
export default function ScheduleTaskModal({
  serverId,
  task,
  trigger = 'default',
  disabled = false,
}: ScheduleTaskModalProps) {
  const { t } = useTranslation('server-tabs');
  const isEdit = Boolean(task);
  const [open, setOpen] = useState(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [action, setAction] = useState<Task['action']>('restart');
  const [command, setCommand] = useState('');
  const [spec, setSpec] = useState<ScheduleSpec>(DEFAULT_SPEC);
  const [advanced, setAdvanced] = useState(false);

  // Local "time of day" mirror: an <input type="time"> value is HH:MM, and an
  // empty/partial value must not overwrite the hour+minute pair in the spec.
  const timeValue = toTimeValue(spec.hour, spec.minute);

  const timezoneLabel = useMemo(() => {
    try {
      const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(
        new Date(),
      );
      return parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
    } catch {
      return '';
    }
  }, []);

  const resetFromTask = () => {
    if (task) {
      const seeded = specFromCron(task.schedule);
      setName(task.name);
      setDescription(task.description ?? '');
      setAction(task.action);
      setCommand(typeof task.payload?.command === 'string' ? task.payload.command : '');
      setSpec(seeded.spec);
      setAdvanced(seeded.advanced);
      return;
    }
    setName('');
    setDescription('');
    setAction('restart');
    setCommand('');
    setSpec({ ...DEFAULT_SPEC });
    setAdvanced(false);
  };

  // Re-seed whenever the dialog opens so a cancelled edit never leaks stale
  // values into the next one.
  useEffect(() => {
    if (open) resetFromTask();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const schedule = useMemo(
    () => (advanced ? spec.custom.trim() : buildCron(spec)),
    [advanced, spec],
  );

  // Whether the raw expression maps back onto a preset; when it does not the
  // advanced switch cannot be turned off without discarding the schedule.
  const canUsePresets = useMemo(() => !specFromCron(spec.custom).advanced, [spec.custom]);

  const mutation = useMutation({
    mutationFn: () => {
      const payload = action === 'command' && command.trim() ? { command: command.trim() } : {};
      const trimmedDescription = description.trim();
      if (task) {
        return tasksApi.update(serverId, task.id, {
          name: name.trim(),
          description: trimmedDescription || undefined,
          action,
          schedule,
          payload,
        });
      }
      if (!schedule) {
        reportSystemError({
          level: 'error',
          component: 'ScheduleTaskModal',
          message: 'Invalid schedule',
          metadata: { context: 'create task mutation' },
        });
        throw new Error(t('tasks.errors.invalidSchedule'));
      }
      return tasksApi.create(serverId, {
        name: name.trim(),
        description: trimmedDescription || undefined,
        action,
        schedule,
        payload,
      });
    },
    onSuccess: () => {
      notifySuccess(isEdit ? t('tasks.edit.success') : t('tasks.create.success'));
      setOpen(false);
    },
    onError: (error: any) => {
      notifyError(error);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.tasks(serverId) });
    },
  });

  const disableSubmit = useMemo(() => {
    if (!name.trim() || !schedule) return true;
    if (action === 'command' && !command.trim()) return true;
    return mutation.isPending || disabled;
  }, [action, command, name, schedule, mutation.isPending, disabled]);

  const patchSpec = (patch: Partial<ScheduleSpec>) => setSpec((prev) => ({ ...prev, ...patch }));

  const handleRepeatChange = (next: RepeatMode) => {
    setSpec((prev) => {
      // Switching into the raw editor keeps the expression the presets built so
      // far, so "Advanced" is an escape hatch rather than a reset.
      if (next === 'custom') {
        return { ...prev, repeat: 'custom', custom: prev.custom.trim() || buildCron(prev) };
      }
      // And switching back re-parses whatever was typed when it is a shape the
      // presets understand.
      if (prev.repeat === 'custom') {
        const parsed = specFromCron(prev.custom);
        if (!parsed.advanced) return normalizeSpec({ ...parsed.spec, repeat: next });
        return { ...prev, repeat: next };
      }
      return { ...prev, repeat: next };
    });
  };

  const toggleAdvanced = (next: boolean) => {
    if (next) {
      // Carry the expression the presets built so far into the raw field.
      setSpec((prev) => ({ ...prev, custom: prev.custom.trim() || buildCron(prev) }));
      setAdvanced(true);
      return;
    }
    // Leaving the raw editor only works when the expression maps back onto a
    // preset — otherwise the schedule would be silently replaced.
    const parsed = specFromCron(spec.custom);
    if (parsed.advanced) return;
    setSpec(parsed.spec);
    setAdvanced(false);
  };

  const handleTimeChange = (value: string) => {
    const parsed = fromTimeValue(value);
    if (parsed) patchSpec(parsed);
  };

  // Literal t() calls, not a computed key: the i18n extractor only keeps keys
  // it can see spelled out, and every one of these lives in `server-tabs`.
  const summaryText = (): string => {
    const time = toTimeValue(spec.hour, spec.minute);
    switch (describeSpec(advanced ? { ...spec, repeat: 'custom' } : spec).kind) {
      case 'minutes':
        return t('tasks.repeatSummary.minutes', { count: spec.interval });
      case 'hour':
        return t('tasks.repeatSummary.hour', { minute: toTimeValue(0, spec.minute).slice(3) });
      case 'daily':
        return t('tasks.repeatSummary.daily', { time });
      case 'weekly':
        return t('tasks.repeatSummary.weekly', {
          day: t(`tasks.days.${WEEKDAYS[spec.weekday]}`),
          time,
        });
      case 'monthly':
        return t('tasks.repeatSummary.monthly', { day: spec.dayOfMonth, time });
      case 'custom':
        return t('tasks.repeatSummary.custom');
      case 'minute':
      default:
        return t('tasks.repeatSummary.minute');
    }
  };

  const repeatLabels: Record<RepeatMode, string> = {
    minute: t('tasks.repeatOptions.minute'),
    minutes: t('tasks.repeatOptions.minutes'),
    hour: t('tasks.repeatOptions.hour'),
    daily: t('tasks.repeatOptions.daily'),
    weekly: t('tasks.repeatOptions.weekly'),
    monthly: t('tasks.repeatOptions.monthly'),
    custom: t('tasks.repeatOptions.custom'),
  };

  const triggerClass =
    trigger === 'primary'
      ? 'inline-flex h-8 items-center rounded-sm bg-primary px-3 text-mini font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60'
      : 'inline-flex h-8 min-h-8 items-center rounded-sm border border-border/60 px-2 text-mini font-semibold text-muted-foreground transition-colors hover:bg-surface-1/40 hover:text-foreground disabled:opacity-60';

  const prefix = isEdit ? 'edit' : 'create';

  return (
    <div>
      <button
        type="button"
        className={triggerClass}
        onClick={() => {
          if (!disabled) setOpen(true);
        }}
        disabled={disabled}
      >
        {isEdit ? t('common:actions.edit') : t('tasks.create.action')}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="full" className="sm:h-[min(90dvh,54rem)]">
          <DialogHeader>
            <DialogTitle>{isEdit ? t('tasks.edit.title') : t('tasks.create.title')}</DialogTitle>
            <DialogDescription>
              {isEdit ? t('tasks.edit.description') : t('tasks.create.description')}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="min-h-0 p-0">
            <div className="grid min-h-0 grid-cols-1 lg:h-full lg:grid-cols-[minmax(0,1fr)_16rem]">
              {/* Editor */}
              <div className="min-w-0 space-y-3 overflow-y-auto p-4">
              <FormSection index={1} title={t('tasks.name')}>
              <div className="space-y-2">
              <Label htmlFor={`${prefix}-task-name`}>{t('tasks.name')}</Label>
              <Input
                id={`${prefix}-task-name`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('tasks.create.namePlaceholder')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${prefix}-task-description`}>{t('tasks.descriptionLabel')}</Label>
              <Input
                id={`${prefix}-task-description`}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t('tasks.descriptionPlaceholder')}
              />
            </div>

              </FormSection>

              <FormSection index={2} title={t('tasks.action')}>
              <div className="space-y-2">
              <Label htmlFor={`${prefix}-task-action`}>{t('tasks.action')}</Label>
              <select
                id={`${prefix}-task-action`}
                className={selectClass}
                value={action}
                onChange={(event) => setAction(event.target.value as Task['action'])}
              >
                {actionOptions(t).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {action === 'command' ? (
              <div className="space-y-2">
                <Label htmlFor={`${prefix}-task-command`}>{t('tasks.command')}</Label>
                <Input
                  id={`${prefix}-task-command`}
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                  placeholder="say Server restart in 5 minutes"
                />
              </div>
            ) : null}

              </FormSection>

              <FormSection index={3} title={t('tasks.repeat')}>
              <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor={`${prefix}-task-repeat`} className="text-mini font-semibold">
                  {t('tasks.repeat')}
                </Label>
                <div className="text-micro text-muted-foreground">
                  {advanced ? t('tasks.advancedOn') : t('tasks.advancedOff')}
                </div>
              </div>

              {advanced ? (
                <div className="space-y-2">
                  <Label htmlFor={`${prefix}-task-schedule`}>{t('tasks.scheduleCron')}</Label>
                  <Input
                    id={`${prefix}-task-schedule`}
                    className="font-mono [color-scheme:dark]"
                    value={spec.custom}
                    onChange={(event) => patchSpec({ custom: event.target.value })}
                    placeholder="0 3 * * *"
                  />
                  <span className="text-micro text-muted-foreground">
                    {t('tasks.cronHint')}
                  </span>
                </div>
              ) : (
                <>
                  <select
                    id={`${prefix}-task-repeat`}
                    className={selectClass}
                    value={spec.repeat}
                    onChange={(event) => handleRepeatChange(event.target.value as RepeatMode)}
                  >
                    {REPEAT_ORDER.map((mode) => (
                      <option key={mode} value={mode}>
                        {repeatLabels[mode]}
                      </option>
                    ))}
                  </select>

                  <div className="grid grid-cols-2 gap-2">
                    {spec.repeat === 'minutes' ? (
                      <div className="space-y-1">
                        <Label htmlFor={`${prefix}-task-interval`} className="text-micro">
                          {t('tasks.interval')}
                        </Label>
                        <select
                          id={`${prefix}-task-interval`}
                          className={selectClass}
                          value={String(spec.interval)}
                          onChange={(event) =>
                            patchSpec({ interval: Number(event.target.value) })
                          }
                        >
                          {[1, 2, 5, 10, 15, 20, 30, 45].map((value) => (
                            <option key={value} value={String(value)}>
                              {t('tasks.intervalEvery', { count: value })}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}

                    {spec.repeat === 'weekly' ? (
                      <div className="space-y-1">
                        <Label htmlFor={`${prefix}-task-weekday`} className="text-micro">
                          {t('tasks.dayOfWeek')}
                        </Label>
                        <select
                          id={`${prefix}-task-weekday`}
                          className={selectClass}
                          value={String(spec.weekday)}
                          onChange={(event) => patchSpec({ weekday: Number(event.target.value) })}
                        >
                          {WEEKDAYS.map((day, index) => (
                            <option key={day} value={String(index)}>
                              {t(`tasks.days.${day}`)}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}

                    {spec.repeat === 'monthly' ? (
                      <div className="space-y-1">
                        <Label htmlFor={`${prefix}-task-dom`} className="text-micro">
                          {t('tasks.dayOfMonth')}
                        </Label>
                        <select
                          id={`${prefix}-task-dom`}
                          className={selectClass}
                          value={String(spec.dayOfMonth)}
                          onChange={(event) =>
                            patchSpec({ dayOfMonth: Number(event.target.value) })
                          }
                        >
                          {Array.from({ length: 31 }, (_, index) => index + 1).map((value) => (
                            <option key={value} value={String(value)}>
                              {t('tasks.dayOfMonthValue', { day: value })}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}

                    {spec.repeat === 'hour' ? (
                      <div className="space-y-1">
                        <Label htmlFor={`${prefix}-task-minute`} className="text-micro">
                          {t('tasks.minuteOfHour')}
                        </Label>
                        <select
                          id={`${prefix}-task-minute`}
                          className={selectClass}
                          value={String(spec.minute)}
                          onChange={(event) => patchSpec({ minute: Number(event.target.value) })}
                        >
                          {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((value) => (
                            <option key={value} value={String(value)}>
                              {toTimeValue(0, value).slice(3)}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}

                    {spec.repeat === 'daily' ||
                    spec.repeat === 'weekly' ||
                    spec.repeat === 'monthly' ? (
                      <div className="space-y-1">
                        <Label htmlFor={`${prefix}-task-time`} className="text-micro">
                          {t('tasks.timeOfDay')}
                        </Label>
                        <Input
                          id={`${prefix}-task-time`}
                          type="time"
                          size="dense"
                          className="[color-scheme:dark]"
                          value={timeValue}
                          onChange={(event) => handleTimeChange(event.target.value)}
                        />
                      </div>
                    ) : null}
                  </div>
                </>
              )}

              <div className="flex items-center justify-between gap-3 border-t border-border/50 pt-3">
                <Label
                  htmlFor={`${prefix}-task-advanced`}
                  className="text-micro font-medium text-muted-foreground"
                >
                  {t('tasks.advanced')}
                </Label>
                <Switch
                  id={`${prefix}-task-advanced`}
                  checked={advanced}
                  onCheckedChange={toggleAdvanced}
                  aria-label={t('tasks.advanced')}
                />
              </div>
              {advanced && !canUsePresets ? (
                <p className="text-micro text-warning">{t('tasks.advancedLocked')}</p>
              ) : null}

              </div>
              </FormSection>
              </div>

              {/* Summary aside */}
              <aside className="min-w-0 space-y-3 overflow-y-auto border-t border-border/70 bg-surface-1/40 p-4 lg:border-l lg:border-t-0">
                <BracketLabel tone="muted">
                  {isEdit ? t('tasks.edit.title') : t('tasks.create.title')}
                </BracketLabel>
                <div className="overflow-hidden rounded-sm border border-border bg-card">
                  <div className="border-b border-border/70 px-3 py-2.5">
                    <span className="block truncate text-data font-semibold text-foreground">
                      {name.trim() || t('tasks.create.namePlaceholder')}
                    </span>
                    <p className="mt-1 line-clamp-2 text-micro text-muted-foreground">
                      {description.trim() || '—'}
                    </p>
                  </div>

                  <div className="border-b border-border/70 px-3 py-2.5">
                    <SummaryRow
                      label={t('tasks.action')}
                      value={actionOptions(t).find((option) => option.value === action)?.label}
                    />
                    <SummaryRow label={t('tasks.repeat')} value={summaryText()} />
                  </div>

                  <div className="px-3 py-2.5">
                    <code
                      className={cn(
                        'block break-all font-mono text-micro',
                        schedule ? 'text-foreground' : 'text-danger',
                      )}
                    >
                      {schedule || t('tasks.scheduleRequired')}
                    </code>
                    <span className="mt-1 block text-micro text-muted-foreground">
                      {timezoneLabel
                        ? t('tasks.timezone.withLabel', { timezone: timezoneLabel })
                        : t('tasks.timezone.withoutLabel')}
                    </span>
                  </div>
                </div>
              </aside>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" className="h-8 px-3 text-mini" onClick={() => setOpen(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              size="sm"
              className="h-8 px-3 text-mini"
              onClick={() => mutation.mutate()}
              disabled={disableSubmit}
            >
              {mutation.isPending
                ? isEdit
                  ? t('tasks.edit.saving')
                  : t('tasks.create.submitting')
                : isEdit
                  ? t('common:actions.save')
                  : t('common:actions.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Label/value line for the summary aside; value falls back to a dash. */
function SummaryRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="type-overline shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-mono text-micro tabular-nums text-foreground">
        {value ?? '—'}
      </span>
    </div>
  );
}
