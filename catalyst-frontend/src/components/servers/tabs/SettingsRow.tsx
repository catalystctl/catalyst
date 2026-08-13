import type { ReactNode } from 'react';

export function SettingsRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 py-2.5 last:border-0">
      <div className="min-w-[12rem] flex-1">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description ? <p className="type-meta mt-0.5 max-w-xl">{description}</p> : null}
      </div>
      <div className="flex min-w-[12rem] shrink-0 items-center justify-end gap-2">{children}</div>
    </div>
  );
}

export default SettingsRow;
