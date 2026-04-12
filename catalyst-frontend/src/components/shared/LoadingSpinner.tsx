function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-10 text-muted-foreground">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-surface-3 border-t-primary" />
    </div>
  );
}

export default LoadingSpinner;
