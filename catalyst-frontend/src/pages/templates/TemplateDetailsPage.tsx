import { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
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
import TabHeader from '../../components/servers/tabs/TabHeader';
import ServerTabCard from '../../components/servers/tabs/ServerTabCard';
import SectionHeader from '../../components/servers/tabs/SectionHeader';
import DataField from '../../components/servers/tabs/DataField';
import TabLoadingState from '../../components/servers/tabs/TabLoadingState';
import TabErrorState from '../../components/servers/tabs/TabErrorState';

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

 if (isLoading) {
 return (
 <div className="space-y-4">
 <TabHeader icon={FileCode} title={t('details.title')} description={t('details.loading')} />
 <ServerTabCard>
 <TabLoadingState rows={5} />
 </ServerTabCard>
 </div>
 );
 }

 if (isError || !template) {
 return (
 <div className="space-y-4">
 <TabHeader icon={FileCode} title={t('details.title')} />
 <TabErrorState
 message={t('details.loadError')}
 onRetry={() => refetch()}
 />
 <div className="flex items-center gap-2">
 <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5 text-xs">
 {t('common:actions.retry')}
 </Button>
 <Link
 to="/admin/templates"
 className="text-xs text-muted-foreground hover:text-foreground"
 >
 {t('details.backLink')}
 </Link>
 </div>
 </div>
 );
 }

 const portList = template.supportedPorts?.length
    ? template.supportedPorts.join(', ')
    : t('state.notAvailable');
 const imageVariants = template.images ?? [];

 return (
 <div className="space-y-4">
 {/* ── Breadcrumb ── */}
 <Link
 to="/admin/templates"
 className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
 >
 <ArrowLeft className="h-3 w-3" />
 {t('details.back')}
 </Link>

 {/* ── Header ── */}
 <TabHeader
 icon={FileCode}
 title={template.name}
 description={template.description || undefined}
 actions={
 canWrite && (
 <div className="flex flex-wrap items-center gap-2">
 <Button variant="outline" size="sm" onClick={() => setShowEditModal(true)} className="gap-1.5">
 <Settings className="h-3.5 w-3.5" />
 {t('common:actions.edit')}
 </Button>
 <Button
 variant="outline"
 size="sm"
 onClick={() => setShowDeleteModal(true)}
 className="gap-1.5 text-destructive hover:bg-destructive/5 hover:text-destructive hover:border-destructive/20"
 >
 <Trash2 className="h-3.5 w-3.5" />
 {t('common:actions.delete')}
 </Button>
 </div>
 )
 }
 />

 <div className="flex flex-wrap items-center gap-1.5">
 <Badge variant="secondary" className="text-xs">
 {template.author}
 </Badge>
 <Badge variant="outline" className="text-xs">
 v{template.version}
 </Badge>
 </div>

 {/* ── Info Grid ── */}
 <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
 {/* Runtime card */}
 <ServerTabCard>
 <SectionHeader icon={FileCode} title={t('details.runtime')} />
 <div className="space-y-1.5">
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
 value={`${template.allocatedCpuCores} CPU · ${template.allocatedMemoryMb} MB`}
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

 {/* Startup card */}
 <ServerTabCard>
 <SectionHeader icon={FileCode} title={t('details.startup')} />
 <p className="mb-2 text-xs text-muted-foreground">
 {t('details.variablesHint')}
 </p>
 <div className="rounded-lg border border-border/30 bg-surface-2 px-3 py-2.5 font-mono text-xs text-foreground">
 {template.startup}
 </div>
 {template.installScript && (
 <>
 <SectionHeader icon={FileCode} title={t('details.installScript')} />
 <div className="max-h-40 overflow-y-auto rounded-lg border border-border/30 bg-surface-2 px-3 py-2.5 font-mono text-xs whitespace-pre-wrap text-foreground">
 {template.installScript}
 </div>
 </>
 )}
 </ServerTabCard>
 </div>

 {/* ── Variables ── */}
 <ServerTabCard>
 <div className="flex items-center gap-2">
 <SectionHeader icon={FileCode} title={t('details.variables')} />
 <Badge variant="outline" className="text-xs">
 {template.variables?.length ?? 0}
 </Badge>
 </div>
 <div className="mt-2">
 <TemplateVariablesList variables={template.variables ?? []} />
 </div>
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
