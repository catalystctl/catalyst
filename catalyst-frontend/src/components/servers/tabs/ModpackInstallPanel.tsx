import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, FileArchive, Loader2, Upload } from 'lucide-react';
import { formatBytes } from '../../../utils/formatters';
import { notifySuccess } from '../../../utils/notify';
import { getLocalizedErrorMessage } from '../../../i18n/api-errors';
import { modpackApi, type ModpackInstallJob } from '../../../services/api/modpacks';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';

/** Extensions the backend can hand to the node agent's extractor. */
export const MODPACK_ACCEPT = '.zip,.mrpack,.mr,.tar,.tar.gz,.tgz,.tar.xz,.txz,.tar.bz2,.tbz2';

/** Poll interval while a job is running. */
const POLL_MS = 1500;

/**
 * Phase label keys, in display order. The backend reports one phase at a time;
 * the list lets the panel show "3 of 5" style progress without guessing.
 */
const PHASES = ['extracting', 'installing-files', 'applying-overrides', 'finalizing'] as const;

/**
 * Explicit keys, not `t(`...${phase}`)` templates: the i18n extractor only
 * sees literal keys and prunes everything else from the catalogs.
 */
const PHASE_LABEL_KEYS = {
  extracting: 'tabs.mods.modpack.phase.extracting',
  'installing-files': 'tabs.mods.modpack.phase.installing-files',
  'applying-overrides': 'tabs.mods.modpack.phase.applying-overrides',
  finalizing: 'tabs.mods.modpack.phase.finalizing',
} as const;

const STATUS_LABEL_KEYS = {
  queued: 'tabs.mods.modpack.status.queued',
  running: 'tabs.mods.modpack.status.running',
  completed: 'tabs.mods.modpack.status.completed',
  failed: 'tabs.mods.modpack.status.failed',
} as const;

interface Props {
  serverId: string;
  /** Install into a subdirectory of the server root instead of the root. */
  defaultPath?: string;
  onInstalled?: (job: ModpackInstallJob) => void;
}

