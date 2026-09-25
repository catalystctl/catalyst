import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';
import { Segmented } from '../deck/primitives';
import { cn } from '@/lib/utils';
import type { Template } from '../../types/template';
import TemplateDeleteDialog from './TemplateDeleteDialog';

type Props = {
  template: Template;
  index?: number;
};

/**
 * One grid template shared by TemplateList's column header and every row.
 *   base : identity · actions
 *   md   : identity · image · resources · actions
 */
export const TEMPLATE_GRID =
  'grid grid-cols-1 items-center gap-x-3 gap-y-1 ' +
  'md:grid-cols-[minmax(0,1fr)_12rem_10rem_5.5rem]';

/** Dense browser row — no card shell, no per-item stat tiles. */
function TemplateCard({ template }: Props) {
  const { t } = useTranslation('templates');
  const iconUrl = template.features?.iconUrl;
  const description = template.description?.trim() || t('card.noDescription');

  return (
    <div
      role="row"
      className={cn(TEMPLATE_GRID, 'py-1.5 pl-3 pr-3 transition-colors hover:bg-surface-1/40')}
    >
      {/* identity */}
      <div className="flex min-w-0 items-center gap-2">
        {iconUrl ? (
          <img
            src={iconUrl}
            alt=""
            className="h-5 w-5 shrink-0 rounded-sm border border-border/50 object-cover"
          />
        ) : (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-border/50 font-display text-micro font-semibold text-muted-foreground">
            {template.name.slice(0, 2).toUpperCase()}
          </span>
        )}
        <div className="flex min-w-0 flex-col leading-tight">
          <Link
            to={`/admin/templates/${template.id}`}
            title={template.name}
            className="truncate font-display text-data font-semibold tracking-tight text-foreground hover:text-primary"
          >
            {template.name}
          </Link>
          <span className="flex min-w-0 items-center gap-2 text-micro text-muted-foreground">
            <span className="truncate">{template.author}</span>
            <Segmented muted className="shrink-0">v{template.version}</Segmented>
            <span className="hidden truncate lg:inline">{description}</span>
          </span>
        </div>
      </div>

      {/* image */}
      <span className="hidden min-w-0 md:flex">
        <span className="truncate font-mono text-mini tabular-nums text-muted-foreground">
          {template.defaultImage || template.image}
        </span>
      </span>

      {/* resources */}
      <span className="hidden justify-end md:flex">
        <Segmented muted>{template.allocatedCpuCores} CPU · {template.allocatedMemoryMb} MB</Segmented>
      </span>

      {/* actions */}
      <span className="col-span-full flex shrink-0 items-center justify-start gap-1 md:col-auto md:justify-end">
        <Link
          to={`/admin/templates/${template.id}`}
          title={t('actions.view')}
          aria-label={t('actions.view')}
          className="flex h-7 items-center gap-1 rounded-sm border border-border/60 px-2.5 text-mini text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
        >
          <ExternalLink className="h-3 w-3" />
          {t('actions.view')}
        </Link>
        <TemplateDeleteDialog
          templateId={template.id}
          templateName={template.name}
          buttonClassName="h-7 rounded-sm border border-border/60 px-2.5 text-mini text-muted-foreground transition-colors hover:border-danger/50 hover:text-danger"
        />
      </span>
    </div>
  );
}

export default TemplateCard;
