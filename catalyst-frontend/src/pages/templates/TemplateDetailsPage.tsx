import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion, type Variants } from 'framer-motion';
import {
  FileCode,
  ArrowLeft,
  Settings,
  Trash2,
} from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { useTemplate } from '../../hooks/useTemplates';
import TemplateVariablesList from '../../components/templates/TemplateVariablesList';
import { useAuthStore } from '../../stores/authStore';
import TemplateEditModal from '../../components/templates/TemplateEditModal';
import TemplateDeleteDialog from '../../components/templates/TemplateDeleteDialog';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05, delayChildren: 0.05 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 300, damping: 24 },
  },
};

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="truncate text-right text-xs font-medium text-foreground dark:text-zinc-100">
        {value}
      </span>
    </div>
  );
}

function TemplateDetailsPage() {
  const { templateId } = useParams();
  const navigate = useNavigate();
  const { data: template, isLoading, isError, refetch } = useTemplate(templateId);
  const { user } = useAuthStore();
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const canWrite = useMemo(
    () => user?.permissions?.includes('admin.write') || user?.permissions?.includes('*'),
    [user?.permissions],
  );

  if (isLoading) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex items-center justify-center py-20"
      >
        <div className="text-sm text-muted-foreground">Loading template…</div>
      </motion.div>
    );
  }

  if (isError || !template) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex items-center justify-center py-20"
      >
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-6 py-4 text-center">
          <p className="text-sm font-medium text-rose-600 dark:text-rose-400">
            Unable to load template details.
          </p>
          <div className="mt-3 flex items-center justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="gap-1.5 text-xs"
            >
              Retry
            </Button>
            <Link to="/admin/templates" className="text-xs text-muted-foreground hover:text-foreground">
              ← Back to templates
            </Link>
          </div>
        </div>
      </motion.div>
    );
  }

  const iconUrl = template.features?.iconUrl;
  const portList = template.supportedPorts?.length
    ? template.supportedPorts.join(', ')
    : 'n/a';
  const imageVariants = template.images ?? [];

  return (
    <motion.div
      variants={containerVariants}
      initial={false}
      animate="visible"
      className="relative min-h-screen overflow-hidden"
    >
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-gradient-to-br from-amber-500/8 to-rose-500/8 blur-3xl dark:from-amber-500/15 dark:to-rose-500/15" />
        <div className="absolute bottom-0 -left-32 h-80 w-80 rounded-full bg-gradient-to-tr from-violet-500/8 to-cyan-500/8 blur-3xl dark:from-violet-500/15 dark:to-cyan-500/15" />
      </div>

      <div className="relative z-10 space-y-5">
        {/* ── Breadcrumb ── */}
        <motion.div variants={itemVariants}>
          <Link
            to="/admin/templates"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to Templates
          </Link>
        </motion.div>

        {/* ── Header ── */}
        <motion.div variants={itemVariants}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-3">
                <div className="h-14 w-14 overflow-hidden rounded-xl border border-border bg-surface-2">
                  {iconUrl ? (
                    <img src={iconUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-sm font-bold uppercase text-muted-foreground">
                      {template.name.slice(0, 2)}
                    </div>
                  )}
                </div>
                <div>
                  <h1 className="font-display text-3xl font-bold tracking-tight text-foreground dark:text-white">
                    {template.name}
                  </h1>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary" className="text-xs">
                      {template.author}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      v{template.version}
                    </Badge>
                  </div>
                </div>
              </div>
              {template.description && (
                <p className="ml-[4.25rem] text-sm text-muted-foreground">
                  {template.description}
                </p>
              )}
            </div>

            {canWrite && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowEditModal(true)}
                  className="gap-1.5"
                >
                  <Settings className="h-3.5 w-3.5" />
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDeleteModal(true)}
                  className="gap-1.5 text-rose-600 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 dark:text-rose-400 dark:hover:bg-rose-950/30 dark:hover:border-rose-800"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
              </div>
            )}
          </div>
        </motion.div>

        {/* ── Info Grid ── */}
        <motion.div
          variants={itemVariants}
          className="grid grid-cols-1 gap-4 lg:grid-cols-2"
        >
          {/* Runtime card */}
          <div className="rounded-xl border border-border bg-card/80 p-5 backdrop-blur-sm">
            <h2 className="font-display text-sm font-semibold text-foreground dark:text-white">
              Runtime
            </h2>
            <div className="mt-3 divide-y divide-border/50">
              <DetailRow label="Image" value={template.defaultImage || template.image} />
              {imageVariants.length > 0 && (
                <DetailRow
                  label="Image variants"
                  value={imageVariants.map((o) => o.label ?? o.name).join(', ')}
                />
              )}
              {template.defaultImage && (
                <DetailRow label="Default image" value={template.defaultImage} />
              )}
              <DetailRow label="Install image" value={template.installImage ?? 'n/a'} />
              <DetailRow label="Stop command" value={template.stopCommand} />
              <DetailRow label="Signal" value={template.sendSignalTo} />
              <DetailRow label="Ports" value={portList} />
              <DetailRow
                label="Resources"
                value={`${template.allocatedCpuCores} CPU · ${template.allocatedMemoryMb} MB`}
              />
              <DetailRow
                label="Config file(s)"
                value={
                  template.features?.configFiles?.length
                    ? template.features.configFiles.join(', ')
                    : template.features?.configFile ?? 'n/a'
                }
              />
            </div>
          </div>

          {/* Startup card */}
          <div className="rounded-xl border border-border bg-card/80 p-5 backdrop-blur-sm">
            <h2 className="font-display text-sm font-semibold text-foreground dark:text-white">
              Startup
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Variables are substituted before container start.
            </p>
            <div className="mt-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5 font-mono text-xs text-foreground dark:bg-zinc-950/40 dark:text-zinc-200">
              {template.startup}
            </div>
            {template.installScript && (
              <>
                <h3 className="mt-5 font-display text-sm font-semibold text-foreground dark:text-white">
                  Install script
                </h3>
                <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-border bg-surface-2 px-3 py-2.5 font-mono text-xs text-foreground whitespace-pre-wrap dark:bg-zinc-950/40 dark:text-zinc-200">
                  {template.installScript}
                </div>
              </>
            )}
          </div>
        </motion.div>

        {/* ── Variables ── */}
        <motion.div variants={itemVariants}>
          <div className="rounded-xl border border-border bg-card/80 p-5 backdrop-blur-sm">
            <h2 className="font-display text-sm font-semibold text-foreground dark:text-white">
              Variables
              <Badge variant="outline" className="ml-2 text-xs">
                {template.variables?.length ?? 0}
              </Badge>
            </h2>
            <div className="mt-3">
              <TemplateVariablesList variables={template.variables ?? []} />
            </div>
          </div>
        </motion.div>
      </div>

      {/* ── Controlled Edit & Delete Modals ── */}
      {showEditModal && template && (
        <TemplateEditModal
          template={template}
          open
          onOpenChange={(open) => { if (!open) setShowEditModal(false); }}
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
    </motion.div>
  );
}

export default TemplateDetailsPage;
