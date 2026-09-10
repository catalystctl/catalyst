import { useTranslation } from 'react-i18next';
import type { Template } from '../../types/template';
import EmptyState from '../shared/EmptyState';
import TemplateCard from './TemplateCard';

type Props = {
 templates: Template[];
};

function TemplateList({ templates }: Props) {
 const { t } = useTranslation('templates');
 if (!templates.length) {
 return (
 <EmptyState
 title={t('list.emptyTitle')}
 description={t('list.emptyDescription')}
 />
 );
 }

 return (
 <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
 {templates.map((template, i) => (
 <TemplateCard key={template.id} template={template} index={i} />
 ))}
 </div>
 );
}

export default TemplateList;
