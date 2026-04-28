type Props = {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
};

function Pagination({ page, totalPages, onPageChange }: Props) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground shadow-surface-light dark:border-border dark:text-muted-foreground dark:shadow-surface-dark">
      <span>
        Page {page} of {totalPages}
      </span>
      <div className="flex gap-2">
        <button
          className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-all duration-300 hover:border-primary hover:text-foreground dark:border-border dark:text-foreground disabled:opacity-50"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
        >
          Previous
        </button>
        <button
          className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-all duration-300 hover:border-primary hover:text-foreground dark:border-border dark:text-foreground disabled:opacity-50"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
        >
          Next
        </button>
      </div>
    </div>
  );
}

export default Pagination;
export { Pagination };
