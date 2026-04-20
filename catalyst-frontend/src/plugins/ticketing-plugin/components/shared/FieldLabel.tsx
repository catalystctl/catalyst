export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </label>
  );
}
