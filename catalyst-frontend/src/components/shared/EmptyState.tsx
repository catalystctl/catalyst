type Props = {
  title: string;
  description?: string;
  action?: React.ReactNode;
};

function EmptyState({ title, description, action }: Props) {
  return (
    <div className="rounded-xl border border-dashed border-border/40 bg-card px-5 py-7 text-center">
      <h3 className="font-display text-sm font-semibold text-foreground">{title}</h3>
      {description ? (
        <p className="type-meta mx-auto mt-1.5 max-w-md">{description}</p>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export default EmptyState;
