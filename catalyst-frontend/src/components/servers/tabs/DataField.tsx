import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Eye, EyeOff } from 'lucide-react';
import { notifySuccess, notifyError } from '../../../utils/notify';

/**
 * Canonical data field row — replaces both CopyableValue and CredentialField.
 * Shows a label on the left and a value on the right.
 * Optional copy button, optional visibility toggle.
 */
export default function DataField({
 label,
 value,
 copyable = false,
 concealable = false,
}: {
 label: string;
 value: string;
 /** Show copy button */
 copyable?: boolean;
 /** Show eye toggle to hide/reveal value */
 concealable?: boolean;
}) {
 const { t } = useTranslation('server-tabs');
 const [visible, setVisible] = useState(!concealable);

 const copy = useCallback(() => {
 navigator.clipboard.writeText(value).then(
 () => notifySuccess(t('common:actions.copied')),
 () => notifyError(t('shared.copyFailed')),
 );
 }, [t, value]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 py-2 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        <code className="type-numeric text-xs text-foreground">
          {concealable && !visible ? '••••••••' : value || '—'}
        </code>
        {concealable && (
          <button
            type="button"
            onClick={() => setVisible(!visible)}
            className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            aria-label={visible ? t('shared.hideValue') : t('shared.showValue')}
          >
            {visible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          </button>
        )}
        {copyable && (
          <button
            type="button"
            onClick={copy}
            className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            aria-label={t('common:actions.copy')}
          >
            <Copy className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );


}
