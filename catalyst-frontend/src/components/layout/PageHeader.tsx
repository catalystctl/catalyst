import type { ComponentType, ReactNode } from 'react';
import WorkspaceHeader, {
  type WorkspaceHeaderVariant,
} from './WorkspaceHeader';

interface PageHeaderProps {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  actions?: ReactNode;
  variant?: WorkspaceHeaderVariant;
  className?: string;
}

export function PageHeader({
  icon,
  title,
  description,
  actions,
  variant,
  className,
}: PageHeaderProps) {
  return (
    <WorkspaceHeader
      icon={icon}
      title={title}
      description={description}
      actions={actions}
      variant={variant}
      className={className}
    />
  );
}

export default PageHeader;
