import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Pencil } from 'lucide-react';
import { Button } from '../ui/button';
import type { TemplateVariable } from '../../types/template';

type Props = {
  variables: TemplateVariable[];
  /**
   * Present only for users allowed to update the template (`template.update`).
   * When omitted the list stays read-only — no pencil is rendered.
   */
  onSave?: (variable: TemplateVariable) => Promise<unknown> | void;
  /** Name of the row currently being persisted by the parent mutation. */
  savingName?: string | null;
};

/** `in:a,b,c` — the only rule that enumerates values. */
function selectOptions(variable: TemplateVariable): string[] {
  if (Array.isArray(variable.options) && variable.options.length) {
    return variable.options.map(String);
  }
  const rules = variable.rules ?? [];
  for (const rule of rules) {
    const trimmed = String(rule).trim();
    if (!trimmed.toLowerCase().startsWith('in:')) continue;
    return trimmed
      .slice(3)
      .split(',')
      .map((option) => option.trim())
      .filter(Boolean);
  }
  return [];
}

/** Imported eggs write `1`/`0` instead of `true`/`false`. */
function isChecked(variable: TemplateVariable): boolean {
  const trueValue = String(variable.trueValue ?? 'true').toLowerCase();
  const value = String(variable.default ?? '').toLowerCase();
  return value === trueValue || value === 'true' || value === '1';
}

function checkedValue(variable: TemplateVariable, checked: boolean): string {
  return checked
    ? String(variable.trueValue ?? 'true')
    : String(variable.falseValue ?? 'false');
}

const fieldClass =
  'h-7 w-full rounded-sm border border-border/60 bg-background/40 px-2 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40';

const iconButtonClass =
  'flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50';

/**
 * Dense variable rows — 1px separators instead of per-item cards.
 *
 * With `onSave` each row carries a pencil that edits *that* variable's value in
 * place (input, native select or checkbox by its `input` type), so a single
 * default can be changed without loading the four-section edit form (D18).
 */
function TemplateVariablesList({ variables, onSave, savingName }: Props) {
  const { t } = useTranslation('templates');
  const [editingName, setEditingName] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [savingLocally, setSavingLocally] = useState(false);

  if (!variables.length) {
    return (
      <div className="py-4 text-center type-meta">
        {t('variables.empty')}
      </div>
    );
  }

  const startEdit = (variable: TemplateVariable) => {
    setEditingName(variable.name);
    setDraft(String(variable.default ?? ''));
  };

  const cancelEdit = () => {
    setEditingName(null);
    setDraft('');
  };

  const submit = async (event: FormEvent, variable: TemplateVariable) => {
    event.preventDefault();
    if (!onSave) return;
    const next: TemplateVariable = { ...variable, default: draft };
    setSavingLocally(true);
    try {
      await onSave(next);
      cancelEdit();
    } catch {
      // The parent mutation toasts the failure; keep the row open for a retry.
    } finally {
      setSavingLocally(false);
    }
  };

  return (
    <div className="divide-y divide-border/50">
      {variables.map((variable) => {
        const isEditing = editingName === variable.name;
        const isSaving = savingLocally && isEditing
          ? true
          : Boolean(savingName && savingName === variable.name);
        const options = selectOptions(variable);
        const inputType = variable.input ?? 'text';

        return (
          <div
            key={variable.name}
            className="-mx-3 px-3 py-2 transition-colors hover:bg-surface-1/40"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1 font-mono text-data tabular-nums text-foreground">
                <span className="truncate" title={variable.name}>{variable.name}</span>
                {variable.required && <span className="text-micro text-danger">*</span>}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="font-mono text-micro tabular-nums text-muted-foreground">
                  {inputType}
                </span>
                {onSave && !isEditing && (
                  <button
                    type="button"
                    className={iconButtonClass}
                    onClick={() => startEdit(variable)}
                    title={t('variables.edit')}
                    aria-label={t('variables.edit')}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
            {variable.description && (
              <div className="type-meta mt-0.5">{variable.description}</div>
            )}
            {isEditing ? (
              <form
                className="mt-1.5 flex flex-wrap items-end gap-2"
                onSubmit={(event) => void submit(event, variable)}
              >
                <label className="block min-w-0 flex-1 space-y-1">
                  <span className="type-overline">{t('variables.value')}</span>
                  {inputType === 'checkbox' ? (
                    <span className="flex h-7 items-center">
                      <input
                        type="checkbox"
                        aria-label={t('variables.value')}
                        className="h-3.5 w-3.5 rounded-sm border-border/60 bg-background/40 text-primary focus:ring-primary"
                        checked={isChecked({ ...variable, default: draft })}
                        onChange={(event) => setDraft(checkedValue(variable, event.target.checked))}
                      />
                    </span>
                  ) : inputType === 'select' && options.length ? (
                    <select
                      aria-label={t('variables.value')}
                      className={fieldClass}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                    >
                      {!options.includes(draft) && (
                        <option value={draft}>{draft || t('state.notAvailable')}</option>
                      )}
                      {options.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      aria-label={t('variables.value')}
                      className={fieldClass}
                      type={inputType === 'number' ? 'number' : 'text'}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                    />
                  )}
                </label>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="submit"
                    size="sm"
                    className="h-8 px-3 text-mini"
                    disabled={isSaving}
                  >
                    {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {isSaving ? t('edit.saving') : t('common:actions.save')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 px-3 text-mini"
                    onClick={cancelEdit}
                    disabled={isSaving}
                  >
                    {t('common:actions.cancel')}
                  </Button>
                </div>
              </form>
            ) : (
              <>
                <div className="type-overline mt-1.5">
                  {t('variables.default')} <span className="font-mono tabular-nums text-foreground">{variable.default || '—'}</span>
                </div>
                {variable.rules && variable.rules.length > 0 && (
                  <div className="type-overline mt-0.5">
                    {t('variables.rules')} <span className="font-mono font-semibold tabular-nums text-foreground">{variable.rules.join(', ')}</span>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default TemplateVariablesList;