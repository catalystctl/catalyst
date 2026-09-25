import { useTranslation } from 'react-i18next';
import type { TemplateVariable } from '../../types/template';

type Props = {
  variables: TemplateVariable[];
};

/** Dense variable rows — 1px separators instead of per-item cards. */
function TemplateVariablesList({ variables }: Props) {
  const { t } = useTranslation('templates');
  if (!variables.length) {
    return (
      <div className="py-4 text-center type-meta">
        {t('variables.empty')}
      </div>
    );
  }

  return (
    <div className="divide-y divide-border/50">
      {variables.map((variable) => (
        <div
          key={variable.name}
          className="py-2 transition-colors hover:bg-surface-1/40"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="font-mono text-data tabular-nums text-foreground">
              {variable.name}
              {variable.required && <span className="ml-1 text-micro text-danger">*</span>}
            </div>
            <span className="shrink-0 font-mono text-micro tabular-nums text-muted-foreground">
              {variable.input ?? 'text'}
            </span>
          </div>
          {variable.description && (
            <div className="type-meta mt-0.5">{variable.description}</div>
          )}
          <div className="type-overline mt-1.5">
            {t('variables.default')} <span className="font-mono tabular-nums text-foreground">{variable.default || '—'}</span>
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
