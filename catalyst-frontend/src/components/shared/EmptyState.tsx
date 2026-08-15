type Props = {
  title: string;
  description?: string;
  action?: React.ReactNode;
};

function EmptyState({ title, description, action }: Props) {
  return (
    <div className="rounded-lg border border-dashed border-border/70 bg-card px-3 py-6 text-center">
      <h3 className="text-sm font-semibold tracking-tight text-foreground">{title}</h3>
      {description ? (
        <p className="type-meta mx-auto mt-1.5 max-w-md">{description}</p>
      ) : null}
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </div>
  );
}

export default EmptyState;