export default function ModpackInstallPanel({ serverId, defaultPath, onInstalled }: Props) {
  const { t } = useTranslation('server-tabs');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [targetPath, setTargetPath] = useState(defaultPath ?? '');
  const [job, setJob] = useState<ModpackInstallJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopped = useRef(false);

  const stopPolling = useCallback(() => {
    stopped.current = true;
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const isRunning = job?.status === 'running' || job?.status === 'queued';

  // Poll the job until it settles. The backend keeps running the install
  // regardless of whether the panel is still open.
  const jobId = job?.id;
  useEffect(() => {
    if (!jobId || !isRunning) return;
    stopped.current = false;

    const schedule = () => {
      if (stopped.current) return;
      pollTimer.current = setTimeout(tick, POLL_MS);
    };

    const tick = async () => {
      pollTimer.current = null;
      try {
        const next = await modpackApi.job(serverId, jobId);
        if (stopped.current) return;
        if (next) {
          setJob(next);
          if (next.status === 'completed') {
            notifySuccess(t('tabs.mods.modpack.installedSuccess', { name: next.filename }));
            onInstalled?.(next);
            return;
          }
          if (next.status === 'failed') {
            setError(
              getLocalizedErrorMessage(
                { response: { data: { code: next.code ?? undefined, error: next.error ?? undefined } } },
                'tabs.mods.modpack.installFailed',
              ),
            );
            return;
          }
        }
      } catch {
        // Transient poll failure: keep trying until the job settles.
      }
      schedule();
    };

    schedule();
    return () => {
      stopped.current = true;
      stopPolling();
    };
  }, [jobId, isRunning, serverId, onInstalled, stopPolling, t]);

  const start = async () => {
    setError(null);
    setJob(null);
    setIsStarting(true);
    try {
      let started: ModpackInstallJob | undefined;
      if (file) {
        started = await modpackApi.installUpload(serverId, file, { path: targetPath || undefined });
      } else if (url.trim()) {
        started = await modpackApi.installUrl(serverId, url.trim(), { path: targetPath || undefined });
      } else {
        setError(t('tabs.mods.modpack.needSource'));
        return;
      }
      if (started) {
        setJob(started);
        if (started.status === 'failed') {
          setError(started.error ?? t('tabs.mods.modpack.installFailed'));
        }
      }
    } catch (caught) {
      setError(getLocalizedErrorMessage(caught, 'tabs.mods.modpack.installFailed'));
    } finally {
      setIsStarting(false);
    }
  };

  const reset = () => {
    stopPolling();
    setJob(null);
    setError(null);
    setFile(null);
    setUrl('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const phaseIndex = job?.progress
    ? PHASES.indexOf(job.progress.phase as (typeof PHASES)[number])
    : -1;
  const percent =
    job?.progress && job.progress.total > 0
      ? Math.min(100, Math.round((job.progress.completed / job.progress.total) * 100))
      : 0;

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">{t('tabs.mods.modpack.title')}</h3>
        <p className="type-meta text-muted-foreground">{t('tabs.mods.modpack.description')}</p>
      </div>

      {!isRunning && !job && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept={MODPACK_ACCEPT}
              aria-label={t('tabs.mods.modpack.fileLabel')}
              className="block max-w-full text-mini text-muted-foreground file:mr-3 file:cursor-pointer file:rounded-sm file:border file:border-border file:bg-surface-2 file:px-2.5 file:py-1.5 file:text-mini file:font-semibold file:text-foreground"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setUrl('');
              }}
            />
            {file && (
              <span className="type-numeric text-mini text-muted-foreground">
                {formatBytes(file.size)}
              </span>
            )}
          </div>

          <div className="space-y-1">
            <label className="type-meta text-muted-foreground" htmlFor="modpack-url">
              {t('tabs.mods.modpack.urlLabel')}
            </label>
            <Input
              id="modpack-url"
              value={url}
              placeholder="https://example.com/pack.mrpack"
              onChange={(event) => {
                setUrl(event.target.value);
                if (event.target.value) setFile(null);
              }}
            />
          </div>

          <div className="space-y-1">
            <label className="type-meta text-muted-foreground" htmlFor="modpack-path">
              {t('tabs.mods.modpack.pathLabel')}
            </label>
            <Input
              id="modpack-path"
              value={targetPath}
              placeholder={t('tabs.mods.modpack.pathPlaceholder')}
              onChange={(event) => setTargetPath(event.target.value)}
            />
          </div>

          {error && (
            <p className="flex items-start gap-1.5 type-meta text-danger">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {error}
            </p>
          )}

          <Button
            size="sm"
            className="gap-1.5"
            disabled={isStarting || (!file && !url.trim())}
            onClick={start}
          >
            {isStarting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {t('tabs.mods.modpack.install')}
          </Button>
        </>
      )}

      {job && (
        <div className="space-y-2 rounded-sm border border-border bg-card p-3">
          <div className="flex items-center gap-2">
            {job.status === 'completed' ? (
              <CheckCircle2 className="h-4 w-4 text-success" />
            ) : job.status === 'failed' ? (
              <AlertTriangle className="h-4 w-4 text-danger" />
            ) : (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            )}
            <span className="truncate text-mini font-semibold text-foreground">{job.filename}</span>
            <span className="ml-auto type-meta text-muted-foreground">
              {t(STATUS_LABEL_KEYS[job.status])}
            </span>
          </div>

          {isRunning && job.progress && (
            <div className="space-y-1">
              <div className="flex items-center justify-between type-meta text-muted-foreground">
                <span>{t(PHASE_LABEL_KEYS[job.progress.phase] ?? PHASE_LABEL_KEYS.extracting)}</span>
                {job.progress.total > 0 && (
                  <span className="type-numeric">
                    {job.progress.completed}/{job.progress.total}
                  </span>
                )}
              </div>
              <div
                className="h-1.5 overflow-hidden rounded-sm bg-surface-2"
                role="progressbar"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
              </div>
              <span className="type-meta text-muted-foreground">
                {t('tabs.mods.modpack.stepOf', {
                  current: Math.max(1, phaseIndex + 1),
                  total: PHASES.length,
                })}
              </span>
            </div>
          )}

          {job.status === 'completed' && job.result && (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 type-meta text-muted-foreground">
              <dt>{t('tabs.mods.modpack.format')}</dt>
              <dd className="text-foreground">{job.result.format}</dd>
              <dt>{t('tabs.mods.modpack.modsInstalled')}</dt>
              <dd className="type-numeric text-foreground">{job.result.installedFiles.length}</dd>
              <dt>{t('tabs.mods.modpack.overridesApplied')}</dt>
              <dd className="type-numeric text-foreground">{job.result.installedOverrides}</dd>
              {job.result.skipped.length > 0 && (
                <>
                  <dt>{t('tabs.mods.modpack.skipped')}</dt>
                  <dd className="type-numeric text-foreground">{job.result.skipped.length}</dd>
                </>
              )}
            </dl>
          )}

          {error && (
            <p className="flex items-start gap-1.5 type-meta text-danger">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {error}
            </p>
          )}

          {job.status === 'completed' && job.result && job.result.warnings.length > 0 && (
            <details className="type-meta text-muted-foreground">
              <summary className="cursor-pointer">
                {t('tabs.mods.modpack.warnings', { count: job.result.warnings.length })}
              </summary>
              <ul className="mt-1 space-y-0.5">
                {job.result.warnings.slice(0, 20).map((warning) => (
                  <li key={warning} className="truncate">
                    {warning}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {!isRunning && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={reset}>
              <FileArchive className="h-3.5 w-3.5" />
              {t('tabs.mods.modpack.installAnother')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
