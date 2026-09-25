import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/ui/badge';
import type { TemplateVariable } from '../../types/template';

type Props = {
 variables: TemplateVariable[];
};

function TemplateVariablesList({ variables }: Props) {
 const { t } = useTranslation('templates');
 if (!variables.length) {
 return (
 <div className="py-4 text-center text-sm text-muted-foreground">
 {t('variables.empty')}
 </div>
 );
 }

 return (
 <div className="space-y-2">
 {variables.map((variable) => (
 <div
 key={variable.name}
 className="rounded-md border border-border/50 bg-surface-2/50 px-3 py-2.5 transition-colors hover:bg-surface-2"
 >
 <div className="flex items-center justify-between gap-2">
 <div className="type-numeric text-sm text-foreground">
 {variable.name}
 {variable.required && <span className="ml-1 text-xs text-destructive">*</span>}
 </div>
 <Badge variant="outline" className="shrink-0 font-mono text-[11px] tabular-nums">
 {variable.input ?? 'text'}
 </Badge>
 </div>
 {variable.description && (
 <div className="type-meta mt-0.5">{variable.description}</div>
 )}
 <div className="type-overline mt-1.5">
 {t('variables.default')} <span className="type-numeric text-foreground">{variable.default || '—'}</span>
 </div>
 {variable.rules && variable.rules.length > 0 && (
 <div className="type-overline mt-0.5">
 {t('variables.rules')} <span className="font-mono font-semibold tabular-nums text-foreground">{variable.rules.join(', ')}</span>
 </div>
 )}
 </div>
 ))}
 </div>
 );
}

export default TemplateVariablesList;