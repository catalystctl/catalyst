import { useTranslation } from 'react-i18next';

type Props = {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
};

function Pagination({ page, totalPages, onPageChange, className }: Props) {
  const { t } = useTranslation('common');

  return (
    <div className={`flex items-center justify-between py-2 text-xs text-muted-foreground ${className ?? ''}`}>
      <span>
        {t('pagination.pageOf', { page, totalPages })}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          className="h-8 rounded-md border border-border px-3 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-50"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
        >
          {t('actions.previous')}
        </button>
        <button
          type="button"
          className="h-8 rounded-md border border-border px-3 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-50"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
        >
          {t('actions.next')}
        </button>
      </div>
    </div>
  );
}

export default Pagination;
export { Pagination };
