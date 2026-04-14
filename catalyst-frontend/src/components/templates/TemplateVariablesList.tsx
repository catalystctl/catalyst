import { Badge } from '../../components/ui/badge';
import type { TemplateVariable } from '../../types/template';

type Props = {
  variables: TemplateVariable[];
};

function TemplateVariablesList({ variables }: Props) {
  if (!variables.length) {
    return (
      <div className="py-4 text-center text-sm text-muted-foreground">
        No variables defined.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {variables.map((variable) => (
        <div
          key={variable.name}
          className="rounded-lg border border-border/50 bg-surface-2/50 px-3 py-2.5 transition-colors hover:bg-surface-2 dark:bg-surface-2/30"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium text-foreground dark:text-zinc-100">
              {variable.name}
              {variable.required && <span className="ml-1 text-xs text-rose-400">*</span>}
            </div>
            <Badge variant="outline" className="shrink-0 text-[11px]">
              {variable.input ?? 'text'}
            </Badge>
          </div>
          {variable.description && (
            <div className="mt-0.5 text-xs text-muted-foreground">{variable.description}</div>
          )}
          <div className="mt-1.5 text-xs text-muted-foreground">
            Default: <span className="font-medium text-foreground dark:text-zinc-300">{variable.default || '—'}</span>
          </div>
          {variable.rules && variable.rules.length > 0 && (
            <div className="mt-0.5 text-xs text-muted-foreground">
              Rules: <span className="font-medium text-foreground dark:text-zinc-300">{variable.rules.join(', ')}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default TemplateVariablesList;
