import { Link } from 'react-router-dom';
import { Cpu, HardDrive, ExternalLink } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import type { Template } from '../../types/template';
import TemplateDeleteDialog from './TemplateDeleteDialog';

type Props = {
 template: Template;
 index?: number;
};

function TemplateCard({ template }: Props) {
 const iconUrl = template.features?.iconUrl;
 const description = template.description?.trim() || 'No description provided.';

 return (
 <div className="group relative overflow-hidden rounded-xl border border-border/30 bg-card border-l-2 border-primary transition-colors hover:border-primary/60">
 <div className="p-5">
 {/* Header row */}
 <div className="flex items-start justify-between gap-3">
 <div className="flex items-start gap-3 min-w-0">
 <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-border/30 bg-surface-2">
 {iconUrl ? (
 <img src={iconUrl} alt="" className="h-full w-full object-cover" />
 ) : (
 <div className="flex h-full w-full items-center justify-center text-xs font-bold uppercase text-muted-foreground">
 {template.name.slice(0, 2)}
 </div>
 )}
 </div>
 <div className="min-w-0">
 <div className="flex items-center gap-2">
 <Link
 to={`/admin/templates/${template.id}`}
 className="truncate font-semibold text-foreground transition-colors hover:text-primary"
 >
 {template.name}
 </Link>
 </div>
 <div className="mt-1 flex flex-wrap items-center gap-1.5">
 <Badge variant="secondary" className="text-[11px]">
 {template.author}
 </Badge>
 <Badge variant="outline" className="text-[11px]">
 v{template.version}
 </Badge>
 </div>
 </div>
 </div>

 <div className="flex shrink-0 items-center gap-1.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
 <Link
 to={`/admin/templates/${template.id}`}
 className="flex items-center gap-1 rounded-md border border-border/30 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
 >
 View
 <ExternalLink className="h-3 w-3" />
 </Link>
 <TemplateDeleteDialog
 templateId={template.id}
 templateName={template.name}
 buttonClassName="rounded-md border border-border/30 px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-destructive/50 hover:bg-destructive/5 hover:text-destructive"
 />
 </div>
 </div>

 {/* Description */}
 <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">{description}</p>

 {/* Resource stats */}
 <div className="mt-4 grid grid-cols-2 gap-2.5">
 <div className="rounded-lg border border-border/30 bg-surface-2/50 p-2.5">
 <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
 <HardDrive className="h-3 w-3" />
 <span>Image</span>
 </div>
 <div className="mt-1 truncate text-xs font-medium text-foreground">
 {template.defaultImage || template.image}
 </div>
 </div>
 <div className="rounded-lg border border-border/30 bg-surface-2/50 p-2.5">
 <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
 <Cpu className="h-3 w-3" />
 <span>Resources</span>
 </div>
 <div className="mt-1 text-xs font-medium text-foreground">
 {template.allocatedCpuCores} CPU · {template.allocatedMemoryMb} MB
 </div>
 </div>
 </div>
 </div>
 </div>
 );
}

export default TemplateCard;
