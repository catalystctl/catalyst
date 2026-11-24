import { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Cpu,
  Terminal,
  ScrollText,
  List,
  ArrowLeft,
  Settings,
  Trash2,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { useMutation } from '@/csync';
import { qk } from '../../lib/queryKeys';
import { queryClient } from '../../lib/queryClient';
import { templatesApi } from '../../services/api/templates';
import type { TemplateVariable } from '../../types/template';
import { notifyError, notifySuccess } from '../../utils/notify';
import { hasAnyPermission } from '../../components/auth/ProtectedRoute';
import { useTemplate } from '../../hooks/useTemplates';
import TemplateVariablesList from '../../components/templates/TemplateVariablesList';
import { useAuthStore } from '../../stores/authStore';
import TemplateEditModal from '../../components/templates/TemplateEditModal';
import TemplateDeleteDialog from '../../components/templates/TemplateDeleteDialog';
import ServerTabCard from '../../components/servers/tabs/ServerTabCard';
import SectionHeader from '../../components/servers/tabs/SectionHeader';
import DataField from '../../components/servers/tabs/DataField';
import TabLoadingState from '../../components/servers/tabs/TabLoadingState';
import TabErrorState from '../../components/servers/tabs/TabErrorState';
import { BracketLabel, Segmented } from '../../components/deck/primitives';

function TemplateDetailsPage() {
  const { t } = useTranslation('templates');
  const { templateId } = useParams();
  const navigate = useNavigate();
  const { data: template, isLoading, isError, refetch } = useTemplate(templateId);
  const user = useAuthStore((s) => s.user);
  const [showEditModal, setShowEditModal] = useState(false);

  const [pendingCreatedNestId, setPendingCreatedNestId] = useState<string | null>(null);
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const createdId = detail?.createdId as string | undefined;
      if (createdId) setPendingCreatedNestId(createdId);
      setShowEditModal(true);
    };
    window.addEventListener('catalyst:return-to-template-edit', handler);
    return () => window.removeEventListener('catalyst:return-to-template-edit', handler);
  }, []);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const canWrite = useMemo(
    () => user?.permissions?.includes('admin.write') || user?.permissions?.includes('*'),
    [user?.permissions],
  );
  // The pencil on a variable row is gated by `template.update`, the permission
  // the PUT /api/templates/:id route actually enforces.
  const canUpdateVariables = useMemo(
    () => hasAnyPermission(user?.permissions, ['template.update', 'admin.write']),
    [user?.permissions],
  );

  /**
   * D18: edit one variable's value without loading the whole edit form. Only
   * the changed entry differs — every other variable is sent back as stored so
   * the PUT cannot drop definitions the user never opened.
   */
  const variableMutation = useMutation({
    mutationFn: (variable: TemplateVariable) => {
      if (!template) return Promise.reject(new Error('missing template'));
      const variables = (template.variables ?? []).map((existing) =>
        existing.name === variable.name ? variable : existing,
      );
      return templatesApi.update(template.id, { variables });
    },
    onSuccess: (updated) => {
      notifySuccess(t('variables.saved'));
      if (updated) queryClient.setQueryData(qk.template(updated.id), updated);
    },
    onError: (error: unknown) => {
      notifyError(error, 'templates:variables.saveError');
    },
    onSettled: () => {
      if (template) queryClient.invalidateQueries({ queryKey: qk.template(template.id) });
      queryClient.invalidateQueries({ queryKey: qk.templates() });
    },
  });

  if (isLoading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <BracketLabel>{t('details.title')}</BracketLabel>
          <h1 className="font-display text-lg font-semibold leading-none tracking-tight text-foreground">
            {t('details.loading')}
          </h1>
        </div>
        <div className="deck-panel p-3">
          <TabLoadingState rows={5} />
        </div>
      </div>
    );
  }

  // `!template` stays its own guard so TypeScript keeps narrowing below. A
  // failed background refetch keeps `template` cached while isError is true
  // (P0.4), so the page renders and the failure shows as a banner instead.
  if (!template) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <BracketLabel>{t('details.title')}</BracketLabel>
          <h1 className="font-display text-lg font-semibold leading-none tracking-tight text-foreground">
            {t('details.loadError')}
          </h1>
        </div>
        <div className="deck-panel p-3">
          <TabErrorState
            message={t('details.loadError')}
            onRetry={() => refetch()}
          />
          <div className="mt-3 flex items-center gap-3">
            <Button variant="outline" size="sm" className="h-8 gap-1.5 px-3 text-mini" onClick={() => refetch()}>
              {t('common:actions.retry')}
            </Button>
            <Link
              to="/admin/templates"
              className="text-mini text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('details.backLink')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const portList = template.supportedPorts?.length
    ? template.supportedPorts.join(', ')
    : t('state.notAvailable');
  const imageVariants = template.images ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Cached template stays on screen when a background refetch fails. */}
      {isError && <TabErrorState message={t('details.loadError')} onRetry={() => refetch()} />}

      {/* ── Breadcrumb ── */}
      <Link
        to="/admin/templates"
        className="inline-flex items-center gap-1.5 text-mini text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        {t('details.back')}
      </Link>

      {/* ── Deck header ── */}
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <BracketLabel>{t('details.title')}</BracketLabel>
          <h1 className="truncate font-display text-lg font-semibold leading-none tracking-tight text-foreground">
            {template.name}
          </h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-micro text-muted-foreground">{template.author}</span>
            <Segmented muted>v{template.version}</Segmented>
            {template.description && (
              <span className="type-meta truncate">{template.description}</span>
            )}
          </div>
        </div>

        {canWrite && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 px-3 text-mini"
              onClick={() => setShowEditModal(true)}
            >
              <Settings className="h-3.5 w-3.5" />
              {t('common:actions.edit')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDeleteModal(true)}
              className="h-8 gap-1.5 px-3 text-mini text-danger hover:border-danger/30 hover:bg-danger/5 hover:text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t('common:actions.delete')}
            </Button>
          </div>
        )}
      </header>

      {/* ── Info Grid ── */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* Runtime */}
        <ServerTabCard>
          <SectionHeader icon={Cpu} title={t('details.runtime')} />
          <div className="space-y-0">
            <DataField label={t('image')} value={template.defaultImage || template.image} />
            {imageVariants.length > 0 && (
              <DataField
                label={t('details.imageVariants')}
                value={imageVariants.map((o) => o.label ?? o.name).join(', ')}
              />
            )}
            {template.defaultImage && (
              <DataField label={t('details.defaultImage')} value={template.defaultImage} />
            )}
            <DataField label={t('details.installImage')} value={template.installImage ?? t('state.notAvailable')} />
            <DataField label={t('details.stopCommand')} value={template.stopCommand} />
            <DataField label={t('details.signal')} value={template.sendSignalTo} />
            <DataField label={t('details.ports')} value={portList} />
            <DataField
              label={t('resources')}
              value={t('resourcesSummary', {
                cpu: template.allocatedCpuCores,
                memory: template.allocatedMemoryMb,
                disk: template.allocatedDiskMb,
              })}
            />
            <DataField
              label={t('details.configFiles')}
              value={
                template.features?.configFiles?.length
                  ? template.features.configFiles.join(', ')
                  : template.features?.configFile ?? t('state.notAvailable')
              }
            />
          </div>
        </ServerTabCard>

        {/* Startup */}
        <ServerTabCard>
          <SectionHeader icon={Terminal} title={t('details.startup')} />
          <p className="type-meta mb-2">
            {t('details.variablesHint')}
          </p>
          <div className="rounded-sm border border-border/50 bg-surface-0 px-3 py-2 font-mono text-micro tabular-nums text-foreground">
            {template.startup}
          </div>
          {template.installScript && (
            <>
              <div className="mt-3">
                <SectionHeader icon={ScrollText} title={t('details.installScript')} />
              </div>
              <div className="max-h-40 overflow-y-auto rounded-sm border border-border/50 bg-surface-0 px-3 py-2 font-mono text-micro tabular-nums whitespace-pre-wrap text-foreground">
                {template.installScript}
              </div>
            </>
          )}
        </ServerTabCard>
      </div>

      {/* ── Variables ── */}
      <ServerTabCard>
        <div className="flex items-center gap-2">
          <SectionHeader icon={List} title={t('details.variables')} />
          <Segmented muted>{template.variables?.length ?? 0}</Segmented>
        </div>
        <TemplateVariablesList
          variables={template.variables ?? []}
          onSave={canUpdateVariables ? (variable) => variableMutation.mutateAsync(variable) : undefined}
          savingName={variableMutation.isPending ? variableMutation.variables?.name ?? null : null}
        />
      </ServerTabCard>

      {/* ── Controlled Edit & Delete Modals ── */}
      {showEditModal && template && (
        <TemplateEditModal
          template={template}
          open
          onOpenChange={(open) => {
            if (!open) {
              setShowEditModal(false);
              setPendingCreatedNestId(null);
            }
          }}
          createdNestId={pendingCreatedNestId}
        />
      )}
      {showDeleteModal && (
        <TemplateDeleteDialog
          templateId={template.id}
          templateName={template.name}
          onDeleted={() => navigate('/admin/templates')}
          open
          onOpenChange={(open) => { if (!open) setShowDeleteModal(false); }}
        />
      )}
    </div>
  );
}

export default TemplateDetailsPage;
