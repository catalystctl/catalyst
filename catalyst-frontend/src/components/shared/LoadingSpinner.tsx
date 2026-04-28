function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-10 text-muted-foreground dark:text-muted-foreground">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-border border-t-primary-500 dark:border-border dark:border-t-primary-400" />
    </div>
  );
}

export default LoadingSpinner;
