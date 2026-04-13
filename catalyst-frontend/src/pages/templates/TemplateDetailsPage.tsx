import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTemplate } from '../../hooks/useTemplates';
import TemplateVariablesList from '../../components/templates/TemplateVariablesList';
import { useAuthStore } from '../../stores/authStore';
import TemplateEditModal from '../../components/templates/TemplateEditModal';
import TemplateDeleteDialog from '../../components/templates/TemplateDeleteDialog';

function TemplateDetailsPage() {
  const { templateId } = useParams();
  const navigate = useNavigate();
  const { data: template, isLoading, isError } = useTemplate(templateId);
  const { user } = useAuthStore();
  const canWrite = useMemo(
    () => user?.permissions?.includes('admin.write') || user?.permissions?.includes('*'),
    [user?.permissions],
  );

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-white px-4 py-6 text-muted-foreground shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-300 dark:hover:border-primary/30">
        Loading template...
      </div>
    );
  }

  if (isError || !template) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-100/60 px-4 py-6 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
        Unable to load template details.
      </div>
    );
  }

  const iconUrl = template.features?.iconUrl;
  const portList = template.supportedPorts?.length
    ? template.supportedPorts.join(', ')
    : 'n/a';
  const imageVariants = template.images ?? [];

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-white p-6 shadow-surface-light transition-all duration-300 hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:shadow-surface-dark dark:hover:border-primary/30">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-14 w-14 overflow-hidden rounded-xl border border-border bg-surface-2 text-muted-foreground dark:border-border dark:bg-zinc-950 dark:text-zinc-200">
              {iconUrl ? (
                <img src={iconUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-sm font-semibold uppercase">
                  {template.name.slice(0, 2)}
                </div>
              )}
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-foreground dark:text-white">
                {template.name}
              </h1>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground dark:text-muted-foreground">
                <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 dark:border-border dark:bg-zinc-950/60">
                  {template.author}
                </span>
                <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 dark:border-border dark:bg-zinc-950/60">
                  v{template.version}
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Link
              to="/admin/templates"
              className="rounded-full border border-border px-3 py-1 font-semibold text-muted-foreground transition-all duration-300 hover:border-primary-500 hover:text-foreground dark:border-border dark:text-zinc-300 dark:hover:border-primary/30"
            >
              Back
            </Link>
            {canWrite ? (
              <>
                <TemplateEditModal template={template} />
                <TemplateDeleteDialog
                  templateId={template.id}
                  templateName={template.name}
                  onDeleted={() => navigate('/admin/templates')}
                  buttonClassName="rounded-full border border-rose-200 px-3 py-1 text-xs font-semibold text-rose-600 transition-all duration-300 hover:border-rose-400 dark:border-rose-500/30 dark:text-rose-300"
                />
                <span className="rounded-full bg-surface-2 px-3 py-1 text-xs text-muted-foreground dark:bg-surface-2 dark:text-zinc-300">
                  Admin
                </span>
              </>
            ) : null}
          </div>
        </div>
        {template.description ? (
          <p className="mt-3 text-sm text-muted-foreground dark:text-zinc-300">{template.description}</p>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-white px-5 py-4 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:hover:border-primary/30">
          <div className="text-sm font-semibold text-foreground dark:text-zinc-100">Runtime</div>
          <div className="mt-3 space-y-2 text-xs text-muted-foreground dark:text-zinc-300">
            <div className="flex items-center justify-between gap-4">
              <span>Image</span>
              <span className="text-foreground dark:text-zinc-100">
                {template.defaultImage || template.image}
              </span>
            </div>
            {imageVariants.length ? (
              <div className="flex items-center justify-between gap-4">
                <span>Image variants</span>
                <span className="text-foreground dark:text-zinc-100">
                  {imageVariants.map((option) => option.label ?? option.name).join(', ')}
                </span>
              </div>
            ) : null}
            {template.defaultImage ? (
              <div className="flex items-center justify-between gap-4">
                <span>Default image</span>
                <span className="text-foreground dark:text-zinc-100">{template.defaultImage}</span>
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-4">
              <span>Install image</span>
              <span className="text-foreground dark:text-zinc-100">{template.installImage ?? 'n/a'}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Stop command</span>
              <span className="text-foreground dark:text-zinc-100">{template.stopCommand}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Signal</span>
              <span className="text-foreground dark:text-zinc-100">{template.sendSignalTo}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Ports</span>
              <span className="text-foreground dark:text-zinc-100">{portList}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Resources</span>
              <span className="text-foreground dark:text-zinc-100">
                {template.allocatedCpuCores} CPU · {template.allocatedMemoryMb} MB
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Config file(s)</span>
              <span className="text-foreground dark:text-zinc-100">
                {template.features?.configFiles?.length
                  ? template.features.configFiles.join(', ')
                  : template.features?.configFile ?? 'n/a'}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-white px-5 py-4 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:hover:border-primary/30">
          <div className="text-sm font-semibold text-foreground dark:text-zinc-100">Startup</div>
          <p className="mt-2 text-xs text-muted-foreground dark:text-muted-foreground">
            Variables are substituted before container start.
          </p>
          <div className="mt-3 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-muted-foreground dark:border-border dark:bg-zinc-950 dark:text-zinc-200">
            {template.startup}
          </div>
          {template.installScript ? (
            <>
              <div className="mt-4 text-sm font-semibold text-foreground dark:text-zinc-100">
                Install script
              </div>
              <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-muted-foreground dark:border-border dark:bg-zinc-950 dark:text-zinc-200 whitespace-pre-wrap">
                {template.installScript}
              </div>
            </>
          ) : null}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-white px-5 py-4 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:hover:border-primary/30">
        <div className="text-sm font-semibold text-foreground dark:text-zinc-100">Variables</div>
        <div className="mt-3">
          <TemplateVariablesList variables={template.variables ?? []} />
        </div>
      </div>
    </div>
  );
}

export default TemplateDetailsPage;
