type Props = {
  title: string;
  description?: string;
  action?: React.ReactNode;
};

function EmptyState({ title, description, action }: Props) {
  return (
    <div className="rounded-sm border border-border/60 bg-surface-1/30 px-3 py-6 text-center">
      <h3 className="type-overline">{title}</h3>
      {description ? (
        <p className="type-meta mx-auto mt-1.5 max-w-md">{description}</p>
      ) : null}
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </div>
  );
}

export default EmptyState;
