import { useTranslation } from 'react-i18next';
import { Package } from 'lucide-react';
import type { Template } from '../../types/template';
import TemplateCard, { TEMPLATE_GRID } from './TemplateCard';

type Props = {
  templates: Template[];
};

/** Template rows in one deck panel: sticky column header + dense rows. */
function TemplateList({ templates }: Props) {
  const { t } = useTranslation('templates');

  if (!templates.length) {
    return (
      <div className="deck-panel flex flex-col items-center justify-center gap-1.5 py-12 text-center">
        <Package className="h-4 w-4 text-muted-foreground" />
        <p className="type-meta">{t('list.emptyTitle')}</p>
        <p className="type-overline">{t('list.emptyDescription')}</p>
      </div>
    );
  }

  return (
    <div className="deck-panel flex min-h-0 flex-col overflow-hidden">
      <div
        className={`${TEMPLATE_GRID} hidden border-b border-border/50 bg-surface-1 px-3 py-1.5 text-muted-foreground/70 md:grid`}
      >
        <span className="type-overline" aria-hidden />
        <span className="type-overline hidden md:inline-flex">{t('image')}</span>
        <span className="type-overline hidden justify-end md:inline-flex">{t('resources')}</span>
        <span className="type-overline justify-self-end">{t('actions.view')}</span>
      </div>

      <div className="divide-y divide-border/40">
        {templates.map((template, i) => (
          <TemplateCard key={template.id} template={template} index={i} />
        ))}
      </div>
    </div>
  );
}

export default TemplateList;
