type Props = {
  title: string;
  description?: string;
  action?: React.ReactNode;
};

function EmptyState({ title, description, action }: Props) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface-1 px-6 py-10 text-center transition-all duration-150 hover:border-primary/30">
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description ? (
        <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export default EmptyState;
