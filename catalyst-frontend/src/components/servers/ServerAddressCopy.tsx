/**
 * Click-to-copy server address (audit D8).
 *
 * The detail header has a copy button next to `host:port`; the fleet list and
 * card showed the same string as inert text, so telling someone how to connect
 * meant selecting a truncated address by hand. This is the same affordance:
 * copy on click, a toast for success/failure, an accessible name, and
 * `stopPropagation` so the surrounding row keeps its own click/Enter
 * navigation.
 */
import { useTranslation } from 'react-i18next';
import { Copy } from 'lucide-react';
import { notifyError, notifySuccess } from '../../utils/notify';
import { cn } from '@/lib/utils';

type Props = {
  /** Host as rendered on the row (falls back to the node's address). */
  host: string | number | undefined;
  port: string | number | undefined;
  /** Rendering variant: the fleet row's inline text or the card's meta line. */
  variant?: 'inline' | 'meta';
  className?: string;
};

/** `host:port`, with `—` for a missing half (matches the rendered text). */
const serverAddressText = (host: string | number | undefined, port: string | number | undefined): string =>
  `${host ?? '—'}:${port ?? '—'}`;

export default function ServerAddressCopy({ host, port, variant = 'inline', className }: Props) {
  const { t } = useTranslation('servers');
  const address = serverAddressText(host, port);

  return (
    <button
      type="button"
      // A row/card click navigates to the server; copying must not do that.
      onClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        void navigator.clipboard.writeText(address).then(
          () => notifySuccess(t('details.copiedAddress')),
          () => notifyError(t('details.copyFailed')),
        );
      }}
      onKeyDown={(event) => {
        // Keep row arrow/enter navigation from firing for this control.
        if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
      }}
      title={t('details.copyAddressHint', { address })}
      aria-label={t('details.copyAddressLabel', { address })}
      className={cn(
        'inline-flex min-w-0 items-center gap-1 text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        variant === 'meta' ? 'text-micro text-muted-foreground' : 'font-mono text-micro text-muted-foreground',
        className,
      )}
    >
      <span className="truncate font-mono tabular-nums">{address}</span>
      <Copy className="h-2.5 w-2.5 shrink-0 opacity-60" aria-hidden />
    </button>
  );
}