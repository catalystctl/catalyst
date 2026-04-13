import type { TemplateVariable } from '../../types/template';

type Props = {
  variables: TemplateVariable[];
};

function TemplateVariablesList({ variables }: Props) {
  if (!variables.length) {
    return <div className="text-sm text-muted-foreground dark:text-muted-foreground">No variables defined.</div>;
  }

  return (
    <div className="space-y-3">
      {variables.map((variable) => (
        <div
          key={variable.name}
          className="rounded-lg border border-border bg-white px-3 py-2 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:hover:border-primary/30"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-foreground dark:text-zinc-100">
              {variable.name}
              {variable.required ? <span className="ml-1 text-xs text-rose-400">*</span> : null}
            </div>
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted-foreground dark:bg-surface-2 dark:text-zinc-300">
              {variable.input ?? 'text'}
            </span>
          </div>
          {variable.description ? (
            <div className="mt-1 text-xs text-muted-foreground dark:text-muted-foreground">
              {variable.description}
            </div>
          ) : null}
          <div className="mt-2 text-xs text-muted-foreground dark:text-muted-foreground">
            Default:{' '}
            <span className="text-foreground dark:text-zinc-300">{variable.default || '—'}</span>
          </div>
          {variable.rules?.length ? (
            <div className="mt-1 text-xs text-muted-foreground dark:text-muted-foreground">
              Rules:{' '}
              <span className="text-foreground dark:text-zinc-300">{variable.rules.join(', ')}</span>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export default TemplateVariablesList;
