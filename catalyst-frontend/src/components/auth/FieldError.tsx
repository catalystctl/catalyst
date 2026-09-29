import { CircleAlert } from 'lucide-react';

/**
 * Shared auth field error: icon + message, wired for a11y via
 * aria-describedby on the input. One recipe for Login/Register/Reset/Setup.
 */
export default function FieldError({ id, message }: { id: string; message?: string | null }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="flex items-center gap-1.5 text-mini leading-snug text-danger">
      <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0">{message}</span>
    </p>
  );
}
