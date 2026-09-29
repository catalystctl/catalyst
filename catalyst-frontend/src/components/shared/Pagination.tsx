import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';

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
        <Button
          type="button"
          variant="outline" size="sm"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
        >
          {t('actions.previous')}
        </Button>
        <Button
          type="button"
          variant="outline" size="sm"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
        >
          {t('actions.next')}
        </Button>
      </div>
    </div>
  );
}

export default Pagination;
export { Pagination };
