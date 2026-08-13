import type { ComponentType } from 'react';

/**
 * Canonical section header used inside ServerTabCard.
 * Every tab section uses this — no other section-header pattern should exist.
 */
export default function SectionHeader({
 icon: Icon,
 title,
 description,
 accent = 'primary',
}: {
 icon: ComponentType<{ className?: string }>;
 title: string;
 description?: string;
 accent?: 'primary' | 'warning' | 'danger';
}) {
 const iconColor =
 accent === 'danger'
 ? 'text-danger'
 : accent === 'warning'
 ? 'text-warning'
 : 'text-primary';

  return (
    <div className="mb-3">
      <div className="flex items-center gap-2">
        <Icon className={`h-3.5 w-3.5 ${iconColor}`} />
        <h3 className="type-overline">
          {title}
        </h3>
      </div>
      {description && (
        <p className="type-meta mt-0.5 pl-6">
          {description}
        </p>
      )}
    </div>
  );

}
