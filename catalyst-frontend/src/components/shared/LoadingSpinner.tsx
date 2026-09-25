function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-10 text-muted-foreground">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
    </div>
  );
}

export default LoadingSpinner;
