import { useTranslation } from 'react-i18next';

/**
 * Busy indicator. `role="status"` announced nothing on its own — a screen
 * reader reported an unnamed status region — so the visible spinner carries an
 * `sr-only` label instead of relying on surrounding text.
 */
function LoadingSpinner({ label }: { label?: string }) {
  const { t } = useTranslation('common');

  return (
    <div role="status" className="flex items-center justify-center py-10 text-muted-foreground">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" aria-hidden="true" />
      <span className="sr-only">{label ?? t('actions.loading')}</span>
    </div>
  );
}

export default LoadingSpinner;
