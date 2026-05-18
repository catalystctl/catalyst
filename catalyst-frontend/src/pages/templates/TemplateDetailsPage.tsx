import { useMemo, useState, useEffect } from 'react';
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
 <TabHeader icon={FileCode} title="Template" description="Loading template details…" />
 <ServerTabCard>
 <TabLoadingState rows={5} />
 </ServerTabCard>
 </div>
 );
 }

 if (isError || !template) {
 return (
 <div className="space-y-4">
 <TabHeader icon={FileCode} title="Template" />
 <TabErrorState
 message="Unable to load template details."
 onRetry={() => refetch()}
 />
 <div className="flex items-center gap-2">
 <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5 text-xs">
 Retry
 </Button>
 <Link
 to="/admin/templates"
 className="text-xs text-muted-foreground hover:text-foreground"
 >
 ← Back to templates
 </Link>
 </div>
 </div>
 );
 }

 const portList = template.supportedPorts?.length
 ? template.supportedPorts.join(', ')
 : 'n/a';
 const imageVariants = template.images ?? [];

 return (
 <div className="space-y-4">
 {/* ── Breadcrumb ── */}
 <Link
 to="/admin/templates"
 className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
 >
 <ArrowLeft className="h-3 w-3" />
 Back to Templates
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
 Edit
 </Button>
 <Button
 variant="outline"
 size="sm"
 onClick={() => setShowDeleteModal(true)}
 className="gap-1.5 text-destructive hover:bg-destructive/5 hover:text-destructive hover:border-destructive/20"
 >
 <Trash2 className="h-3.5 w-3.5" />
 Delete
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
 <SectionHeader icon={FileCode} title="Runtime" />
 <div className="space-y-1.5">
 <DataField label="Image" value={template.defaultImage || template.image} />
 {imageVariants.length > 0 && (
 <DataField
 label="Image variants"
 value={imageVariants.map((o) => o.label ?? o.name).join(', ')}
 />
 )}
 {template.defaultImage && (
 <DataField label="Default image" value={template.defaultImage} />
 )}
 <DataField label="Install image" value={template.installImage ?? 'n/a'} />
 <DataField label="Stop command" value={template.stopCommand} />
 <DataField label="Signal" value={template.sendSignalTo} />
 <DataField label="Ports" value={portList} />
 <DataField
 label="Resources"
 value={`${template.allocatedCpuCores} CPU · ${template.allocatedMemoryMb} MB`}
 />
 <DataField
 label="Config file(s)"
 value={
 template.features?.configFiles?.length
 ? template.features.configFiles.join(', ')
 : template.features?.configFile ?? 'n/a'
 }
 />
 </div>
 </ServerTabCard>

 {/* Startup card */}
 <ServerTabCard>
 <SectionHeader icon={FileCode} title="Startup" />
 <p className="mb-2 text-xs text-muted-foreground">
 Variables are substituted before container start.
 </p>
 <div className="rounded-lg border border-border/30 bg-surface-2 px-3 py-2.5 font-mono text-xs text-foreground">
 {template.startup}
 </div>
 {template.installScript && (
 <>
 <SectionHeader icon={FileCode} title="Install script" />
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
 <SectionHeader icon={FileCode} title="Variables" />
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
