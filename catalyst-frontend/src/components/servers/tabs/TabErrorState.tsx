import { useTranslation } from 'react-i18next';
import { AlertCircle } from 'lucide-react';

interface TabErrorStateProps {
  message?: string;
  title?: string;
  description?: string;
  onRetry?: () => void;
}

/**
 * Error state that sits inside the deck panel: a flat status strip, no nested
 * rounded card and no icon tile.
 */
export default function TabErrorState({ message, title, description, onRetry }: TabErrorStateProps) {
  const { t } = useTranslation('server-tabs');
  const heading = message ?? title ?? t('shared.somethingWentWrong');

  return (
    <div className="rounded-sm border border-danger/30 bg-danger/5 px-3 py-2.5">
      <div className="flex items-start gap-2 text-mini text-danger">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div className="min-w-0">
          <p>{heading}</p>
          {description && <p className="type-meta mt-1">{description}</p>}
        </div>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 ml-6 h-7 rounded-sm border border-danger/30 px-2.5 text-mini font-semibold text-danger transition-colors hover:bg-danger/10"
        >
          {t('common:actions.retry')}
        </button>
      )}
    </div>
  );
}
