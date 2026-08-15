import type { ComponentType, ReactNode } from 'react';
import WorkspaceHeader, {
  type WorkspaceHeaderVariant,
} from '../../layout/WorkspaceHeader';

interface TabHeaderProps {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  actions?: ReactNode;
  variant?: WorkspaceHeaderVariant;
}

/**
 * Page and tab identity header — same compact card as the server workspace.
 */
export default function TabHeader({
  icon,
  title,
  description,
  actions,
  variant = 'default',
}: TabHeaderProps) {
  return (
    <WorkspaceHeader
      icon={icon}
      title={title}
      description={description}
      actions={actions}
      variant={variant}
      headingLevel="h2"
    />
  );
}
