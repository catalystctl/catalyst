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
 * Tab-level headers drop the card edge and tighten vertical padding: the tab
 * bar directly above already names the page with an active marker, so a second
 * full-height bordered bar would stack three chrome rows before any content.
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
      className="border-0 bg-transparent [&>div]:py-1.5"
    />
  );
}
