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
    <div className={`flex items-center justify-between py-2 text-mini ${className ?? ''}`}>
      <span className="font-mono tabular-nums text-muted-foreground">
        {t('pagination.pageOf', { page, totalPages })}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="h-7 rounded-sm border border-border/60 px-2.5 text-mini text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-50"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
        >
          {t('actions.previous')}
        </button>
        <button
          type="button"
          className="h-7 rounded-sm border border-border/60 px-2.5 text-mini text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-50"
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
